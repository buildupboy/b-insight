import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'fixture-openai';
const { analyze, server } = await import('./server.js');
const { RecommendationDbError } = await import('./recommendation-db.js');
const { verifiedFoodFamilies } = await import('./industry-match.js');

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
const conditions = {industry:'카페',region:'부산진구',competition:'low',stability:'important',growth:'normal',budget:null};

test('자연어 조건은 지역·업종·선호를 유지하고 기간 기본값 없이 추천한다', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (_url, options) => {
    const prompt=JSON.parse(options.body).messages[1].content;
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
      industry:prompt.includes('헤어샵')?'헤어샵':'카페',
      region:prompt.includes('하단동')?'하단동':prompt.includes('부산진구')?'부산진구':'부산 전체',
      competition:prompt.includes('경쟁이 적은')?'low':'normal',
      stability:'normal',growth:'normal',populationRequested:false,budget:null
    })}}]}));
  };
  try {
    const district=await analyze({prompt:'부산진구에서 카페를 열고 싶어'},repository);
    assert.equal(district.conditions.region,'부산진구');
    assert.equal(district.conditions.industry,'카페');
    assert.equal('months' in district.conditions,false);
    assert.equal(district.results.length,2);

    const city=await analyze({prompt:'카페를 열고 싶어'},repository);
    assert.equal(city.conditions.region,'부산 전체');
    assert.equal(city.results.length,3);
    assert.deepEqual(city.results.map(row=>row.name).sort(),areas.map(row=>`${row.district_name} ${row.dong_name}`).sort());

    const preference=await analyze({prompt:'경쟁이 적은 곳에서 카페를 열고 싶어'},repository);
    assert.equal(preference.conditions.competition,'low');
    assert.equal('months' in preference.conditions,false);
    assert(preference.results[0].effectiveWeights.competition>city.results[0].effectiveWeights.competition);

    const hadanAreas=[{district_name:'사하구',dong_name:'하단1동',total:854},{district_name:'사하구',dong_name:'하단2동',total:1586}];
    const hairRepository={
      ...repository,
      loadRecommendationData:async()=>({coverage:{total:2440,unmapped:0},areas:hadanAreas,
        industries:[{industry_code:'S20701',industry_name:'미용실'}]}),
      loadIndustryCounts:async(codes,selectedAreas)=>{
        assert.deepEqual(codes,['S20701']);
        return selectedAreas.map(row=>({...row,selected:row.dong_name==='하단1동'?52:81}));
      }
    };
    const hair=await analyze({prompt:'하단동에서 헤어샵을 열고 싶어'},hairRepository);
    assert.deepEqual(hair.results.map(row=>row.name).sort(),['사하구 하단1동','사하구 하단2동']);
    assert.equal(hair.matchedIndustry,'미용실');
    assert(hair.results.every(row=>row.score!==null));
  } finally {globalThis.fetch=originalFetch;}
});

test('레거시 months 입력은 조건·추천·점수·점포 수를 바꾸지 않는다', async () => {
  const baseline=await analyze({prompt:'부산진구에서 카페를 열고 싶어',conditions},repository);
  const legacy=await analyze({prompt:'부산진구에서 카페를 열고 싶어',conditions:{...conditions,months:12}},repository);
  assert.deepEqual(legacy.conditions,baseline.conditions);
  assert.deepEqual(legacy.results,baseline.results);
  assert.equal('months' in legacy.conditions,false);
});

test('API는 적용·미반영 선호와 실제 점수 가중치를 함께 반환한다', async () => {
  const base=await analyze({prompt:'부산진구에서 카페를 열고 싶어',conditions:{...conditions,competition:'normal',stability:'normal'}},repository);
  const composite=await analyze({prompt:'부산진구에서 경쟁이 적고 안정적인 곳에 카페를 열고 싶어',conditions:{
    ...conditions,competition:'low',stability:'important',populationRequested:true,populationTypes:['density']
  }},repository);
  assert.equal(base.preferenceSummary.mode,'default');
  assert.deepEqual(base.preferenceSummary.recognized,[]);
  assert.equal(composite.preferenceSummary.mode,'adjusted');
  assert.deepEqual(composite.preferenceSummary.applied.map(item=>item.key),['lowCompetition']);
  assert.deepEqual(composite.preferenceSummary.unsupported.map(item=>item.key),['stability','population_density']);
  assert.deepEqual(composite.preferenceSummary.effectiveWeights,composite.results[0].effectiveWeights);
  assert(composite.warnings.some(w=>w.includes('안정성 조건:')));
  assert(composite.warnings.some(w=>w.includes('인구밀도 조건:')));
  assert(composite.results[0].effectiveWeights.competition>base.results[0].effectiveWeights.competition);
  const evidence=rows=>rows.map(row=>[row.name,row.metrics.industryStores,row.historyContext]).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(evidence(composite.results),evidence(base.results));
});

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
    assert.deepEqual(Object.keys(result).sort(), ['analyzedAt','conditions','industryCode','matchedIndustry','normalizationBasis','preferenceSummary','resolvedRegion','results','sources','timing','warnings']);
    assert(result.sources[0].includes('public.stores'));
  } finally { globalThis.fetch = oldFetch; }
});

