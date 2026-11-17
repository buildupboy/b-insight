import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDbRegion, RegionMatchError } from './region-match.js';
import { resolveDbIndustry, IndustryMatchError } from './industry-match.js';
import { makeCandidate, rank } from './score.js';

const areas = [
  {district_name:'사하구',dong_name:'하단1동',total:854},
  {district_name:'사하구',dong_name:'하단2동',total:1586},
  {district_name:'중구',dong_name:'남포동',total:1161},
  {district_name:'부산진구',dong_name:'부전1동',total:2759},
  {district_name:'부산진구',dong_name:'부전2동',total:2900},
];
const industries = [
  {industry_code:'S20701',industry_name:'미용실'},
  {industry_code:'S20703',industry_name:'네일숍'},
  {industry_code:'I21201',industry_name:'카페'},
  {industry_code:'R10202',industry_name:'독서실/스터디 카페'},
  {industry_code:'I20101',industry_name:'백반/한정식'},
  {industry_code:'I20199',industry_name:'기타 한식 음식점'},
  {industry_code:'I21007',industry_name:'김밥/만두/분식'},
  {industry_code:'I21104',industry_name:'요리 주점'},
];

test('부산·구·동 표기를 실제 DB 행정동으로 정규화한다', () => {
  for (const input of ['사하구 하단1동','부산 사하구 하단1동','부산광역시 사하구 하단1동','하단1동']) {
    assert.equal(resolveDbRegion(input,areas).label,'사하구 하단1동');
  }
  assert.equal(resolveDbRegion('사하구',areas).areas.length,2);
  assert.equal(resolveDbRegion('남포동',areas).label,'중구 남포동');
  for (const input of ['', '부산', '부산 전체', '지역 상관없이']) assert.equal(resolveDbRegion(input,areas).areas.length,areas.length);
});

test('분리된 행정동의 통합 검색은 실제 각 동을 독립 후보로 반환한다', () => {
  for (const input of ['하단동','사하구 하단동','부산 사하구 하단동','부산광역시 사하구 하단동']) {
    const matched=resolveDbRegion(input,areas);
    assert.equal(matched.scope,'dong-group');
    assert.deepEqual(matched.areas.map(row=>row.dong_name),['하단1동','하단2동']);
  }
  assert.deepEqual(resolveDbRegion('부전동',areas).areas.map(row=>row.dong_name),['부전1동','부전2동']);
  assert.throws(() => resolveDbRegion('서울 강남구',areas), /부산 지역 데이터만/);
  assert.throws(() => resolveDbRegion('서면',areas), /확인된 별칭에 연결되지/);
});

test('동명이 여러 구에 있으면 선택지를 제공한다', () => {
  const repeated=[...areas,{district_name:'다른구',dong_name:'남포동',total:5}];
  assert.throws(() => resolveDbRegion('남포동',repeated), error => error.choices.length===2);
});

test('실제 코드로 업종명·동의어·넓은 업종을 연결한다', () => {
  for (const input of ['미용실','헤어샵','헤어숍']) assert.deepEqual(resolveDbIndustry(input,industries).codes,['S20701']);
  for (const input of ['카페','커피숍','커피 전문점']) assert.deepEqual(resolveDbIndustry(input,industries).codes,['I21201']);
  for (const input of ['네일숍','네일샵']) assert.deepEqual(resolveDbIndustry(input,industries).codes,['S20703']);
  assert.deepEqual(resolveDbIndustry('분식집',industries).codes,['I21007']);
  assert.deepEqual(resolveDbIndustry('한식집',industries).codes,['I20101','I20199']);
  assert.deepEqual(resolveDbIndustry('식당',industries).codes,['I21201','I20101','I20199','I21007','I21104']);
  assert.throws(() => resolveDbIndustry('',industries), /업종을 입력/);
  assert.throws(() => resolveDbIndustry('없는 업종',industries), IndustryMatchError);
});

test('기본 가중치를 유지하고 경쟁 선호만 우선 반영하며 합계는 100%', () => {
  const candidate=(name,total,selected)=>makeCandidate({adongCd:name,signguNm:'사하구',adongNm:name},{count:total},{count:selected},{label:'카페',filter:{indsSclsCd:'I21201'}});
  const base=rank([candidate('A',100,10),candidate('B',200,50)],{competition:'normal',stability:'normal',growth:'normal'});
  assert.deepEqual(base[0].effectiveWeights,{fit:55,competition:45});
  const preferred=rank([candidate('A',100,10),candidate('B',200,50)],{competition:'low',stability:'normal',growth:'normal'});
  assert(preferred[0].effectiveWeights.competition>base[0].effectiveWeights.competition);
  assert(preferred.every(row=>Object.values(row.effectiveWeights).reduce((a,b)=>a+b,0)===100));
  const single=rank([candidate('A',100,10)],{competition:'normal',stability:'normal',growth:'normal'});
  assert.equal(single[0].score,null);
  assert.match(single[0].scoreUnavailableReason,/비교 대상 행정동이 하나/);
});
