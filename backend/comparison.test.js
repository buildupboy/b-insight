import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonMetrics,metricValue,metricDifference,formatMetric,selectComparison,loadComparison} from '../frontend/src/comparison.mjs';
process.env.NODE_ENV='test';
const {analyzeComparison}=await import('./server.js');
const metric=key=>comparisonMetrics.find(item=>item.key===key);
const area=(overrides={})=>({score:82,effectiveWeights:{fit:40,competition:60},metrics:{industryStores:72,growth:0},
  historyContext:{scope:'행정동 전체 업종',source:'history',averageOperatingMonths:48,periodOpenings:14,periodClosures:9,growthPeriod:{from:'2025-01',to:'2025-12'}},...overrides});
test('differences use the baseline for high/low/equal, zero, negative and missing values',()=>{
  const base=area();
  assert.deepEqual(metricDifference(area({score:90}),base,metric('score')),{kind:'up',amount:8});
  assert.deepEqual(metricDifference(area({score:0}),base,metric('score')),{kind:'down',amount:82});
  assert.deepEqual(metricDifference(base,base,metric('score')),{kind:'equal',amount:0});
  assert.deepEqual(metricDifference(area({score:null}),base,metric('score')),{kind:'missing'});
  const negative=area({historyContext:{...base.historyContext,periodOpenings:9,periodClosures:11}});
  assert.equal(metricValue(negative,'net'),-2);
  assert.deepEqual(metricDifference(negative,base,metric('net')),{kind:'down',amount:7});
  assert.deepEqual(metricDifference(area({metrics:{industryStores:80}}),base,metric('stores')),{kind:'up',amount:8});
  assert.equal(metricValue(area({historyContext:{periodOpenings:0,periodClosures:0}}),'net'),0);
  assert.equal(metricValue(area({historyContext:{periodOpenings:null,periodClosures:0}}),'net'),null);
});
test('display precision and scope prevent misleading arrows',()=>{
  const base=area(),almost=area({historyContext:{...base.historyContext,averageOperatingMonths:48.04}});
  assert.equal(metricDifference(almost,base,metric('months')).kind,'equal');
  assert.equal(formatMetric(48.04,metric('months')),'48.0개월');
  assert.equal(formatMetric(null,metric('stores')),'데이터 없음');
  assert.equal(formatMetric(0,metric('stores')),'0개');
  assert.equal(formatMetric(-2,metric('net')),'-2곳');
  assert.equal(metricDifference(area({historyContext:{...base.historyContext,growthPeriod:{from:'2024-01',to:'2024-12'}}}),base,metric('net')).kind,'incompatible');
  assert.equal(metricDifference(area({effectiveWeights:{fit:30,competition:70}}),base,metric('score')).kind,'incompatible');
  assert.equal(metricDifference(area({historyContext:{...base.historyContext,scope:'동일 업종'}}),base,metric('months')).kind,'incompatible');
  assert.equal(metricDifference(area({metrics:{industryStores:72},dataDate:'2025-01'}),base,metric('stores')).kind,'incompatible');
});
test('three slots reject duplicates and retain order on removal and baseline changes',()=>{
  const ids=['a','b','c'];
  assert.deepEqual(selectComparison(ids,1,null),['a',null,'c']);
  assert.deepEqual(selectComparison(ids,0,'d'),['d','b','c']);
  assert.equal(selectComparison(ids,1,'c'),ids);
  assert.equal(selectComparison(ids,3,'d'),ids);
  assert.deepEqual(selectComparison([null,null,null],2,'c'),[null,null,'c']);
});
test('comparison snapshot queries the city once and preserves analysis conditions and full history',async()=>{
  let counts=0,histories=0;
  const areas=[{district_name:'부산진구',dong_name:'부전1동',total:100},{district_name:'해운대구',dong_name:'우1동',total:200}];
  const conditions={industry:'카페',region:'부산진구',competition:'low',stability:'important',growth:'normal',populationRequested:true,populationTypes:['density'],budget:10000};
  const result=await analyzeComparison({conditions},{
    loadRecommendationData:async()=>({coverage:{total:300},areas,industries:[{industry_code:'I21201',industry_name:'카페'}]}),
    loadIndustryCounts:async()=>{counts++;return areas.map((item,i)=>({...item,selected:i?40:10}));},
    loadAreaContexts:async()=>{histories++;return {history:new Map(areas.map(item=>[`${item.district_name}\0${item.dong_name}`,area().historyContext])),historyQueryMs:0,changeQueryMs:0};},
  });
  assert.equal(counts,1);assert.equal(histories,1);assert.equal(result.areas.length,2);
  assert.deepEqual(result.conditions,conditions);assert.deepEqual(result.areas,result.results);
  assert(result.areas.every(item=>item.historyContext.growthPeriod.to==='2025-12'));
  assert.equal(result.normalizationBasis.candidateCount,2);
  await assert.rejects(()=>analyzeComparison({conditions:{industry:''}}),/업종/);
});
test('snapshot fetches are deduplicated and failed requests can be retried',async()=>{
  const original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({areas:[]}));};
    const conditions={industry:'snapshot-test'};
    await Promise.all([loadComparison(conditions),loadComparison(conditions)]);assert.equal(calls,1);
    await loadComparison(conditions);assert.equal(calls,1);
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'temporary'}),{status:502});};
    await assert.rejects(()=>loadComparison(conditions,{refresh:true}),/temporary/);
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({areas:[]}));};
    await loadComparison(conditions);assert.equal(calls,3);
  }finally{globalThis.fetch=original;}
});
