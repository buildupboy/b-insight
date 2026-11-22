import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendSpots, searchMargin} from './spot-recommendation.js';

// 부전1동 부근을 기준으로 동쪽·북쪽으로 몇 m 떨어진 가상 점포를 만든다.
const base = {latitude:35.157, longitude:129.059};
const at = (east, north, extra = {}) => ({
  latitude:base.latitude + north / 110540,
  longitude:base.longitude + east / (111320 * Math.cos(base.latitude * Math.PI / 180)),
  address:`${east},${north}`, inDong:true, sameIndustry:false, ...extra,
});
const cluster = (east, north, count, extra) =>
  Array.from({length:count}, (_, i) => at(east + (i % 5) * 4, north + Math.floor(i / 5) * 4, extra));

test('같은 업종이 적은 지점을 먼저 고르고 옆 동의 경쟁 점포도 거리 계산에 넣는다', () => {
  const stores = [
    ...cluster(0, 0, 37), ...cluster(10, 10, 3, {sameIndustry:true}),
    ...cluster(600, 0, 40), at(600, 100, {inDong:false, sameIndustry:true}),
    ...cluster(0, 600, 40),
    at(1200, 1200),
  ];
  const result = recommendSpots(stores);
  assert.equal(result.spots.length, 3);
  const [first, second, third] = result.spots;
  assert.equal(first.sameIndustryWithin, 0);
  assert.equal(first.nearestSameIndustryMeters, null);
  assert.match(first.address, /^\d+,6\d\d$/);
  assert.equal(second.sameIndustryWithin, 1);
  assert(second.nearestSameIndustryMeters >= 80 && second.nearestSameIndustryMeters <= 110);
  assert.equal(third.sameIndustryWithin, 3);
  assert(result.spots.every(spot => spot.storesWithin >= result.activityThreshold));
});

test('주변 점포가 적은 한적한 후보와 바로 옆 후보는 추천하지 않는다', () => {
  // 50m 칸은 점포 중심을 기준으로 나뉘므로 묶음이 여러 칸에 걸칠 수 있다. 칸 수가 아니라 결과만 확인한다.
  const stores = [...cluster(0, 0, 20), ...cluster(60, 0, 20), at(600, 0)];
  const result = recommendSpots(stores);
  assert.equal(result.spots.length, 1);
  assert.equal(result.spots[0].storesWithin, 40);
});

test('선택한 동의 점포가 없으면 후보를 만들지 않는다', () => {
  const result = recommendSpots([at(0, 0, {inDong:false})]);
  assert.deepEqual(result.spots, []);
  assert.equal(result.candidateCount, 0);
  assert(searchMargin(300).lng > searchMargin(300).lat);
});