test('구·행정동 필터링과 업종 코드 필터링', async () => {
  const result = await analyze({prompt:'카페',conditions:{...conditions,region:'해운대구 우1동'}}, repository);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].name, '해운대구 우1동');
  assert.equal(result.results[0].metrics.totalStores, 150);
  assert.equal(result.results[0].metrics.industryStores, 30);
  const seomyeon=await analyze({prompt:'서면에서 카페를 열고 싶어요. 경쟁이 낮은 곳을 추천해줘.',conditions:{...conditions,region:'서면'}},repository);
  assert.deepEqual(seomyeon.results.map(row=>row.name).sort(),['부산진구 부전1동','부산진구 부전2동']);
  assert.equal(seomyeon.conditions.competition,'low');
  assert(seomyeon.resolvedRegion.includes('서면 일대'));
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

test('AI가 업종을 누락하면 원문의 검증된 동의어를 DB 코드로 복구한다', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
    ...conditions,industry:'',region:'부산진구'
  })}}]}));
  try {
    const result=await analyze({prompt:'부산진구에서 커피 전문점을 열고 싶어'},repository);
    assert.equal(result.conditions.industry,'커피전문점');
    assert.deepEqual(result.industryCode,{indsSclsCd:'I21201'});
    assert.equal(result.matchedIndustry,'카페');
  } finally {globalThis.fetch=originalFetch;}
});

test('AI가 미지원 업종을 누락해도 원문의 명시적 표현을 미입력과 구분한다', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
    ...conditions,industry:'',region:'부산 전체'
  })}}]}));
  try {
    await assert.rejects(()=>analyze({prompt:'부산에서 존재하지 않는 업종을 창업하고 싶어'},repository),
      error=>/존재하지 않는 업종/.test(error.message) &&
        error.extractedConditions.industry==='존재하지 않는 업종');
    await assert.rejects(()=>analyze({prompt:'부산에서 가게를 열고 싶어'},repository),
      error=>/업종을 입력/.test(error.message));
  } finally {globalThis.fetch=originalFetch;}
});

test('원문에서 복수 업종을 말하면 AI가 하나만 뽑아도 선택지를 반환한다', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
    ...conditions,industry:'카페',region:'부산진구'
  })}}]}));
  try {
    const completeRepository={...repository,loadRecommendationData:async()=>({
      coverage:{total:450,unmapped:0},areas,
      industries:[...Object.values(verifiedFoodFamilies).flat().map(([industry_code,industry_name])=>({industry_code,industry_name})),
        {industry_code:'I21201',industry_name:'카페'}]
    })};
    await assert.rejects(()=>analyze({prompt:'부산진구에서 음식점이나 카페 중 고민 중이야'},completeRepository),
      error=>error.choiceType==='industry'&&error.choices.join('|')==='음식점|카페');
  } finally {globalThis.fetch=originalFetch;}
});

