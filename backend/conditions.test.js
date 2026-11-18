import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConditions, validate, ConditionServiceError, InputError } from './conditions.js';

test('OpenAI 키가 없으면 설정 오류를 구체적으로 반환한다', async () => {
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try { await assert.rejects(() => parseConditions('카페 창업'), ConditionServiceError); }
  finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=old; }
});

test('명시한 지역을 AI가 부산 전체로 누락하면 추천을 중단한다', async () => {
  const oldKey=process.env.OPENAI_API_KEY, oldFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='fixture';
  globalThis.fetch=async () => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
    industry:'카페',region:'부산 전체',competition:'normal',stability:'normal',growth:'normal',populationRequested:false,budget:null,
  })}}]}));
  try {
    await assert.rejects(() => parseConditions('존재하지 않는 동에서 카페를 열고 싶어'), InputError);
    assert.equal((await parseConditions('지역 상관없이 카페를 열고 싶어')).region,'부산 전체');
  } finally {
    globalThis.fetch=oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=oldKey;
  }
});

test('자연어 추출 스키마와 기본 조건에 기간 필드가 없다', async () => {
  const oldKey=process.env.OPENAI_API_KEY, oldFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='fixture';
  globalThis.fetch=async (_url, options) => {
    const request=JSON.parse(options.body);
    const schema=request.response_format.json_schema.schema;
    assert.equal('months' in schema.properties,false);
    assert.equal(schema.required.includes('months'),false);
    assert.doesNotMatch(request.messages[0].content,/months|12개월|최근 1년/);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
      industry:'카페',region:'부산진구',competition:'normal',stability:'normal',growth:'normal',populationRequested:false,budget:null,
    })}}]}));
  };
  try {
    const conditions=await parseConditions('부산진구에서 카페를 열고 싶어');
    assert.equal(conditions.region,'부산진구');
    assert.equal(conditions.industry,'카페');
    assert.equal('months' in conditions,false);
    assert.deepEqual(validate({...conditions,months:12}),conditions);
    assert.deepEqual(validate({...conditions,months:'invalid'}),conditions);
  } finally {
    globalThis.fetch=oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=oldKey;
  }
});
