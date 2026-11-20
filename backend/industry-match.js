import { InputError } from './conditions.js';

const normalized = value => String(value ?? '').replace(/\s+/g, '').trim();

// Verified against the code/name pairs currently stored in public.stores.
// A code is accepted only while its name still matches the observed taxonomy.
export const verifiedFoodFamilies = {
  I201: [
    ['I20101','백반/한정식'], ['I20102','국/탕/찌개류'], ['I20103','족발/보쌈'],
    ['I20104','전/부침개'], ['I20105','국수/칼국수'], ['I20106','냉면/밀면'],
    ['I20107','돼지고기 구이/찜'], ['I20108','소고기 구이/찜'], ['I20109','곱창 전골/구이'],
    ['I20110','닭/오리고기 구이/찜'], ['I20111','횟집'], ['I20112','해산물 구이/찜'],
    ['I20113','복 요리 전문'], ['I20199','기타 한식 음식점']
  ],
  I202: [['I20201','중국집'],['I20202','마라탕/훠궈']],
  I203: [['I20301','일식 회/초밥'],['I20302','일식 카레/돈가스/덮밥'],
    ['I20303','일식 면 요리'],['I20399','기타 일식 음식점']],
  I204: [['I20401','경양식'],['I20402','파스타/스테이크'],
    ['I20403','패밀리레스토랑'],['I20499','기타 서양식 음식점']],
  I205: [['I20501','베트남식 전문'],['I20599','기타 동남아식 전문']],
  I206: [['I20601','분류 안된 외국식 음식점']],
  I207: [['I20701','구내식당'],['I20702','뷔페']],
  I210: [['I21001','빵/도넛'],['I21002','떡/한과'],['I21003','피자'],
    ['I21004','버거'],['I21005','토스트/샌드위치/샐러드'],['I21006','치킨'],
    ['I21007','김밥/만두/분식'],['I21008','아이스크림/빙수'],
    ['I21099','그 외 기타 간이 음식점']]
};
const koreanFood = verifiedFoodFamilies.I201;
const preparedFood = Object.values(verifiedFoodFamilies).flat();
const aliases = new Map([
  ['헤어샵',{code:'S20701',name:'미용실'}], ['헤어숍',{code:'S20701',name:'미용실'}],
  ['커피숍',{code:'I21201',name:'카페'}], ['커피전문점',{code:'I21201',name:'카페'}],
  ['네일샵',{code:'S20703',name:'네일숍'}],
  ['스터디카페',{code:'R10202',name:'독서실/스터디 카페'}],
  ['분식집',{code:'I21007',name:'김밥/만두/분식'}],
  ['빵집',{code:'I21001',name:'빵/도넛'}], ['베이커리',{code:'I21001',name:'빵/도넛'}],
  ['제과점',{code:'I21001',name:'빵/도넛'}],
  ['한식집',{group:koreanFood,label:'한식 음식점 전체'}],
  ['한식음식점',{group:koreanFood,label:'한식 음식점 전체'}],
  ['음식점',{group:preparedFood,label:'음식점·간이음식 전체'}],
  ['식당',{group:preparedFood,label:'음식점·간이음식 전체'}]
]);

export class IndustryMatchError extends InputError {
  constructor(message, choices = []) {
    super(message, choices);
    this.choiceType = 'industry';
  }
}

function checkedRows(rows) {
  return rows.filter(row => /^[A-Za-z][0-9]{5}$/.test(row.industry_code) && normalized(row.industry_name));
}
function groupMatches(group, rows) {
  const expected = new Map(group);
  const families = new Set(group.map(([code])=>code.slice(0,4)));
  const inScope=row => group === preparedFood
    ? row.industry_code.startsWith('I2') && !/^I21[12]/.test(row.industry_code)
    : families.has(row.industry_code.slice(0,4));
  if (rows.some(row => inScope(row) && expected.get(row.industry_code) !== row.industry_name)) return [];
  const matches = rows.filter(row => expected.get(row.industry_code) === row.industry_name);
  if (matches.length !== group.length) return [];
  return matches;
}

