import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCandidate,rank} from './score.js';

const industry={label:'카페',filter:{indsSclsCd:'I21201'}};
const dong=(id,name)=>({adongCd:id,adongNm:name,signguNm:'부산진구'});
const store=(id,code,small='I21201')=>({bizesId:id,adongCd:code,indsSclsCd:small,stdrYm:'202601'});
const result=rows=>({rows,truncated:false,total:rows.length,rawCount:rows.length});
const conditions={competition:'low',stability:'important',growth:'normal'};
test('행정동 비교값이 다르면 실제 점포 수와 업종 비중으로 점수를 만들고 상위 3개만 반환한다',()=>{
  const rows=Array.from({length:4},(_,i)=>{
    const code='2623010'+String(i).padStart(3,'0');
    const all=Array.from({length:10+i*5},(_,n)=>store(String(i)+'-'+n,code,n<2+i*2?'I21201':'I29999'));
    return makeCandidate(dong(code,'부전'+(i+1)+'동'),result(all),result(all.filter(r=>r.indsSclsCd==='I21201')),industry);
  });
  const top=rank(rows,conditions);
  assert.equal(top.length,3);
  assert(top.every(row=>row.score!==null));
  assert(top.every(row=>row.name.startsWith('부산진구 부전')));
  assert(top.every(row=>row.metrics.openings===null&&row.metrics.stability===null));
  assert(top.every(row=>row.effectiveWeights.fit>0&&row.effectiveWeights.competition>0));
});
test('불완전한 페이지, 업종 점포 ID 불일치, 비교값 동률은 점수와 수치를 만들지 않는다',()=>{
  const code='2623010000', all=result([store('1',code),store('2',code)]);
  const invalid=makeCandidate(dong(code,'부전동'),all,result([store('other',code)]),industry);
  assert.equal(invalid.metrics.industryStores,null);
  const a=makeCandidate(dong(code,'부전동'),all,result([store('1',code)]),industry);
  const b=makeCandidate(dong('2623010001','전포동'),result([store('3','2623010001'),store('4','2623010001')]),result([store('3','2623010001')]),industry);
  rank([a,b],conditions);
  assert.equal(a.score,null);
  assert.equal(b.verdict,'데이터 부족');
});

test('stale event history remains visible but is excluded from growth scoring',()=>{
  const code='2623010000', all=result([store('1',code)]);
  const candidate=makeCandidate(dong(code,'\uBD80\uC8042\uB3D9'),all,all,industry,{
    verified:true,openings:0,closures:1,matchedRows:12,fields:['apvpermymd','dcbymd'],
    period:{from:'2022-05-26',to:'2023-05-26',stale:true,latestObserved:'2023-05-26'}
  },67);
  assert.equal(candidate.metrics.openings,0);
  assert.equal(candidate.metrics.closures,1);
  assert.equal(candidate.metrics.growth,null);
  assert.equal(candidate.metrics.historyRecords,12);
});
