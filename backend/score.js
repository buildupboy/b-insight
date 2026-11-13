const pct = (v,q) => { const p=(v.length-1)*q, i=Math.floor(p); return v[i]+(v[Math.ceil(p)]-v[i])*(p-i); };
function normalize(rows, field, reverse=false) {
  const values=rows.map(r=>r.metrics[field]).filter(Number.isFinite).sort((a,b)=>a-b);
  const lo=values.length>1?pct(values,.05):null, hi=values.length>1?pct(values,.95):null;
  for (const row of rows) {
    const value=row.metrics[field];
    row.scores[field]=Number.isFinite(value)&&hi>lo?Math.round(100*(reverse?hi-Math.max(lo,Math.min(hi,value)):Math.max(lo,Math.min(hi,value))-lo)/(hi-lo)):null;
  }
}
export function makeCandidate(dong, all, filtered, industry, events=null, survivalContext=null) {
  const ids=new Set(all.rows.map(r=>String(r.bizesId)));
  const periods=rows=>[...new Set(rows.map(r=>r.stdrYm).filter(Boolean))];
  const a=periods(all.rows), b=periods(filtered.rows);
  const consistent=a.length<=1&&b.length<=1&&(!a.length||!b.length||a[0]===b[0]);
  const complete=!all.truncated&&!filtered.truncated&&consistent&&filtered.rows.length<=all.rows.length&&filtered.rows.every(r=>ids.has(String(r.bizesId)))&&
    [...all.rows,...filtered.rows].every(r=>!r.adongCd || String(r.adongCd)===String(dong.adongCd));
  const total=complete?all.rows.length:null, selected=complete?filtered.rows.length:null;
  const countEvents=events?.verified&&!events.truncated;
  const currentGrowth=countEvents&&!events.period?.stale;
  return {
    id:String(dong.adongCd), name:`${dong.signguNm} ${dong.adongNm}`, region:dong.signguNm,
    dataDate:a[0]||b[0]||null,
    metrics:{ totalStores:total, industryStores:selected,
      competition:total>0?selected/total:null, activity:total,
      stability:survivalContext, survivalContext, openings:countEvents?events.openings:null, closures:countEvents?events.closures:null, eventPeriod:countEvents?events.period:null,
      growth:currentGrowth?events.openings-events.closures:null, historyRecords:countEvents?events.matchedRows:null, eventCategoryScope:countEvents?events.categoryScope:null },
    scores:{ fit:null,competition:null,stability:null,growth:null },
    industryEvidence:{label:industry.label,filter:industry.filter,totalReported:filtered.total??null,fetched:filtered.rawCount??null,period:b[0]||a[0]||null,subsetConfirmed:complete},
    provenance:{fit:['storeListInDong.bizesId','storeListInDong.adongCd'],competition:['storeListInDong.bizesId','storeListInDong.indsSclsCd','storeListInDong.indsLclsCd'],stability:[],growth:currentGrowth?events.fields:[]},
    notes:[!complete&&'행정동 점포 목록이 불완전하거나 업종 점포의 ID·기준월이 일치하지 않아 점포 지표를 제외했습니다.',
      '안정성은 행정동·동일 업종에 연결되는 검증된 생존 지표가 없어 제외했습니다.',
      countEvents&&events.period?.stale&&'이력 제공자료가 오래되어 개업·폐업 기록은 참고값으로만 표시하고 성장성 점수 계산에서는 제외했습니다.',
      !countEvents&&(events?.reason||'\uAC1C\uC5C5\u00B7\uD3D0\uC5C5 \uC790\uB8CC\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.')].filter(Boolean)
  };
}
export function rank(rows, conditions) {
  // Fit measures comparative commercial activity, not rent or consumer demand.
  normalize(rows,'activity'); normalize(rows,'competition',true); normalize(rows,'stability'); normalize(rows,'growth');
  const base={fit:30,competition:conditions.competition==='any'?0:25,stability:conditions.stability==='important'?40:25,growth:conditions.growth==='important'?35:20};
  for (const row of rows) {
    row.scores.fit=row.scores.activity;
    delete row.scores.activity;
    const valid=Object.keys(base).filter(k=>base[k]>0&&Number.isFinite(row.scores[k]));
    const sum=valid.reduce((n,k)=>n+base[k],0);
    row.effectiveWeights=valid.length<2?{}:Object.fromEntries(valid.map(k=>[k,Math.round(base[k]*100/sum)]));
    row.score=valid.length<2?null:Math.round(valid.reduce((n,k)=>n+row.scores[k]*base[k],0)/sum);
    row.verdict=row.score===null?'데이터 부족':row.score>=80?'추천':row.score>=60?'추천 후보':'비교 필요';
  }
  return rows.sort((a,b)=>(b.score??-1)-(a.score??-1)||(b.metrics.totalStores??-1)-(a.metrics.totalStores??-1)).slice(0,3);
}
