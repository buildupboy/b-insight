import { InputError } from './conditions.js';

const normalized = value => String(value ?? '').replace(/\s+/g, '').trim();
const aliases = new Map([
  ['헤어샵', { code:'S20701' }], ['헤어숍', { code:'S20701' }],
  ['커피숍', { code:'I21201' }], ['커피전문점', { code:'I21201' }],
  ['네일샵', { code:'S20703' }],
  ['분식집', { code:'I21007' }],
  ['한식집', { prefix:'I201', label:'한식 업종 전체' }],
  ['한식음식점', { prefix:'I201', label:'한식 업종 전체' }],
  ['음식점', { prefix:'I2', label:'음식점업 대분류 전체' }],
  ['식당', { prefix:'I2', label:'음식점업 대분류 전체' }],
]);

export class IndustryMatchError extends InputError {
  constructor(message, choices = []) {
    super(message, choices);
    this.choiceType = 'industry';
  }
}

export function resolveDbIndustry(requested, rows) {
  const name = normalized(requested);
  if (!name) throw new IndustryMatchError('어떤 업종을 생각하고 계신가요? 업종을 입력해 주세요.');
  const valid = rows.filter(row => /^[A-Za-z][0-9]{5}$/.test(row.industry_code) && normalized(row.industry_name));
  const exact = valid.filter(row => normalized(row.industry_name) === name);
  let matches = exact, label = exact[0]?.industry_name, scope = 'small';
  if (!matches.length && aliases.has(name)) {
    const alias = aliases.get(name);
    matches = valid.filter(row => alias.code ? row.industry_code === alias.code : row.industry_code.startsWith(alias.prefix));
    label = alias.label || matches[0]?.industry_name;
    scope = alias.prefix ? 'group' : 'small';
  }
  const codes = [...new Set(matches.map(row => row.industry_code))];
  if (codes.length && (scope === 'group' || codes.length === 1)) {
    return { codes, label, scope, filter:codes.length === 1 ? { indsSclsCd:codes[0] } : { indsSclsCds:codes },
      note:scope === 'group' ? `“${name}”은 DB의 ${codes.length}개 세부 업종 코드를 묶은 ${label} 기준입니다. 카페·간이음식·주점도 포함될 수 있습니다.` : null };
  }
  const possible = valid.filter(row => normalized(row.industry_name).includes(name) || (name.length > 2 && name.includes(normalized(row.industry_name))));
  const choices = [...new Set(possible.map(row => row.industry_name))].slice(0, 8);
  throw new IndustryMatchError(`“${requested}”에 맞는 DB 업종 코드를 확인할 수 없습니다. 업종을 구체적으로 선택해 주세요.`, choices);
}
