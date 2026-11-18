import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDbRegion, RegionMatchError } from './region-match.js';
import { resolveDbIndustry, resolveIndustryIntent, verifiedFoodFamilies, IndustryMatchError } from './industry-match.js';
import { makeCandidate, rank } from './score.js';

const areas = [
  {district_name:'사하구',dong_name:'하단1동',total:854},
  {district_name:'사하구',dong_name:'하단2동',total:1586},
  {district_name:'중구',dong_name:'남포동',total:1161},
  {district_name:'부산진구',dong_name:'부전1동',total:2759},
  {district_name:'부산진구',dong_name:'부전2동',total:2900},
];
const industries = [
  ...Object.values(verifiedFoodFamilies).flat().map(([industry_code,industry_name])=>({industry_code,industry_name})),
  {industry_code:'S20701',industry_name:'미용실'},
  {industry_code:'S20703',industry_name:'네일숍'},
  {industry_code:'I21201',industry_name:'카페'},
  {industry_code:'R10202',industry_name:'독서실/스터디 카페'},
  {industry_code:'I21104',industry_name:'요리 주점'},
  {industry_code:'G20405',industry_name:'편의점'},
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
  assert.deepEqual(resolveDbRegion('서면',areas).areas.map(row=>row.dong_name),['부전1동','부전2동']);
});

test('verified Seomyeon aliases select only existing Bujeon/Jeonpo administrative dongs',()=>{
  const all=[...areas,{district_name:'부산진구',dong_name:'전포1동'},{district_name:'부산진구',dong_name:'전포2동'},
    {district_name:'부산진구',dong_name:'가야1동'},{district_name:'해운대구',dong_name:'부전1동'}];
  for(const input of ['서면','서면역','서면 근처','부산 서면 일대','부산진구 서면','부산광역시 부산진구 서면역 주변']){
    const result=resolveDbRegion(input,all);
    assert.equal(result.scope,'alias-group');
    assert.deepEqual(result.areas.map(row=>row.dong_name),['부전1동','부전2동','전포1동','전포2동']);
    assert(result.areas.every(row=>row.district_name==='부산진구'));
    assert(result.label.includes('전포2동'));
  }
  assert.throws(()=>resolveDbRegion('해운대구 서면',all),error=>error.choiceType==='region' && error.choices.length===4);
  assert.throws(()=>resolveDbRegion('강원 서면',all),/부산 지역 데이터만/);
  assert.throws(()=>resolveDbRegion('서면',all.filter(row=>row.district_name!=='부산진구')),/연결된 행정동 데이터가 없습니다/);
  assert.throws(()=>resolveDbRegion('알수없는상권',all),/연결된 구·행정동을 찾지 못했습니다/);
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
  assert.equal(resolveDbIndustry('한식집',industries).codes.length,14);
  assert.equal(resolveDbIndustry('식당',industries).codes.length,38);
  assert.deepEqual(resolveDbIndustry('음식점',industries).codes,resolveDbIndustry('식당',industries).codes);
  assert(!resolveDbIndustry('식당',industries).codes.includes('I21201'));
  assert(!resolveDbIndustry('식당',industries).codes.includes('I21104'));
  for (const input of ['빵집','베이커리']) assert.deepEqual(resolveDbIndustry(input,industries).codes,['I21001']);
  assert.deepEqual(resolveDbIndustry('편의점',industries).codes,['G20405']);
  assert.throws(() => resolveDbIndustry('',industries), /업종을 입력/);
  assert.throws(() => resolveDbIndustry('없는 업종',industries), IndustryMatchError);
});

test('LLM 업종 누락 시 원문의 검증된 표현만 복구하고 복수 선택은 확인한다', () => {
  const recovered=resolveIndustryIntent('', '부산진구에서 커피 전문점을 열고 싶어',industries);
  assert.equal(recovered.recovered,true);
  assert.deepEqual(recovered.match.codes,['I21201']);
  assert.throws(()=>resolveIndustryIntent('', '하단동에서 창업하고 싶어',industries),/업종을 입력/);
  assert.throws(()=>resolveIndustryIntent('', '부산에서 가게를 열고 싶어',industries),/업종을 입력/);
  assert.throws(()=>resolveIndustryIntent('존재하지 않는 업종','부산에서 존재하지 않는 업종을 창업하고 싶어',industries),IndustryMatchError);
  assert.throws(()=>resolveIndustryIntent('', '부산에서 존재하지 않는 업종을 창업하고 싶어',industries),
    error=>error instanceof IndustryMatchError && error.requestedIndustry==='존재하지 않는 업종' && /검증된 DB 업종/.test(error.message));
  assert.throws(()=>resolveIndustryIntent('카페','부산진구에서 음식점이나 카페 중 고민 중이야',industries),
    error=>error instanceof IndustryMatchError && error.choiceType==='industry' &&
      error.choices.join('|')==='음식점|카페');
  assert.deepEqual(resolveIndustryIntent('미용실','하단동에서 미용실을 열고 싶어',industries).match.codes,['S20701']);
  assert.deepEqual(resolveIndustryIntent('', '카페나 커피숍을 생각 중이야',industries).match.codes,['I21201']);
  assert.throws(()=>resolveDbIndustry('식당',[...industries,{industry_code:'I20114',industry_name:'새 한식 업종'}]),IndustryMatchError);
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
