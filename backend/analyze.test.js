import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'fixture-openai';
const { analyze, server } = await import('./server.js');
const { RecommendationDbError } = await import('./recommendation-db.js');

const areas = [
  { district_name:'부산진구', dong_name:'부전1동', total:100 },
  { district_name:'부산진구', dong_name:'부전2동', total:200 },
  { district_name:'해운대구', dong_name:'우1동', total:150 },
];
const repository = {
  async loadRecommendationData() {
    return { coverage:{total:450,unmapped:0}, areas,
      industries:[{industry_code:'I21201',industry_name:'카페'},{industry_code:'S20701',industry_name:'미용실'}] };
  },
  async loadIndustryCounts(code, selectedAreas) {
    assert.deepEqual(code, ['I21201']);
    return selectedAreas.map(area => ({...area, selected:area.dong_name==='부전1동'?10:area.dong_name==='부전2동'?30:30}));
  },
  async loadAreaContexts(selectedAreas) {
    return {history:new Map(),markets:new Map(),historyQueryMs:0,changeQueryMs:0};
  },
};
const conditions = {industry:'카페',region:'부산진구',months:12,competition:'low',stability:'important',growth:'normal',budget:null};

test('DB 집계로 기존 응답 구조를 유지하며 공공 API를 호출하지 않는다', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected external API request'); };
  try {
    const result = await analyze({prompt:'카페',conditions}, repository);
    assert.equal(result.results.length, 2);
    assert.deepEqual(result.results.map(row => row.name).sort(), ['부산진구 부전1동','부산진구 부전2동']);
    assert(result.results.every(row => row.score !== null && row.scores.stability === null && row.scores.growth === null));
    assert(result.results.every(row => row.metrics.openings === null && row.metrics.survivalContext === null));
    assert.deepEqual(result.results.map(row => row.metrics.industryStores).sort((a,b)=>a-b), [10,30]);
    assert.deepEqual(Object.keys(result).sort(), ['analyzedAt','conditions','industryCode','matchedIndustry','resolvedRegion','results','sources','timing','warnings']);
    assert(result.sources[0].includes('public.stores'));
  } finally { globalThis.fetch = oldFetch; }
});

test('구·행정동 필터링과 업종 코드 필터링', async () => {
  const result = await analyze({prompt:'카페',conditions:{...conditions,region:'해운대구 우1동'}}, repository);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].name, '해운대구 우1동');
  assert.equal(result.results[0].metrics.totalStores, 150);
  assert.equal(result.results[0].metrics.industryStores, 30);
  await assert.rejects(() => analyze({prompt:'카페',conditions:{...conditions,region:'서면'}}, repository), /확인된 별칭에 연결되지/);
});

test('DB 연결 실패를 추천 실패로 전파한다', async () => {
  await assert.rejects(() => analyze({prompt:'카페',conditions}, {
    ...repository, loadRecommendationData:async () => { throw new RecommendationDbError('DB 연결 실패'); },
  }), /DB 연결 실패/);
});

test('이력 평균은 응답에만 붙고 기존 점수·정렬을 바꾸지 않는다', async () => {
  const input={prompt:'카페',conditions};
  const baseline=await analyze(input,repository);
  const enriched=await analyze(input,{
    ...repository,
    loadAreaContexts:async selectedAreas=>({
      history:new Map(selectedAreas.map(area=>[`${area.district_name}\0${area.dong_name}`,
        {scope:'행정동 전체 업종',averageOperatingMonths:42.5,validSample:3,permitRecords:7,closureRecords:5}])),
      markets:new Map(),historyQueryMs:4,changeQueryMs:2
    })
  });
  assert.deepEqual(enriched.results.map(row=>[row.name,row.score,row.scores,row.effectiveWeights]),
    baseline.results.map(row=>[row.name,row.score,row.scores,row.effectiveWeights]));
  assert(enriched.results.every(row=>row.historyContext.averageOperatingMonths===42.5));
  assert(enriched.results.every(row=>row.metrics.openings===null && row.metrics.survivalContext===null));
});

test('검증된 복수 행정동은 선택지를 반환하고 선택 후 단일 후보를 제공한다', async () => {
  const hadanAreas=[{district_name:'사하구',dong_name:'하단1동',total:854},{district_name:'사하구',dong_name:'하단2동',total:1586}];
  const hadanRepository={
    loadRecommendationData:async()=>({coverage:{total:2440,unmapped:0},areas:hadanAreas,industries:[{industry_code:'S20701',industry_name:'미용실'}]}),
    loadIndustryCounts:async(codes,rows)=>rows.map(row=>({...row,selected:row.dong_name==='하단1동'?52:81})),
    loadAreaContexts:repository.loadAreaContexts,
  };
  const request={prompt:'하단동에서 미용실을 열고 싶어',conditions:{...conditions,region:'하단동',industry:'미용실'}};
  const combined=await analyze(request,hadanRepository);
  assert.deepEqual(combined.results.map(row=>row.name).sort(),['사하구 하단1동','사하구 하단2동']);
  assert(combined.results.every(row=>row.score!==null));
  const chosen=await analyze({...request,regionChoice:'사하구 하단1동'},hadanRepository);
  assert.equal(chosen.results.length,1);
  assert.equal(chosen.results[0].metrics.industryStores,52);
  assert.equal(chosen.results[0].score,null);
  assert.match(chosen.results[0].scoreUnavailableReason,/비교 대상/);
});

function dispatch(url, method='GET', data) {
  return new Promise(resolve => {
    const req = Readable.from(data?[JSON.stringify(data)]:[]);
    req.url=url; req.method=method;
    const response={status:0,writeHead(status){this.status=status;return this;},end(content=''){resolve({status:this.status,content:String(content)});return this;}};
    server.emit('request',req,response);
  });
}
test('헬스 체크와 잘못된 추천 요청', async () => {
  assert.equal(JSON.parse((await dispatch('/api/health')).content).openaiConfigured, true);
  assert.equal((await dispatch('/api/missing')).status,404);
  assert.equal((await dispatch('/api/analyze','POST',{prompt:''})).status,422);
});
