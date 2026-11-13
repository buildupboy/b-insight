import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
process.env.NODE_ENV='test';
process.env.OPENAI_API_KEY='fixture-openai';
process.env.DATA_GO_KR_SERVICE_KEY='fixture-public';
const {analyze,server}=await import('./server.js');
const zones=[
  {trarNo:'101',mainTrarNm:'서면 중앙',ctprvnCd:'26',signguCd:'26230',signguNm:'부산진구',adongCd:'26230100'},
  {trarNo:'102',mainTrarNm:'서면 거리',ctprvnCd:'26',signguCd:'26230',signguNm:'부산진구',adongCd:'26230101'},
  {trarNo:'103',mainTrarNm:'해운대 해변',ctprvnCd:'26',signguCd:'26350',signguNm:'해운대구',adongCd:'26350100'},
  {trarNo:'104',mainTrarNm:'해운대 역',ctprvnCd:'26',signguCd:'26350',signguNm:'해운대구',adongCd:'26350101'}
];
const dongFor=zone=>zone==='101'?'26230100':zone==='102'?'26230101':zone==='103'?'26350100':'26350101';
const nameFor=code=>({'26230100':'부전1동','26230101':'부전2동','26350100':'우1동','26350101':'우2동'})[code];
const wrap=(rows,total=rows.length)=>new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:total}}}),{status:200});
globalThis.fetch=async(input,options)=>{
  const url=new URL(input),route=url.pathname;
  if(url.hostname==='api.openai.com') {
    assert.equal(options.headers.Authorization,'Bearer fixture-openai');
    const prompt=JSON.parse(options.body).messages[1].content;
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({industry:prompt.includes('카페')?'카페':'음식점',region:prompt.includes('서면')?'서면':'해운대',months:12,competition:'low',stability:'important',growth:'normal',budget:null})}}]}));
  }
  if(route.endsWith('/storeZoneInAdmi')) return wrap(zones);
  if(route.endsWith('/smallUpjongList')) return wrap([{indsSclsCd:'I21201',indsSclsNm:'카페'}]);
  if(route.endsWith('/largeUpjongList')) return wrap([{indsLclsCd:'I2',indsLclsNm:'음식점'}]);
  if(route.endsWith('/getCommercialChangeList')) return wrap(zones.map((zone,i)=>({comm_nm:zone.mainTrarNm,average_open_months:30+i*4})));
  if(route.endsWith('/getCommercialHistoryList')) return wrap([]);
  if(route.endsWith('/storeListInArea')||route.endsWith('/storeListInDong')) {
    const code=route.endsWith('/storeListInArea')?dongFor(url.searchParams.get('key')):url.searchParams.get('key');
    assert(code);
    const size=code.endsWith('00')?10:20;
    const filtered=url.searchParams.has('indsSclsCd')||url.searchParams.has('indsLclsCd');
    const rows=Array.from({length:size},(_,i)=>({bizesId:code+'-'+i,adongCd:code,adongNm:nameFor(code),signguCd:code.slice(0,5),signguNm:code.startsWith('26230')?'부산진구':'해운대구',indsSclsCd:i<size/4?'I21201':'I29999',indsLclsCd:'I2',stdrYm:'202601'}));
    return wrap(filtered&&url.searchParams.has('indsSclsCd')?rows.filter(r=>r.indsSclsCd==='I21201'):rows);
  }
  throw new Error('unexpected fixture operation');
};
test('서면 카페를 코드 입력 없이 행정동 2곳으로 비교하고 점수를 표시한다',async()=>{
  const result=await analyze({prompt:'부산 서면에서 카페를 열고 싶어요. 경쟁이 낮고 안정적인 곳을 추천해줘.'});
  assert.deepEqual(result.results.map(r=>r.id).sort(),['26230100','26230101']);
  assert(result.results.every(r=>r.score!==null&&r.name.startsWith('부산진구 ')));
  assert.deepEqual(result.results.map(r=>r.metrics.survivalContext).sort(),[30,34]);
  assert(result.results.every(r=>r.metrics.stability===r.metrics.survivalContext));
  assert(result.results.every(r=>(r.metrics.openings===0&&r.metrics.closures===0)||(r.metrics.openings===null&&r.metrics.closures===null)));
});
test('해운대 음식점도 행정동으로만 반환한다',async()=>{
  const result=await analyze({prompt:'해운대에서 음식점 창업을 고민 중이야. 최근 12개월 변화를 반영해줘.'});
  assert.deepEqual(result.results.map(r=>r.id).sort(),['26350100','26350101']);
});
test('모호한 지역은 지명 선택지를 반환한다',async()=>{
  await assert.rejects(()=>analyze({prompt:'x',conditions:{industry:'카페',region:'없는 지역'}}),error=>error.choices.includes('부산진구'));
});
function dispatch(url,method='GET',data) {
  return new Promise(resolve=>{
    const req=Readable.from(data?[JSON.stringify(data)]:[]);req.url=url;req.method=method;
    const response={status:0,headers:{},writeHead(status,headers={}){this.status=status;this.headers=headers;return this;},end(content=''){resolve({status:this.status,content:String(content),headers:this.headers});return this;}};
    server.emit('request',req,response);
  });
}
test('정적 루트, 헬스 체크, 알 수 없는 API와 잘못된 요청',async()=>{
  assert.equal((await dispatch('/')).status,200);
  assert.equal(JSON.parse((await dispatch('/api/health')).content).openaiConfigured,true);
  assert.equal((await dispatch('/api/missing')).status,404);
  assert.equal((await dispatch('/api/analyze','POST',{prompt:''})).status,422);
});
