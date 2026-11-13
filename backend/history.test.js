import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {historyMetrics}=await import('./server.js');

const today = new Date().toISOString().slice(0,10);
const dong = { adongCd:'26230100', adongNm:'부전1동', signguNm:'부산진구' };
const complete = rows => ({ rows, rawCount:rows.length, total:rows.length, truncated:false });

test('broad restaurant history maps Busan 외식 category and counts recent opening and closure dates',()=>{
  const result=historyMetrics(complete([
    {bplcnm:'A',rdnwhladdr:'부산진구 부전1동',majornm:'외식',minornm:'한식음식점',upjongnm:'한식 일반 음식점업',apvpermymd:today},
    {bplcnm:'B',rdnwhladdr:'부산진구 부전1동',majornm:'외식',minornm:'한식음식점',upjongnm:'한식 일반 음식점업',dcbymd:today}
  ]),dong,{label:'음식점'},{industry:'음식점',months:12},[]);
  assert.equal(result.verified,true);
  assert.equal(result.openings,1);
  assert.equal(result.closures,1);
});

test('cafe history matches coffee shop taxonomy in Busan history fields',()=>{
  const result=historyMetrics(complete([
    {bplcnm:'A',rdnwhladdr:'부산 부산진구 부전동 1-2',majornm:'외식',minornm:'커피·음료 ',upjongnm:'비알콜 음료점업',apvpermymd:today}
  ]),dong,{label:'커피전문점'}, {industry:'카페',months:12},[
    {adongCd:dong.adongCd,rdnmAdr:'부산광역시 부산진구 부전동 1-2'}
  ]);
  assert.equal(result.verified,true);
  assert.equal(result.openings,1);
});

test('세부 업종 표본이 부족하면 행정동 내 외식 대분류 개폐업으로 범위를 넓혀 표시한다',()=>{
  const rows=Array.from({length:30},(_,i)=>({
    bplcnm:`업소${i}`,rdnwhladdr:'부산광역시 부산진구 부전동 중앙대로 1',
    majornm:'외식',minornm:'한식음식점',upjongnm:'한식 일반 음식점업',
    ...(i<18?{apvpermymd:today}:{dcbymd:today})
  }));
  const result=historyMetrics(complete(rows),dong,{label:'카페'},{industry:'카페',months:12},[
    {adongCd:dong.adongCd,rdnmAdr:'부산광역시 부산진구 부전동 중앙대로 1'}
  ]);
  assert.equal(result.verified,true);
  assert.equal(result.openings,18);
  assert.equal(result.closures,12);
  assert.equal(result.categoryScope,'부산 점포이력 대분류 외식업 전체(동 기준)');
  assert.equal(result.matchedRows,30);
});

test('도로명 상세주소 차이로 생기는 접두 주소 매칭도 행정동 이력으로 연결한다',()=>{
  const result=historyMetrics(complete([
    {bplcnm:'기록점포',rdnwhladdr:'부산광역시 부산진구 중앙대로 1 2층',majornm:'외식',minornm:'한식음식점',upjongnm:'한식 음식점업',apvpermymd:today}
  ]),dong,{label:'한식'},{industry:'한식',months:12},[
    {adongCd:dong.adongCd,rdnmAdr:'부산광역시 부산진구 중앙대로 1'}
  ]);
  assert.equal(result.verified,true);
  assert.equal(result.openings,1);
});

test('stale history is reported with the actual latest 12-month period instead of pretending to be current',()=>{
  const result=historyMetrics(complete([
    {bplcnm:'A',rdnwhladdr:'부산진구 부전1동',majornm:'외식',minornm:'커피·음료',upjongnm:'비알콜 음료점업',apvpermymd:'2022-08-15'},
    {bplcnm:'B',rdnwhladdr:'부산진구 부전1동',majornm:'외식',minornm:'커피·음료',upjongnm:'비알콜 음료점업',dcbymd:'2023-05-20'}
  ]),dong,{label:'커피전문점'},{industry:'카페',months:12},[]);
  assert.equal(result.verified,true);
  assert.equal(result.period.stale,true);
  assert.equal(result.period.from,'2022-05-20');
  assert.equal(result.period.to,'2023-05-20');
  assert.equal(result.openings,1);
  assert.equal(result.closures,1);
});
