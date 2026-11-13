import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_GO_KR_SERVICE_KEY = 'fixture%2Bkey';
process.env.NODE_ENV = 'test';
const { request, pages, deduplicate, dongStores, history: allHistory, changes, DataApiError } = await import('./data.js');
const semas = 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const change = 'https://apis.data.go.kr/6260000/BusanCommercialChangeService';
const history = 'https://apis.data.go.kr/6260000/BusanCommercialHistoryService';
const wrap = (items,total=items.length) => new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:items},totalCount:total}}}),{headers:{'Content-Type':'application/json'}});
test('행정동 조회는 검증된 코드와 소진공 업종 필터만 보내고 점포 ID를 중복 제거한다',async()=>{
  globalThis.fetch=async url=>{
    assert(url.pathname.endsWith('/storeListInDong'));
    assert.equal(url.searchParams.get('servicekey'),'fixture+key');
    assert.equal(url.searchParams.get('divId'),'adongCd');
    assert.equal(url.searchParams.get('key'),'2623010000');
    assert.equal(url.searchParams.get('indsSclsCd'),'I21201');
    return wrap([{bizesId:'A',adongCd:'2623010000',adongNm:'부전1동',indsSclsCd:'I21201',stdrYm:'202601'}]);
  };
  const result=await dongStores('2623010000',{indsSclsCd:'I21201'});
  assert.equal(result.rows[0].adongNm,'부전1동');
  assert.equal(result.rows[0].bizesId,'A');
  assert.throws(()=>dongStores('10183'));
});
test('제공처가 요청한 페이지 크기보다 적게 반환해도 totalCount까지 다음 페이지를 읽는다',async()=>{
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    assert.equal(url.searchParams.get('numOfRows'),'1000');
    const page=Number(url.searchParams.get('pageNo'));
    return wrap([{bizesId:String(page),adongCd:'26230100',adongNm:'부전1동',stdrYm:'202601'}],3);
  };
  const result=await dongStores('26230100');
  assert.equal(calls,3);
  assert.equal(result.rows.length,3);
  assert.equal(result.truncated,false);
});

