import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisOptionsLoader,validateAnalysisRequest} from './analysis-options.js';
import {resolveDbIndustry} from './industry-match.js';

const metadata={areas:[{district_name:'중구',dong_name:'중앙동',total:10},{district_name:'강서구',dong_name:'중앙동',total:20}],
  industries:[{industry_code:'I21201',industry_name:'카페'},{industry_code:'S20701',industry_name:'미용실'}],coverage:{total:30}};
test('option metadata includes qualified dongs and codes without store counts or secrets',async()=>{
  const data=await createAnalysisOptionsLoader(async()=>metadata)();
  assert.deepEqual(data.industries.find(item=>item.label==='카페'),{value:'I21201',label:'카페'});
  assert.ok(data.regions.some(item=>item.value==='부산 전체'));
  assert.ok(data.regions.some(item=>item.value==='중구 중앙동'));
  assert.ok(data.regions.some(item=>item.value==='강서구 중앙동'));
  assert.ok(!JSON.stringify(data).includes('total'));
});
test('options share concurrent metadata requests, expire, and retry failed DB queries',async()=>{
  let count=0,time=0,fail=false;
  const load=createAnalysisOptionsLoader(async()=>{count++;if(fail)throw Error('DB unavailable');return metadata;},{now:()=>time,ttl:10});
  const [first,second]=await Promise.all([load(),load()]);
  assert.equal(first,second);assert.equal(count,1);
  await load();assert.equal(count,1);
  time=11;fail=true;await assert.rejects(load);assert.equal(count,2);
  fail=false;await load();assert.equal(count,3);
});
test('structured analysis accepts conditions without a synthetic prompt and validates preference enums',()=>{
  const input=validateAnalysisRequest({conditions:{industry:'I21201',region:'중구 중앙동',competition:'low',stability:'important',growth:'normal'}});
  assert.equal(input.prompt,undefined);assert.equal(input.conditions.industry,'I21201');
  for(const bad of [null,[],{prompt:''},{conditions:null},{conditions:{industry:''}},{conditions:{industry:'카페',competition:'high'}}])
    assert.throws(()=>validateAnalysisRequest(bad));
  assert.equal(validateAnalysisRequest({prompt:'카페를 창업하고 싶어요'}).prompt,'카페를 창업하고 싶어요');
});
test('explicit DB industry codes disambiguate identical names and reject nonexistent codes',()=>{
  const rows=[{industry_code:'I21201',industry_name:'같은 이름'},{industry_code:'I21202',industry_name:'같은 이름'}];
  assert.throws(()=>resolveDbIndustry('같은 이름',rows));
  assert.deepEqual(resolveDbIndustry('I21202',rows).codes,['I21202']);
  assert.throws(()=>resolveDbIndustry('I99999',rows));
});

process.env.NODE_ENV='test';
const {analyze,server}=await import('./server.js');
test('selected conditions reuse analysis without calling AI and preserve the exact dong',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('structured analysis must not call AI or external lookup');};
  try{
    const result=await analyze(validateAnalysisRequest({conditions:{industry:'I21201',region:'중구 중앙동',competition:'low',stability:'normal',growth:'normal'}}),{
      loadRecommendationData:async()=>metadata,
      loadIndustryCounts:async(codes,areas)=>{assert.deepEqual(codes,['I21201']);return areas.map((area,index)=>({...area,selected:index+1}));},
      loadAreaContexts:async()=>({history:new Map(),historyQueryMs:0,changeQueryMs:0})
    });
    assert.equal(result.matchedIndustry,'카페');assert.equal(result.results.length,1);
    assert.equal(result.results[0].name,'중구 중앙동');assert.equal(result.conditions.competition,'low');
  }finally{globalThis.fetch=previous;}
});
test('option endpoint rejects writes and malformed structured requests return 422',async()=>{
  const {Readable}=await import('node:stream');
  async function dispatch(url,body){
    const req=Readable.from([JSON.stringify(body)]);req.url=url;req.method='POST';
    return new Promise(resolve=>{const response={setHeader(){},writeHead(status){this.status=status;},end(value){resolve({status:this.status,data:JSON.parse(value)});}};server.emit('request',req,response);});
  }
  assert.equal((await dispatch('/api/analysis-options',{})).status,405);
  assert.equal((await dispatch('/api/analyze',{conditions:{industry:''}})).status,422);
});
