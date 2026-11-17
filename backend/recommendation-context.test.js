import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHistory, historyFromAggregate, loadAreaContexts } from './recommendation-context-db.js';
import { RecommendationDbError } from './recommendation-db.js';

const area={district_name:'사하구',dong_name:'하단1동'};
const base={...area,administrative_dong_name:'하단1동',bplcnm:'가게',rdnwhladdr:'주소',majornm:'서비스',minornm:'미용실',upjongnm:'미용실'};

test('이력은 중복 사건을 제거하고 실제 날짜가 있는 전체 업종 기록만 센다', () => {
  const rows=[
    {...base,trdstatenm:'영업/정상',apvpermymd:'2023-05-11',dcbymd:null},
    {...base,trdstatenm:'영업/정상',apvpermymd:'2023-05-11',dcbymd:null},
    {...base,bplcnm:'다른 가게',trdstatenm:'폐업',apvpermymd:'2020-01-01',dcbymd:'2023-02-15'},
    {...base,bplcnm:'셋째',trdstatenm:'폐업',apvpermymd:'2023-02-30',dcbymd:null},
  ];
  const result=summarizeHistory(rows,[area]).get('사하구\0하단1동');
  assert.equal(result.records,3);
  assert.equal(result.permitRecords,2);
  assert.equal(result.closureRecords,1);
  assert.equal(result.undatedClosedRecords,1);
  assert.equal(result.firstObserved,'2020-01-01');
  assert.equal(result.lastObserved,'2023-05-11');
  assert.deepEqual(result.permitPeriod,{from:'2020-01-01',to:'2023-05-11'});
  assert.deepEqual(result.closurePeriod,{from:'2023-02-15',to:'2023-02-15'});
  assert.equal(result.validSample,1);
  assert.equal(result.closedStateRecords,2);
  assert.equal(result.excludedSampleRecords,1);
  assert(Math.abs(result.averageOperatingMonths-(1141/(365.2425/12)))<1e-9);
  assert.equal(result.duplicateRecords,1);
  assert.equal(result.exclusions.missingClosure,1);
  assert.equal(result.exclusions.invalidPermit,1);
});

test('이력 자료가 없는 행정동은 0건과 관측 기간 없음으로 구분한다', () => {
  const result=summarizeHistory([], [area]).get('사하구\0하단1동');
  assert.equal(result.records,0);
  assert.equal(result.permitRecords,null);
  assert.equal(result.closureRecords,null);
  assert.equal(result.validSample,null);
  assert.equal(result.excludedSampleRecords,null);
  assert.equal(result.averageOperatingMonths,null);
  assert.equal(result.firstObserved,null);
  assert.deepEqual(result.operatingPeriod,{from:null,to:null});
});

test('폐업 업소의 날짜 차이를 먼저 평균내고 마지막에만 개월로 환산한다', () => {
  const rows=[
    {...base,bplcnm:'A',trdstatenm:'폐업',apvpermymd:'2020-01-01',dcbymd:'2020-02-01'},
    {...base,bplcnm:'B',trdstatenm:'폐업',apvpermymd:'2020-01-01',dcbymd:'2020-03-01'},
    {...base,bplcnm:'B',trdstatenm:'폐업',apvpermymd:'2020-01-01',dcbymd:'2020-03-01',geom:'다른 좌표'},
    {...base,bplcnm:'C',trdstatenm:'폐업',apvpermymd:null,dcbymd:'2020-04-01'},
    {...base,bplcnm:'D',trdstatenm:'폐업',apvpermymd:'2020-02-30',dcbymd:'2020-04-01'},
    {...base,bplcnm:'E',trdstatenm:'폐업',apvpermymd:'2020-05-01',dcbymd:null},
    {...base,bplcnm:'F',trdstatenm:'폐업',apvpermymd:'2020-05-01',dcbymd:'2020-04-01'},
    {...base,bplcnm:'G',trdstatenm:'영업/정상',apvpermymd:'2020-05-01',dcbymd:null},
  ];
  const result=summarizeHistory(rows,[area]).get('사하구\0하단1동');
  assert.equal(result.records,7);
  assert.equal(result.duplicateRecords,1);
  assert.equal(result.permitRecords,5);
  assert.equal(result.closureRecords,5);
  assert.equal(result.validSample,2);
  assert.equal(result.closedStateRecords,6);
  assert.equal(result.excludedSampleRecords,4);
  assert(Math.abs(result.averageOperatingMonths-(45.5/(365.2425/12)))<1e-9);
  assert.deepEqual(result.operatingPeriod,{from:'2020-01-01',to:'2020-03-01'});
  assert.deepEqual(result.exclusions,{missingPermit:1,invalidPermit:1,missingClosure:1,invalidClosure:0,reversedDates:1});
});

test('개업만 있는 지역과 날짜 없는 폐업 지역은 평균 산출 불가로 둔다', () => {
  const onlyOpen=summarizeHistory([{...base,trdstatenm:'영업/정상',apvpermymd:'2020-01-01'}],[area]).get('사하구\0하단1동');
  assert.equal(onlyOpen.permitRecords,1);
  assert.equal(onlyOpen.closureRecords,0);
  assert.equal(onlyOpen.averageOperatingMonths,null);
  const noPermit=summarizeHistory([{...base,trdstatenm:'폐업',apvpermymd:null,dcbymd:'2020-04-01'}],[area]).get('사하구\0하단1동');
  assert.equal(noPermit.permitRecords,0);
  assert.equal(noPermit.closureRecords,1);
  assert.equal(noPermit.validSample,0);
  assert.equal(noPermit.averageOperatingMonths,null);
});

test('DB 집계의 자료 없음과 확인된 0건을 구분한다', () => {
  const unavailable=historyFromAggregate([], [area]).get('사하구\0하단1동');
  assert.equal(unavailable.permitRecords,null);
  assert.equal(unavailable.validSample,null);
  const zero=historyFromAggregate([{district_name:'사하구',administrative_dong_name:'하단1동',records:1,
    permit_records:0,closure_records:0,valid_sample:0}], [area]).get('사하구\0하단1동');
  assert.equal(zero.permitRecords,0);
  assert.equal(zero.closureRecords,0);
  assert.equal(zero.averageOperatingMonths,null);
});

test('DB 설정 오류를 명확히 반환한다', async () => {
  const previous=process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try { await assert.rejects(()=>loadAreaContexts([area]),RecommendationDbError); }
  finally { if (previous) process.env.DATABASE_URL=previous; }
});
