import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAreaHistoryScores} from './recommendation-context-db.js';

test('whole-area history scores share one city-wide window and preserve lifetime cards and graphs',()=>{
  const history=new Map([
    ['A',{records:50,validSample:5,averageOperatingMonths:80,permitRecords:185,closureRecords:115,eventTrend:[
      {month:'2022-05',openings:100,closures:0},
      {month:'2022-06',openings:6,closures:4},
      {month:'2023-04',openings:3,closures:7},
    ]}],
    ['B',{records:30,validSample:10,averageOperatingMonths:40,permitRecords:100,closureRecords:60,eventTrend:[{month:'2023-05',openings:8,closures:2}]}],
  ]);
  const snapshots=[...history.values()].map(h=>[h.averageOperatingMonths,h.permitRecords,h.closureRecords,structuredClone(h.eventTrend)]);
  applyAreaHistoryScores(history);
  const [a,b]=[...history.values()];
  assert.equal(a.stability,80);
  assert.equal(b.stability,40);
  assert.equal(a.growth,-.1);
  assert.equal(b.growth,.6);
  assert.deepEqual(a.growthPeriod,{from:'2022-06',to:'2023-05'});
  assert.deepEqual(a.growthPeriod,b.growthPeriod);
  assert.equal(a.periodOpenings,9);
  assert.equal(a.periodClosures,11);
  assert.deepEqual([...history.values()].map(h=>[h.averageOperatingMonths,h.permitRecords,h.closureRecords,h.eventTrend]),snapshots);
});

test('insufficient history affects scores only; zero denominators never become growth scores',()=>{
  const sparse={records:3,validSample:4,averageOperatingMonths:200,permitRecords:3,closureRecords:0,eventTrend:[{month:'2023-05',openings:3,closures:0}]};
  const empty={records:0,validSample:null,averageOperatingMonths:null,permitRecords:null,closureRecords:null,eventTrend:[]};
  const zero={...empty,records:1,eventTrend:[{month:'2023-05',openings:0,closures:0}]};
  applyAreaHistoryScores(new Map([['sparse',sparse],['empty',empty],['zero',zero]]));
  assert.equal(sparse.stability,null);
  assert.equal(sparse.growth,null);
  assert.equal(sparse.permitRecords,3);
  assert.equal(sparse.averageOperatingMonths,200);
  assert.equal(empty.stability,null);
  assert.equal(empty.growth,null);
  assert.equal(zero.growth,null);
  assert.equal(empty.periodOpenings,null);
  const noHistory=new Map([['none',{...empty,eventTrend:[]}]]);
  applyAreaHistoryScores(noHistory);
  assert.equal(noHistory.get('none').growthPeriod,null);
});
