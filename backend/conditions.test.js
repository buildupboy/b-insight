import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConditions, ConditionServiceError, InputError } from './conditions.js';

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
    industry:'카페',region:'부산 전체',months:12,competition:'normal',stability:'normal',growth:'normal',populationRequested:false,budget:null,
  })}}]}));
  try {
    await assert.rejects(() => parseConditions('존재하지 않는 동에서 카페를 열고 싶어'), InputError);
    assert.equal((await parseConditions('지역 상관없이 카페를 열고 싶어')).region,'부산 전체');
  } finally {
    globalThis.fetch=oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=oldKey;
  }
});
