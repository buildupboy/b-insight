import test from 'node:test';
import assert from 'node:assert/strict';
import {competitionQuery,kakaoSearchUrl,safeKakaoPlaceUrl,loadKakaoSdk} from '../frontend/src/kakao-map.mjs';

test('Kakao search links preserve the exact recommended dong and encode keyword text',()=>{
  const area={name:'해운대구 우2동'};
  assert.equal(competitionQuery(area,'카페'),'부산광역시 해운대구 우2동 카페');
  assert.equal(decodeURIComponent(new URL(kakaoSearchUrl(area,'카페')).pathname),'/link/search/부산광역시 해운대구 우2동 카페');
  assert.equal(competitionQuery(area,'백반/한정식'),'부산광역시 해운대구 우2동 백반 한정식');
  assert(!kakaoSearchUrl(area,'카페 & 디저트').includes('&'));
  assert.equal(safeKakaoPlaceUrl('https://place.map.kakao.com/123'),'https://place.map.kakao.com/123');
  assert.equal(safeKakaoPlaceUrl('javascript:alert(1)'),null);
  assert.equal(safeKakaoPlaceUrl('https://place.map.kakao.com.evil.test/123'),null);
});

test('Kakao SDK loads once with services enabled and only the public JavaScript key',async()=>{
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  let scripts=0;
  globalThis.window={};
  globalThis.document={createElement(){return {remove(){}};},head:{append(script){
    scripts++;
    const url=new URL(script.src);
    assert.equal(url.origin,'https://dapi.kakao.com');
    assert.equal(url.searchParams.get('appkey'),'fixture-public-key');
    assert.equal(url.searchParams.get('libraries'),'services');
    assert.equal(url.searchParams.get('autoload'),'false');
    queueMicrotask(()=>{window.kakao={maps:{services:{},load:callback=>callback()}};script.onload();});
  }}};
  try {
    const [a,b]=await Promise.all([loadKakaoSdk('fixture-public-key'),loadKakaoSdk('fixture-public-key')]);
    assert.equal(a,b);
    assert.equal(scripts,1);
  }finally{
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});
