const defaults = { industry: '', region: '부산 전체', months: 12, competition: 'normal', stability: 'normal', growth: 'normal', populationRequested: false, budget: null };
const schema = { type: 'object', additionalProperties: false, required: Object.keys(defaults), properties: {
  industry: { type: 'string' }, region: { type: 'string' }, months: { type: 'integer' },
  competition: { type: 'string', enum: ['low', 'normal', 'any'] }, stability: { type: 'string', enum: ['normal', 'important'] },
  growth: { type: 'string', enum: ['normal', 'important'] }, populationRequested: { type: 'boolean' }, budget: { type: ['number', 'null'] }
} };
export class InputError extends Error { constructor(message, choices = []) { super(message); this.choices = choices; } }
export class ConditionServiceError extends Error { constructor(message) { super(message); this.name = 'ConditionServiceError'; } }
export function validate(input,{allowMissingIndustry=false}={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('분석 조건을 확인해 주세요.');
  const c = { ...defaults, ...input };
  for (const field of ['industry', 'region']) if (typeof c[field] !== 'string' || c[field].length > 100) throw new InputError(`${field} 조건이 올바르지 않습니다.`);
  c.industry = c.industry.trim(); c.region = c.region.trim() || '부산 전체';
  if (!c.industry && !allowMissingIndustry) throw new InputError('어떤 업종을 생각하고 계신가요? 업종을 입력해 주세요.');
  if (!['low','normal','any'].includes(c.competition) || !['normal','important'].includes(c.stability) || !['normal','important'].includes(c.growth)) throw new InputError('선호 조건이 올바르지 않습니다.');
  if (typeof c.populationRequested !== 'boolean') throw new InputError('인구 지표 선호 조건이 올바르지 않습니다.');
  if (!Number.isInteger(c.months) || c.months < 1 || c.months > 36) throw new InputError('분석 기간은 1~36개월로 입력해 주세요.');
  if (c.budget !== null && (!Number.isFinite(c.budget) || c.budget < 0)) throw new InputError('예산을 확인해 주세요.');
  return Object.fromEntries(Object.keys(defaults).map(k => [k, c[k]]));
}
export async function parseConditions(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new ConditionServiceError('AI 조건 추출 설정을 확인해 주세요.');
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'system', content: '부산 창업 희망 조건만 추출한다. 지역명과 업종은 사용자의 표현 그대로 쓰고 행정동 범위나 업종 코드를 추측하지 않는다. 존재하지 않거나 불확실해 보이는 동 이름도 지역 표현이 있으면 원문대로 region에 넣는다. 지역이 없거나 상관없으면 부산 전체, 업종이 없으면 빈 문자열, 기간 언급이 없으면 months=12, 예산 언급이 없으면 budget=null. 경쟁 부담을 낮추고 싶다고 명시한 경우만 competition=low, 경쟁을 신경 쓰지 않는다고 명시한 경우만 any, 그 외에는 normal. 안정성을 중요하게 말한 경우만 stability=important, 그 외에는 normal. 성장성을 중요하게 말한 경우만 growth=important, 그 외에는 normal. 인구·유동인구를 요청한 경우만 populationRequested=true, 그 외에는 false. 사용자가 말하지 않은 선호를 추가하지 않는다. 수치나 추천 근거를 만들지 않는다.' }, { role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { name: 'business_conditions', strict: true, schema } } })
    });
  } catch { throw new ConditionServiceError('AI 조건 분석에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new ConditionServiceError(`AI 조건 분석 실패 (${response.status})`);
  try {
    const extracted = JSON.parse((await response.json()).choices?.[0]?.message?.content);
    let conditions;
    try { conditions = validate(extracted,{allowMissingIndustry:true}); }
    catch (error) {
      if (error instanceof InputError) error.extractedConditions = {industry:extracted?.industry ?? '',region:extracted?.region ?? '부산 전체'};
      throw error;
    }
    if (conditions.region === '부산 전체' && /(?:구|군|동|읍|면)(?:에서|에|근처|주변|일대|\s)/.test(prompt) && !/지역\s*상관없이|지역\s*무관/.test(prompt))
      throw new InputError('입력한 지역을 AI가 확인하지 못했습니다. 부산의 구 또는 행정동을 구체적으로 입력해 주세요.');
    return conditions;
  }
  catch (error) { if (error instanceof InputError) throw error; throw new ConditionServiceError('AI가 조건을 해석하지 못했습니다. 다시 입력해 주세요.'); }
}