test('업종 선택지 클릭 후 실제 선택 업종을 조건과 복수 코드 집계에 유지한다', async () => {
  const foodRows=Object.values(verifiedFoodFamilies).flat()
    .map(([industry_code,industry_name])=>({industry_code,industry_name}));
  const selected=await analyze({prompt:'부산진구에서 음식점이나 카페 중 고민 중이야',
    conditions:{...conditions,industry:'카페'},industryChoice:'음식점'}, {
    ...repository,
    loadRecommendationData:async()=>({coverage:{total:450,unmapped:0},areas,
      industries:[...foodRows,{industry_code:'I21201',industry_name:'카페'}]}),
    loadIndustryCounts:async(codes,selectedAreas)=>{
      assert.equal(codes.length,38);
      return selectedAreas.map(area=>({...area,selected:20}));
    }
  });
  assert.equal(selected.conditions.industry,'음식점');
  assert.equal(selected.industryCode.indsSclsCds.length,38);
  assert.equal(selected.matchedIndustry,'음식점·간이음식 전체');
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
  assert.equal(chosen.results[0].score,combined.results.find(row=>row.name==='사하구 하단1동').score);
  assert.deepEqual(chosen.results[0].scores,combined.results.find(row=>row.name==='사하구 하단1동').scores);
  assert.equal(chosen.normalizationBasis.candidateCount,2);
});

test('지역 범위가 달라도 같은 동의 공통 기준 점수와 이력은 같다', async () => {
  const fullAreas=[
    {district_name:'사하구',dong_name:'하단1동',total:854},
    {district_name:'사하구',dong_name:'하단2동',total:1586},
    {district_name:'사하구',dong_name:'다대1동',total:200},
    {district_name:'부산진구',dong_name:'부전2동',total:4174}
  ];
  let countQueries=0;
  const fullRepository={
    loadRecommendationData:async()=>({coverage:{total:6814,unmapped:0},areas:fullAreas,
      industries:[{industry_code:'S20701',industry_name:'미용실'}]}),
    loadIndustryCounts:async(codes,referenceAreas)=>{
      countQueries++;
      assert.deepEqual(codes,['S20701']);
      assert.deepEqual(referenceAreas,fullAreas);
      const selected={'하단1동':52,'하단2동':86,'다대1동':0,'부전2동':147};
      return referenceAreas.map(row=>({...row,selected:selected[row.dong_name]}));
    },
    loadAreaContexts:async chosen=>({history:new Map(chosen.map(row=>[
      `${row.district_name}\0${row.dong_name}`,{permitRecords:7,closureRecords:5,averageOperatingMonths:42,validSample:3}
    ])),markets:new Map(),historyQueryMs:1,changeQueryMs:1})
  };
  const query=region=>analyze({prompt:'미용실 창업',conditions:{industry:'미용실',region}},fullRepository);
  const pair=await query('하단동');
  const district=await query('사하구');
  const one=await query('사하구 하단2동');
  const city=await query('부산 전체');
  const get=(result,name)=>result.results.find(row=>row.name===name);
  for(const result of [pair,district,one,city]) {
    assert.deepEqual(result.normalizationBasis,{scope:'부산 전체 행정동',candidateCount:4,scoredCandidateCount:4,method:'5·95백분위'});
    assert.equal(result.results.length<=3,true);
  }
  for(const result of [district,one,city]) {
    const area=get(result,'사하구 하단2동');
    assert(area);
    assert.deepEqual([area.score,area.scores,area.effectiveWeights,area.historyContext],
      [get(pair,'사하구 하단2동').score,get(pair,'사하구 하단2동').scores,
        get(pair,'사하구 하단2동').effectiveWeights,get(pair,'사하구 하단2동').historyContext]);
  }
  assert.equal(countQueries,4);
  assert(pair.results.every(row=>row.name.startsWith('사하구 하단')));
  assert(one.results.length===1&&one.results[0].score!==null);
});

function dispatch(url, method='GET', data) {
  return new Promise(resolve => {
    const req = Readable.from(data?[JSON.stringify(data)]:[]);
    req.url=url; req.method=method;
    const response={status:0,setHeader(){},writeHead(status){this.status=status;return this;},end(content=''){resolve({status:this.status,content:String(content)});return this;}};
    server.emit('request',req,response);
  });
}
test('헬스 체크와 잘못된 추천 요청', async () => {
  assert.equal(JSON.parse((await dispatch('/api/health')).content).openaiConfigured, true);
  assert.equal((await dispatch('/api/missing')).status,404);
  assert.equal((await dispatch('/api/analyze','POST',{prompt:''})).status,422);
});

