const defaults = { industry: '', region: '부산 전체', months: 12, competition: 'normal', stability: 'normal', growth: 'normal', budget: null };
const schema = { type: 'object', additionalProperties: false, required: Object.keys(defaults), properties: {
  industry: { type: 'string' }, region: { type: 'string' }, months: { type: 'integer' },
  competition: { type: 'string', enum: ['low', 'normal', 'any'] }, stability: { type: 'string', enum: ['normal', 'important'] },
  growth: { type: 'string', enum: ['normal', 'important'] }, budget: { type: ['number', 'null'] }
} };
export class InputError extends Error { constructor(message, choices = []) { super(message); this.choices = choices; } }
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('분석 조건을 확인해 주세요.');
  const c = { ...defaults, ...input };
  for (const field of ['industry', 'region']) if (typeof c[field] !== 'string' || c[field].length > 100) throw new InputError(`${field} 조건이 올바르지 않습니다.`);
  c.industry = c.industry.trim(); c.region = c.region.trim() || '부산 전체';
  if (!c.industry) throw new InputError('어떤 업종을 생각하고 계신가요? 업종을 입력해 주세요.');
  if (!['low','normal','any'].includes(c.competition) || !['normal','important'].includes(c.stability) || !['normal','important'].includes(c.growth)) throw new InputError('선호 조건이 올바르지 않습니다.');
  if (!Number.isInteger(c.months) || c.months < 1 || c.months > 36) throw new InputError('분석 기간은 1~36개월로 입력해 주세요.');
  if (c.budget !== null && (!Number.isFinite(c.budget) || c.budget < 0)) throw new InputError('예산을 확인해 주세요.');
  return Object.fromEntries(Object.keys(defaults).map(k => [k, c[k]]));
}
export async function parseConditions(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'system', content: '부산 창업 희망 조건만 추출한다. 지역명은 사용자의 표현 그대로 쓰고 코드나 좌표를 추측하지 않는다. 업종이 없으면 빈 문자열, 지역이 없으면 부산 전체. 기간 기본 12개월. 경쟁 낮음=low, 상관없음=any. 수치나 추천 근거를 만들지 않는다.' }, { role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { name: 'business_conditions', strict: true, schema } } })
    });
  } catch { throw new Error('AI 조건 분석에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new Error(`AI 조건 분석 실패 (${response.status})`);
  try { return validate(JSON.parse((await response.json()).choices?.[0]?.message?.content)); }
  catch (error) { if (error instanceof InputError) throw error; throw new Error('AI가 조건을 해석하지 못했습니다. 다시 입력해 주세요.'); }
}
