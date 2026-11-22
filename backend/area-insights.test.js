import test from 'node:test';
import assert from 'node:assert/strict';
import {recentEvents, recommendationReason, recommendationComment} from '../frontend/src/area-insights.mjs';

test('recent event totals and chart use the same inclusive city-wide window', () => {
  const history = {
    growthPeriod:{from:'2022-07',to:'2023-06'},
    eventTrend:[
      {month:'2021-06',openings:100,closures:0},
      {month:'2021-07',openings:4,closures:9},
      {month:'2022-06',openings:3,closures:2},
      {month:'2022-07',openings:10,closures:6},
      {month:'2023-06',openings:2,closures:1}
    ]
  };
  const oneYear = recentEvents(history, 12), twoYears = recentEvents(history, 24);
  assert.deepEqual([oneYear.from, oneYear.to, oneYear.rows.length, oneYear.openings, oneYear.closures],
    ['2022-07', '2023-06', 12, 12, 7]);
  assert.deepEqual([twoYears.from, twoYears.rows.length, twoYears.openings, twoYears.closures], ['2021-07', 24, 19, 18]);
  assert.deepEqual(oneYear.rows[1], {month:'2022-08',openings:0,closures:0});
  assert.equal(recentEvents({growthPeriod:history.growthPeriod,eventTrend:[]},12), null);
});

test('recommendation reasons provide evidence for a strong score and a weak score in use', () => {
  const area = {
    score:65, effectiveWeights:{fit:45, stability:30, growth:25},
    scores:{fit:90, competition:5, stability:60, growth:30},
    metrics:{totalStores:1200, competition:.5, industryStores:600, stability:55},
    historyContext:{growthPeriod:{from:'2022-07',to:'2023-06'},periodOpenings:14,periodClosures:25}
  };
  const reason = recommendationReason(area, '카페');
  assert.match(reason, /1,200곳/);
  assert.match(reason, /성장성 점수는 30점/);
  assert.match(reason, /14곳이 열고 25곳이 닫았어요/);
  assert.doesNotMatch(reason, /카페/);
  assert.doesNotMatch(recommendationReason({...area,score:null},'카페'), /90점/);
});

test('ranked comments cite observed data for each factor and explain the gap to the previous result', () => {
  const area = {
    score:74, effectiveWeights:{fit:30,competition:25,stability:25,growth:20},
    scores:{fit:90,competition:85,stability:81,growth:25},
    metrics:{totalStores:1200,industryStores:60,competition:.05,stability:55.2,growth:-11/39},
    historyContext:{growthPeriod:{from:'2022-07',to:'2023-06'},periodOpenings:14,periodClosures:25}
  };
  const lines = recommendationComment(area,{industry:'카페',region:'부산진구',rank:2,previousArea:{score:79}});
  assert.equal(lines.length,5);
  assert.match(lines[0], /부산진구.*74점으로 2위.*5점 차이/);
  assert.match(lines.join('\n'), /카페 점포는 60곳으로 전체의 5%/);
  assert.match(lines.join('\n'), /평균 55.2개월/);
  assert.match(lines.join('\n'), /2022-07~2023-06.*폐업이 11건 더 많았어요.*-28.2%.*25점/);
  const previousArea = {...area, score:79, scores:{...area.scores,fit:95,growth:50}};
  assert.match(recommendationComment(area,{rank:2,previousArea})[0], /성장성 점수는 25점 낮아요/);
  assert.match(recommendationComment(area,{rank:3,previousArea:{score:74,metrics:{totalStores:1500}}})[0], /동점.*전체 점포 수/);
});

test('ranked comments distinguish missing data and excluded competition without inventing a score or rank', () => {
  const area = {
    score:60, effectiveWeights:{fit:55,stability:45},
    scores:{fit:75,competition:35,stability:45,growth:null},
    metrics:{totalStores:100,industryStores:0,competition:0,stability:20}
  };
  const lines = recommendationComment(area,{rank:1,conditions:{competition:'any'}});
  assert.equal(lines.length,4);
  assert.match(lines.at(-1), /성장성 항목의 비교 데이터가 부족/);
  assert.doesNotMatch(lines.join('\n'), /경쟁 적합도/);
  const unscored = recommendationComment({...area,score:null},{rank:3,industry:'카페'});
  assert.equal(unscored.length,3);
  assert.match(unscored[1], /카페 점포가 0곳/);
  assert.doesNotMatch(unscored.join('\n'), /3위/);
});

