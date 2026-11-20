import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveHistoryIndustry} from './history-industry.js';
import {industryHistoryFromAggregate} from './recommendation-context-db.js';

const industry={codes:['S20701'],label:'미용실'};
const mapping=resolveHistoryIndustry(industry,[{industry_code:'S20701',industry_name:'미용실'}]);
const areas=[{district_name:'해운대구',dong_name:'우1동'},{district_name:'해운대구',dong_name:'우2동'}];
const row=(index,values={})=>({district_name:areas[index].district_name,administrative_dong_name:areas[index].dong_name,...values});

test('history mapping requires verified code/name and exact source tuple; ambiguous categories stay unavailable',()=>{
  assert.deepEqual(mapping.categories,[{majornm:'서비스',minornm:'미용실',upjongnm:'미용실'}]);
  assert.equal(resolveHistoryIndustry(industry,[{industry_code:'S20701',industry_name:'다른 업종'}]),null);
  assert.equal(resolveHistoryIndustry({codes:['I21201'],label:'카페'},[{industry_code:'I21201',industry_name:'카페'}]),null);
  assert.equal(resolveHistoryIndustry({codes:['I20108'],label:'소고기 구이/찜'},[{industry_code:'I20108',industry_name:'소고기 구이/찜'}]),null);
  assert.equal(resolveHistoryIndustry({codes:['S20701','unknown']},[{industry_code:'S20701',industry_name:'미용실'}]),null);
});

test('cards retain lifetime counts while growth/chart use a common 12-month window',()=>{
  const summary=[0,1].map(i=>row(i,{records:300,permit_records:i?4:108,closure_records:i?6:52,valid_sample:5,average_operating_months:40+i*10,first_observed:'2020-01-01'}));
  const monthly=[row(0,{month:'2022-04',openings:100,closures:50}),row(0,{month:'2023-04',openings:8,closures:2}),row(1,{month:'2023-05',openings:4,closures:6})];
  const result=industryHistoryFromAggregate(summary,monthly,areas,mapping);
  const [a,b]=[...result.values()];
  assert.deepEqual(a.eventPeriod,b.eventPeriod);
  assert.deepEqual(a.eventPeriod,{from:'2022-06',to:'2023-05',latestObserved:'2023-05'});
  for(const item of [a,b]) {
    assert.equal(item.eventTrend.length,12);
    assert.equal(item.eventTrend.reduce((sum,r)=>sum+r.openings,0),item.periodOpenings);
    assert.equal(item.eventTrend.reduce((sum,r)=>sum+r.closures,0),item.periodClosures);
  }
  assert.equal(a.permitRecords,108);
  assert.equal(a.closureRecords,52);
  assert.equal(a.periodOpenings,8);
  assert.equal(a.periodClosures,2);
  assert.equal(a.stability,40);
  assert.equal(a.growth,.6);
  assert.equal(b.growth,-.2);
  assert.deepEqual(a.eventTrend.at(-1),{month:'2023-05',openings:0,closures:0});
});

test('insufficient tenure/events and unmapped industries do not receive numeric scores',()=>{
  const summaries=[row(0,{records:10,permit_records:9,closure_records:0,valid_sample:4,average_operating_months:200,first_observed:'2020-01-01'})];
  const monthly=[row(0,{month:'2023-05',openings:9,closures:0})];
  const [sparse,missing]=[...industryHistoryFromAggregate(summaries,monthly,areas,mapping).values()];
  assert.equal(sparse.stability,null);
  assert.equal(sparse.growth,null);
  assert.equal(sparse.permitRecords,9);
  assert.equal(sparse.closureRecords,0);
  assert.deepEqual(sparse.eventTrend,[]);
  assert.equal(sparse.observedEventTrend.at(-1).openings,9);
  assert.equal(missing.stability,null);
  assert.equal(missing.closureRecords,null);
  const zero=[...industryHistoryFromAggregate(summaries,[row(0,{month:'2023-05',openings:0,closures:0})],areas,mapping).values()][0];
  assert.equal(zero.growth,null);
  const unsupported=[...industryHistoryFromAggregate([],[],areas,null).values()][0];
  assert.equal(unsupported.mappingVerified,false);
  assert.equal(unsupported.averageOperatingMonths,null);
});