export function resolveDbIndustry(requested, rows) {
  const name = normalized(requested);
  if (!name) throw new IndustryMatchError('어떤 업종을 생각하고 계신가요? 업종을 입력해 주세요.');
  const valid = checkedRows(rows);
  const exact = valid.filter(row => normalized(row.industry_name) === name);
  if (exact.length > 1) throw new IndustryMatchError(`“${requested}”은 DB에서 여러 코드로 사용됩니다. 업종 분류 확인이 필요합니다.`);
  let matches = exact, label = exact[0]?.industry_name, scope = 'small', note = null;
  if (!matches.length && aliases.has(name)) {
    const alias = aliases.get(name);
    if (alias.group) {
      matches = groupMatches(alias.group,valid);
      label = alias.label;
      scope = 'group';
      if (matches.length) note = name === '음식점' || name === '식당'
        ? '음식점·식당은 DB에서 확인된 식사·간이음식 업종 38개를 묶었습니다. 카페와 주점은 포함하지 않았습니다.'
        : '한식집은 DB에서 확인된 한식 음식점 업종 14개를 묶었습니다.';
    } else {
      matches = valid.filter(row => row.industry_code === alias.code && row.industry_name === alias.name);
      label = alias.name;
      if (matches.length && alias.code === 'I21001') note = '빵집·베이커리는 DB의 “빵/도넛” 업종 기준입니다.';
    }
  }
  const codes = [...new Set(matches.map(row => row.industry_code))];
  if (codes.length && (scope === 'group' || codes.length === 1)) {
    return { codes, label, scope, filter:codes.length === 1 ? { indsSclsCd:codes[0] } : { indsSclsCds:codes }, note };
  }
  const possible = valid.filter(row => normalized(row.industry_name).includes(name) ||
    (name.length > 2 && name.includes(normalized(row.industry_name))));
  const choices = [...new Set(possible.map(row => row.industry_name))].slice(0,8);
  throw new IndustryMatchError(`“${requested}”에 맞는 검증된 DB 업종을 찾지 못했습니다. 업종을 구체적으로 입력하거나 후보에서 선택해 주세요.`, choices);
}

function promptMentions(prompt, rows) {
  const text = normalized(prompt);
  const terms = [...new Set([...checkedRows(rows).map(row=>normalized(row.industry_name)),...aliases.keys()])]
    .filter(term=>term.length>1).sort((a,b)=>b.length-a.length);
  const hits=[];
  for (const term of terms) {
    let start=text.indexOf(term);
    while (start>=0) {
      const end=start+term.length;
      const suffix=text.slice(end);
      if ((!suffix || /^(?:을|를|이|가|은|는|으로|로|이나|나|또는|혹은|와|과|중|창업|열|차리|시작|하고|해|,)/.test(suffix)) &&
        !hits.some(hit=>start<hit.end && end>hit.start)) hits.push({term,start,end});
      start=text.indexOf(term,start+1);
    }
  }
  return hits.sort((a,b)=>a.start-b.start);
}

function explicitUnknownPhrase(prompt) {
  const text=String(prompt??'');
  const phrasePattern=/\s*([가-힣A-Za-z0-9][가-힣A-Za-z0-9\s/·-]{1,40}?)\s*(?:을|를)\s*(?:열|차리|창업|시작)/;
  const match=text.match(new RegExp(`(?:에서|에)${phrasePattern.source}`)) ?? text.match(new RegExp(`^${phrasePattern.source}`));
  const phrase=match?.[1]?.trim() ?? '';
  return ['가게','사업','점포','매장','업종'].includes(normalized(phrase)) ? '' : phrase;
}

export function resolveIndustryIntent(extracted, prompt, rows) {
  const mentions=promptMentions(prompt,rows);
  const classified=mentions.map(hit=>({...hit,match:resolveDbIndustry(hit.term,rows)}));
  const byCode=new Map();
  for (const hit of classified) {
    const codeKey=hit.match.codes.join(',');
    if (!byCode.has(codeKey)) byCode.set(codeKey,hit);
  }
  const distinct=[...byCode.values()];
  const alternative=classified.some((hit,index)=>index>0 &&
    hit.match.codes.join(',')!==classified[index-1].match.codes.join(',') &&
    /^(?:이나|나|또는|혹은|와|과|,)$/i.test(normalized(prompt).slice(classified[index-1].end,hit.start)));
  if (alternative || (!normalized(extracted) && distinct.length>1)) {
    const choices=[...new Set(distinct.map(hit=>hit.term))];
    throw new IndustryMatchError('여러 업종을 말씀하셨어요. 분석할 업종을 하나 선택해 주세요.',choices);
  }
  const requested=normalized(extracted) ? extracted : distinct[0]?.term ?? explicitUnknownPhrase(prompt);
  try {
    return { requested, match:resolveDbIndustry(requested,rows), recovered:!normalized(extracted) && Boolean(requested) };
  } catch(error) {
    if (error instanceof IndustryMatchError && requested) error.requestedIndustry=requested;
    throw error;
  }
}
