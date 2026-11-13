import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.DATA_GO_KR_SERVICE_KEY='fixture-public';
const {analyze}=await import('./server.js');
const wrap=rows=>new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:rows.length}}}));
const zones=[
  {trarNo:'101',mainTrarNm:'서면 중앙',ctprvnCd:'26',signguCd:'26230',signguNm:'부산진구',adongCd:'26230100'},
  {trarNo:'103',mainTrarNm:'해운대 해변',ctprvnCd:'26',signguCd:'26350',signguNm:'해운대구'}
];
const row=(code,i)=>({bizesId:code+'-'+i,adongCd:code,adongNm:code==='26230100'?'부전1동':'부전2동',signguCd:'26230',signguNm:'부산진구',indsSclsCd:i<2?'I21201':'I29999',stdrYm:'202601'});
test('상권 내 점포의 동 필드가 비어도 상권 코드와 시군구 탐색으로 후보 카드를 만든다',async()=>{
  globalThis.fetch=async input=>{
    const url=new URL(input),route=url.pathname,key=url.searchParams.get('key');
    if(route.endsWith('/storeZoneInAdmi')) return wrap(zones);
    if(route.endsWith('/smallUpjongList')) return wrap([{indsSclsCd:'I21201',indsSclsNm:'카페'}]);
    if(route.endsWith('/storeListInArea')) return wrap([{bizesId:'A'}]);
    if(route.endsWith('/storeListInDong')) {
      if(url.searchParams.get('divId')==='signguCd') return wrap([row('26230100',0),row('26230101',0)]);
      const all=Array.from({length:key==='26230100'?10:16},(_,i)=>row(key,i));
      return wrap(url.searchParams.has('indsSclsCd')?all.filter(r=>r.indsSclsCd==='I21201'):all);
    }
    if(route.endsWith('/getCommercialChangeList')||route.endsWith('/getCommercialHistoryList')) return wrap([]);
    throw new Error('unexpected fixture route');
  };
  const result=await analyze({prompt:'fixture',conditions:{industry:'카페',region:'서면'}});
  assert.deepEqual(result.results.map(r=>r.name).sort(),['부산진구 부전1동','부산진구 부전2동']);
  assert(result.results.every(r=>r.metrics.industryStores===2));
  assert(result.results.every(r=>r.score!==null));
});
test('점포 표본에 동 코드가 전혀 없으면 공식 행정경계 목록으로 같은 구 후보를 찾는다',async()=>{
  globalThis.fetch=async input=>{
    const url=new URL(input),route=url.pathname,key=url.searchParams.get('key');
    if(route.endsWith('/storeListInArea')) return wrap([{bizesId:'A'}]);
    if(route.endsWith('/storeListInDong')) {
      if(url.searchParams.get('divId')==='signguCd') return wrap([]);
      const all=Array.from({length:key==='26350100'?10:16},(_,i)=>({...row(key,i),signguCd:'26350',signguNm:'해운대구',adongNm:key==='26350100'?'우1동':'우2동'}));
      return wrap(url.searchParams.has('indsSclsCd')?all.filter(r=>r.indsSclsCd==='I21201'):all);
    }
    if(route.endsWith('/baroApi')) {
      assert.equal(url.searchParams.get('resId'),'dong');
      assert.equal(url.searchParams.get('catId'),'admi');
      return wrap(['26350100','26350101'].map((code,i)=>({ctprvnCd:'26',signguCd:'26350',signguNm:'해운대구',adongCd:code,adongNm:i?'우2동':'우1동'})));
    }
    if(route.endsWith('/getCommercialChangeList')||route.endsWith('/getCommercialHistoryList')) return wrap([]);
    throw new Error('unexpected fixture route');
  };
  const result=await analyze({prompt:'fixture',conditions:{industry:'카페',region:'해운대'}});
  assert.deepEqual(result.results.map(r=>r.name).sort(),['해운대구 우1동','해운대구 우2동']);
  assert(result.results.every(r=>r.score!==null));
});
