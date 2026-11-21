export const comparisonMetrics=[
  {key:'score',label:'추천 점수',unit:'점',digits:0},
  {key:'months',label:'평균 생존기간',unit:'개월',digits:1,note:'전체 업종 · 폐업 점포의 평균 영업기간'},
  {key:'stores',label:'동일 업종 점포 수',unit:'개',digits:0,note:'적을수록 유리'},
  {key:'openings',label:'최근 개업',unit:'곳',digits:0,note:'전체 업종 · 공통 최근 12개월'},
  {key:'closures',label:'최근 폐업',unit:'곳',digits:0,note:'전체 업종 · 공통 최근 12개월 · 적을수록 유리'},
  {key:'net',label:'개업 − 폐업',unit:'곳',digits:0,signed:true},
  {key:'growth',label:'상권 성장성',unit:'%',differenceUnit:'%p',digits:1,note:'전체 업종 · (개업−폐업) / (개업+폐업)'},
];
export function metricValue(area,key) {
  const history=area?.historyContext;
  const values={score:area?.score,months:history?.averageOperatingMonths,stores:area?.metrics?.industryStores,
    openings:history?.periodOpenings,closures:history?.periodClosures,
    net:Number.isFinite(history?.periodOpenings)&&Number.isFinite(history?.periodClosures)?history.periodOpenings-history.periodClosures:null,
    growth:Number.isFinite(area?.metrics?.growth)?area.metrics.growth*100:null};
  return Number.isFinite(values[key])?values[key]:null;
}
export const rounded=(value,digits=0)=>Number(value.toFixed(digits));
export function formatMetric(value,metric) {
  if(!Number.isFinite(value))return '데이터 없음';
  const number=rounded(value,metric.digits);
  return `${metric.signed&&number>0?'+':''}${number.toLocaleString('ko-KR',{minimumFractionDigits:metric.digits,maximumFractionDigits:metric.digits})}${metric.unit}`;
}
function scope(area,metric) {
  if(metric.key==='stores')return JSON.stringify([area.dataDate??null,area.industryEvidence?.filter??null]);
  if(metric.key==='score')return JSON.stringify(area.effectiveWeights??{});
  const h=area.historyContext;
  if(!h?.scope||!h?.source)return null;
  if(metric.key==='months')return JSON.stringify([h.scope,h.source,'all-observed-closed-records']);
  const period=h.growthPeriod??h.eventPeriod;
  return period?.from&&period?.to?JSON.stringify([h.scope,h.source,period.from,period.to]):null;
}
export function metricDifference(area,base,metric) {
  const value=metricValue(area,metric.key),reference=metricValue(base,metric.key);
  if(value===null||reference===null)return {kind:'missing'};
  const ownScope=scope(area,metric),baseScope=scope(base,metric);
  if(!ownScope||ownScope!==baseScope)return {kind:'incompatible'};
  const delta=rounded(rounded(value,metric.digits)-rounded(reference,metric.digits),metric.digits);
  return {kind:delta>0?'up':delta<0?'down':'equal',amount:Math.abs(delta)};
}
export function selectComparison(ids,index,id) {
  if(!Number.isInteger(index)||index<0||index>2||!Array.isArray(ids))return ids;
  const next=Array.from({length:3},(_,i)=>ids[i]??null);
  if(id&&next.some((value,i)=>i!==index&&value===id))return ids;
  next[index]=id||null;
  return next;
}
export const comparisonKey=conditions=>JSON.stringify({...conditions,region:'부산 전체'});
const snapshots=new Map();
export async function loadComparison(conditions,{refresh=false}={}) {
  const key=comparisonKey(conditions),found=snapshots.get(key);
  if(!refresh&&found&&Date.now()-found.time<300000)return found.promise;
  const promise=fetch('/api/comparison-data',{method:'POST',headers:{'Content-Type':'application/json'},
    signal:AbortSignal.timeout(75000),body:JSON.stringify({conditions})}).then(async response=>{
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'비교 데이터를 불러오지 못했습니다.');
    return data;
  });
  const entry={promise,time:Date.now()};snapshots.set(key,entry);
  try{return await promise;}catch(error){if(snapshots.get(key)===entry)snapshots.delete(key);throw error;}
}