test('restored all-industry history is shown for selected areas without changing industry scores', async()=>{
  const input={prompt:'카페',conditions};
  const baseline=await analyze(input,repository);
  const restored=await analyze(input,{
    ...repository,
    loadAreaContexts:async selectedAreas=>{
      assert.equal(selectedAreas.length,areas.length);
      return {history:new Map(selectedAreas.map(area=>[`${area.district_name}\0${area.dong_name}`,{
        scope:'행정동 전체 업종',averageOperatingMonths:80.8,permitRecords:4253,closureRecords:1985,
        eventTrend:[{month:'1968-01',openings:1,closures:0},{month:'2023-05',openings:10,closures:5}]
      }])),markets:new Map(),historyQueryMs:1,changeQueryMs:0};
    }
  });
  assert.deepEqual(restored.results.map(row=>[row.name,row.score,row.scores]),baseline.results.map(row=>[row.name,row.score,row.scores]));
  assert(restored.results.every(row=>row.historyContext.permitRecords===4253));
  assert(restored.results.every(row=>row.historyContext.closureRecords===1985));
  assert(restored.results.every(row=>row.scores.stability===null && row.scores.growth===null));
});

test('whole-area stability and growth affect ranking before region filtering without hiding lifetime counts',async()=>{
  const {applyAreaHistoryScores}=await import('./recommendation-context-db.js');
  const scoredRepository={...repository,loadAreaContexts:async selectedAreas=>{
    assert.equal(selectedAreas.length,areas.length);
    const history=new Map(selectedAreas.map((area,i)=>[`${area.district_name}\0${area.dong_name}`,{
      scope:'행정동 전체 업종',records:100,validSample:10,averageOperatingMonths:20+i*30,
      permitRecords:1000+i,closureRecords:500+i,eventTrend:[{month:'2023-05',openings:[2,6,9][i],closures:[8,4,1][i]}]
    }]));
    return {history:applyAreaHistoryScores(history),markets:new Map(),historyQueryMs:1,changeQueryMs:0};
  }};
  const preferences={...conditions,stability:'important',growth:'important'};
  const city=await analyze({prompt:'카페',conditions:{...preferences,region:'부산 전체'}},scoredRepository);
  const single=await analyze({prompt:'카페',conditions:{...preferences,region:'해운대구 우1동'}},scoredRepository);
  const reference=city.results.find(row=>row.name==='해운대구 우1동');
  assert.deepEqual(single.results[0].scores,reference.scores);
  assert.equal(single.results[0].score,reference.score);
  assert.deepEqual(single.results[0].historyContext.growthPeriod,reference.historyContext.growthPeriod);
  for(const row of city.results) {
    assert(Number.isFinite(row.scores.stability));
    assert(Number.isFinite(row.scores.growth));
    assert(row.effectiveWeights.stability>0);
    assert(row.effectiveWeights.growth>0);
    assert.equal(Object.values(row.effectiveWeights).reduce((s,v)=>s+v,0),100);
    assert(row.historyContext.permitRecords>=1000);
  }
  assert.deepEqual(city.preferenceSummary.applied.map(item=>item.key),['lowCompetition','stability','growth']);
});

test('independent store counts and history load concurrently without changing recommendations',async()=>{
  let historyStarted=false;
  const baseline=await analyze({prompt:'카페',conditions},repository);
  const parallel=await analyze({prompt:'카페',conditions},{
    ...repository,
    loadIndustryCounts:async(...args)=>{
      await Promise.resolve();
      assert.equal(historyStarted,true);
      return repository.loadIndustryCounts(...args);
    },
    loadAreaContexts:async(...args)=>{
      historyStarted=true;
      return repository.loadAreaContexts(...args);
    },
  });
  assert.deepEqual(parallel.results,baseline.results);
});

test('map config exposes only the browser JavaScript key',async()=>{
  const previous=process.env.KAKAO_JAVASCRIPT_KEY;
  process.env.KAKAO_JAVASCRIPT_KEY='fixture-public-javascript-key';
  try {
    const response=await dispatch('/api/map-config');
    assert.equal(response.status,200);
    assert.deepEqual(JSON.parse(response.content),{kakaoJavascriptKey:'fixture-public-javascript-key'});
    delete process.env.KAKAO_JAVASCRIPT_KEY;
    assert.deepEqual(JSON.parse((await dispatch('/api/map-config')).content),{kakaoJavascriptKey:''});
  }finally{if(previous===undefined)delete process.env.KAKAO_JAVASCRIPT_KEY;else process.env.KAKAO_JAVASCRIPT_KEY=previous;}
});
