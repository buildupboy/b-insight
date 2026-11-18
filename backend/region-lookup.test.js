import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRegion} from './region-lookup.js';

const areas=[{district_name:'해운대구',dong_name:'우2동'},{district_name:'해운대구',dong_name:'우3동'},
  {district_name:'부산진구',dong_name:'부전1동'},{district_name:'부산진구',dong_name:'부전2동'},
  {district_name:'부산진구',dong_name:'전포1동'},{district_name:'부산진구',dong_name:'전포2동'}];
const place=dong=>({address:{country_code:'kr',city:'부산광역시',borough:'해운대구',suburb:dong}});

test('known names and Seomyeon aliases never call the external lookup',async()=>{
  const lookup=()=>assert.fail('unexpected geocoder request');
  assert.equal((await resolveRegion('해운대구 우2동',areas,lookup)).areas.length,1);
  assert.equal((await resolveRegion('서면',areas,lookup)).areas.length,4);
  await assert.rejects(()=>resolveRegion('서울 강남구',areas,lookup),/부산 지역 데이터만/);
});

test('unmatched place addresses map to current DB dongs and preserve requested district',async()=>{
  let query;
  const result=await resolveRegion('센텀시티',areas,async value=>{query=value;return [place('우제2동'),place('우제2동')];});
  assert.equal(query,'센텀시티');
  assert.deepEqual(result.areas,[areas[0]]);
  assert(result.label.includes('해운대구 우2동'));
  assert(result.attribution.url.includes('openstreetmap.org'));
  await assert.rejects(()=>resolveRegion('부산진구 센텀시티',areas,async()=>[place('우2동')]),/확인하지 못했습니다/);
});

test('ambiguous place or legal-dong matches offer existing region choices',async()=>{
  await assert.rejects(()=>resolveRegion('임의상권',areas,async()=>[place('우2동'),place('우3동')]),error=>{
    assert.deepEqual(error.choices,['해운대구 우2동','해운대구 우3동']);
    assert.equal(error.choiceType,'region');
    return true;
  });
  await assert.rejects(()=>resolveRegion('새로운역',areas,async()=>[place('우동')]),error=>error.choices.length===2);
});

test('foreign, unknown and unavailable place data do not invent a region',async()=>{
  await assert.rejects(()=>resolveRegion('없는상권',areas,async()=>[place('없는동'),{address:{...place('우2동').address,city:'서울특별시'}}]),/확인하지 못했습니다/);
  await assert.rejects(()=>resolveRegion('없는상권',areas,async()=>{throw new Error('network');}),/지역 검색에 연결할 수 없습니다/);
});

test('external place searches identify the app, cache responses and request only the place name',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;
    assert.equal(url.hostname,'nominatim.openstreetmap.org');
    assert.equal(url.searchParams.get('countrycodes'),'kr');
    assert.equal(url.searchParams.get('q'),'부산광역시 테스트역');
    assert.match(options.headers['User-Agent'],/B-insight/);
    return new Response(JSON.stringify([place('우2동')]));
  });
  const first=await resolveRegion('테스트역',areas);
  const second=await resolveRegion('테스트역',areas);
  assert.deepEqual(first.areas,second.areas);
  assert.equal(calls,1);
});
