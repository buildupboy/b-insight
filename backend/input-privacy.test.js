import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {hasSensitiveInput,privacyMessage} from '../shared/input-privacy.mjs';
import {InputError,parseConditions,validate} from './conditions.js';
import {validateAnalysisRequest} from './analysis-options.js';
process.env.NODE_ENV='test';
const {analyze,server}=await import('./server.js');

const sensitive=[
  '카페 창업, 연락처 010-1234-5678',
  '카페 창업 ０１０１２３４５６７８',
  '연락처 +82 10 1234 5678',
  '이메일 test.person@example.com',
  '이메일 test.person＠example.com',
  '전화 010\u200b12345678',
  '주민번호 900101-1234567',
  '계좌번호 123-456-789012',
  '카드 4111 1111 1111 1111',
  '비밀번호: test-only-secret',
  'API_KEY=test-only-secret',
  '제 이름은 홍길동이고 카페를 열고 싶어요',
  '해운대로 123에 살아요',
  '우동 123번지에서 카페를 열래요',
  '당뇨 진단받았고 카페를 열고 싶어요',
];
test('sensitive inputs are blocked without reflecting their contents',async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('must not transmit');};
  try {
    for(const prompt of sensitive){
      assert.equal(hasSensitiveInput(prompt),true,prompt);
      const safeError=error=>error instanceof InputError&&error.message===privacyMessage&&!error.extractedConditions;
      assert.throws(()=>validateAnalysisRequest({prompt}),safeError);
      assert.throws(()=>validate({industry:'카페',region:prompt}),safeError);
      await assert.rejects(()=>parseConditions(prompt),safeError);
      await assert.rejects(()=>analyze({prompt},{loadRecommendationData(){throw new Error('must not query DB');}}),safeError);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});

test('ordinary conditions, regional names and budgets remain usable',()=>{
  for(const prompt of ['부산진구 카페 경쟁 낮은 곳','해운대구 우1동 초밥집','남구 중국집 예산 5000만원','100000000원으로 미용실 창업','사하구 하단2동 편의점','수영구 치킨집 성장성 중요']){
    assert.equal(hasSensitiveInput(prompt),false,prompt);
    assert.equal(validateAnalysisRequest({prompt}).prompt,prompt);
  }
  assert.throws(()=>validateAnalysisRequest({conditions:{industry:'카페'},industryChoice:'이메일 a@example.com'}),InputError);
});

test('API rejects sensitive bodies with no-store, no external calls or reflected data',async()=>{
  const oldFetch=globalThis.fetch,oldInfo=console.info;
  const oldEnv=process.env.NODE_ENV;
  process.env.NODE_ENV='production';
  const logs=[];
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('must not transmit');};
  console.info=(...args)=>logs.push(args);
  try{
    for(const prompt of sensitive){
      const result=await new Promise(resolve=>{
        const req=Readable.from([JSON.stringify({prompt})]);
        req.url='/api/analyze';req.method='POST';
        const headers={};
        const res={setHeader(k,v){headers[k]=v;},writeHead(status){this.status=status;return this;},end(content){resolve({status:this.status,headers,body:JSON.parse(content)});}};
        server.emit('request',req,res);
      });
      assert.equal(result.status,422);
      assert.equal(result.headers['Cache-Control'],'no-store');
      assert.equal(result.body.error,privacyMessage);
      assert.equal(result.body.conditions,null);
      assert.deepEqual(result.body.choices,[]);
      assert(!JSON.stringify(result.body).includes(prompt));
    }
    assert.equal(calls,0);
    assert.equal(logs.length,sensitive.length);
    for(const args of logs){
      const entry=JSON.parse(args[0]);
      assert.deepEqual(Object.keys(entry).sort(),['event','status','timing']);
      assert.equal(entry.event,'recommendation_analyze');
      assert.equal(entry.status,422);
      assert(Object.values(entry.timing).every(value=>typeof value==='number'||value===null));
    }
    for(const prompt of sensitive)assert(!JSON.stringify(logs).includes(prompt));
  }finally{globalThis.fetch=oldFetch;console.info=oldInfo;process.env.NODE_ENV=oldEnv;}
});

test('LLM requests disable completion storage and sensitive output is not reflected',async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='test-only';
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(body.store,false);
    assert.equal(body.messages[1].content,'해운대구 카페');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({industry:'카페',region:'a@example.com'})}}]}));
  };
  try{await assert.rejects(()=>parseConditions('해운대구 카페'),error=>error.message===privacyMessage&&!error.extractedConditions);}
  finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