test('세 서비스의 단일·배열·빈 JSON에서 필요한 필드만 선택한다', async () => {
  globalThis.fetch = async url => {
    assert.equal(url.searchParams.get(url.pathname.includes('Commercial') ? 'serviceKey' : 'ServiceKey'),'fixture+key');
    if (url.pathname.endsWith('storeListInArea')) return wrap({bizesId:'A',stdrYm:'202601',bizesNm:'삭제할 상호'} ,1);
    if (url.pathname.endsWith('getCommercialChangeList')) return wrap([{comm_nm:'서면',average_open_months:'24',unknown:'skip'}]);
    return wrap([]);
  };
  const store = await request(semas,'/storeListInArea',{key:'101',pageNo:1,numOfRows:100,type:'json'},'ServiceKey');
  assert.deepEqual(store.rows,[{bizesId:'A',stdrYm:'202601'}]);
  const metric = await request(change,'/getCommercialChangeList',{pageNo:1,numOfRows:100,resultType:'json'},'serviceKey');
  assert.deepEqual(metric.rows,[{comm_nm:'서면',average_open_months:'24'}]);
  const empty = await request(history,'/getCommercialHistoryList',{pageNo:1,numOfRows:100,resultType:'json'},'serviceKey');
  assert.deepEqual(empty.rows,[]);
});
test('XML 인증 오류, HTML, 빈 본문, 잘못된 JSON을 구체적으로 진단하며 본문을 노출하지 않는다', async () => {
  const cases = [
    [new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>',{headers:{'Content-Type':'text/xml'}}),'xml'],
    [new Response('<html>secret page</html>',{status:502,headers:{'Content-Type':'text/html'}}),'html'],
    [new Response('',{headers:{'Content-Type':'text/plain'}}),'empty'],
    [new Response('{bad',{headers:{'Content-Type':'application/json'}}),'invalid-json']
  ];
  for (const [response,format] of cases) {
    globalThis.fetch = async () => response;
    await assert.rejects(() => request(semas,'/storeListInArea',{key:'101'},'ServiceKey'),error => {
      assert(error instanceof DataApiError);
      assert.equal(error.diagnostic.format,format);
      assert.deepEqual(error.diagnostic.parameterNames,['ServiceKey','key']);
      assert(!JSON.stringify(error).includes('secret page'));
      assert(!JSON.stringify(error).includes('fixture+key'));
      return true;
    });
  }
});
test('HTTP 200 내부 오류 코드와 잘못된 키 응답도 성공으로 처리하지 않는다', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({response:{header:{resultCode:'22',resultMsg:'INVALID_REQUEST_PARAMETER_ERROR'}}}),{status:200});
  await assert.rejects(() => request(semas,'/storeListInArea',{key:'101'},'ServiceKey'),error => error.diagnostic.code === '22' && error.diagnostic.status === 200);
});
test('페이지 경계 중복 점포는 한 번만 유지하고 불완전한 수치를 표시한다', async () => {
  globalThis.fetch = async url => Number(url.searchParams.get('pageNo')) === 1
    ? wrap(Array.from({length:100},(_,i)=>({bizesId:`S${i}`})),102)
    : wrap([{bizesId:'S99'},{bizesId:'S100'}],102);
  const result = await pages(semas,'/storeListInArea',{key:'101',type:'json'},'ServiceKey',3);
  assert.equal(result.rows.length,101); assert.equal(result.duplicates,1); assert.equal(result.truncated,true);
  assert.equal(result.total,102);
});
test('페이지 상한, 누락 ID, 서로 다른 이력 사건을 구별한다', async () => {
  globalThis.fetch = async () => wrap(Array.from({length:100},(_,i)=>({bizesId:String(i)})),500);
  const capped = await pages(semas,'/storeListInArea',{key:'101',type:'json'},'ServiceKey',2);
  assert(capped.truncated); assert.equal(capped.rows.length,100);
  const missing = deduplicate([{bizesId:'A'},{}],'storeListInArea');
  assert.equal(missing.missingIds,1);
  const events = [{rdnwhladdr:'부산진구',apvpermymd:'2020-01-01'}, {rdnwhladdr:'부산진구',dcbymd:'2021-01-01'}];
  assert.equal(deduplicate(events,'getCommercialHistoryList').rows.length,2);
});

test('history is fetched once as complete pages without the unsupported address filter',async()=>{
  const requested=[];
  globalThis.fetch=async url=>{
    requested.push(url);
    const page=Number(url.searchParams.get('pageNo'));
    assert.equal(url.searchParams.has('rdnwhladdr'),false);
    return page===1
      ? wrap(Array.from({length:1000},(_,i)=>({bplcnm:`B${i}`,rdnwhladdr:'district dong'})),1001)
      : wrap([{bplcnm:'B1000',rdnwhladdr:'district otherdong'}],1001);
  };
  const result=await allHistory();
  assert.equal(requested.length,2);
  assert.equal(result.total,1001);
  assert.equal(result.rawCount,1001);
  assert.equal(result.rows.length,1001);
  assert.equal(result.truncated,false);
});

test('change indicators continue through short pages when totalCount says more rows exist',async()=>{
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    const page=Number(url.searchParams.get('pageNo'));
    return page===1
      ? wrap(Array.from({length:10},(_,i)=>({comm_nm:`Z${i}`,average_open_months:24})),15)
      : wrap(Array.from({length:5},(_,i)=>({comm_nm:`Z${i+10}`,average_open_months:25})),15);
  };
  const result=await changes();
  assert.equal(calls,2);
  assert.equal(result.rawCount,15);
  assert.equal(result.truncated,false);
});
