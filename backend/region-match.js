import { InputError } from './conditions.js';

const otherProvinces = /^(?:서울(?:특별시|시)?|인천(?:광역시|시)?|대구(?:광역시|시)?|대전(?:광역시|시)?|광주(?:광역시|시)?|울산(?:광역시|시)?|세종(?:특별자치시|시)?|경기(?:도)?|경남|경상남도|경북|경상북도|전남|전라남도|전북|전북특별자치도|전라북도|충남|충청남도|충북|충청북도|강원(?:특별자치도|도)?|제주(?:특별자치도)?)(?:\s|$)/;
// Analysis areas, not precise commercial boundaries. Official Seomyeon (Jeonpo/Bujeon) district:
// https://www.bsjincf.or.kr/02_new/new03_view.asp?idx=3530
const regionAliases=[{
  names:['서면','서면역','서면 상권','서면역 상권'],district:'부산진구',
  dongs:['부전1동','부전2동','전포1동','전포2동'],
}];
const compact=value=>value.replace(/\s+/g,'');
const canonicalDong=value=>value.replace(/제(?=\d+동$)/,'');
export class RegionMatchError extends InputError {
  constructor(message, choices = []) {
    super(message, choices);
    this.choiceType = 'region';
  }
}

export function resolveDbRegion(requested, areas) {
  let name = String(requested ?? '').trim().replace(/(?:에서|근처|주변|일대)$/, '').trim();
  if (otherProvinces.test(name)) throw new RegionMatchError('현재 부산 지역 데이터만 지원합니다. 부산의 구·행정동을 입력해 주세요.');
  name = name.replace(/^부산(?:광역시)?(?:\s+|$)/, '').replace(/^부산시(?:\s+|$)/, '').replace(/\s+/g, ' ').trim();
  if (!name || name === '전체' || name === '지역 상관없이') return { label:'부산 전체', areas, scope:'city' };
  const districts = [...new Set(areas.map(row => row.district_name))];
  const district = districts.find(value => value === name || value.replace(/[구군]$/, '') === name);
  if (district) return { label:district, areas:areas.filter(row => row.district_name === district), scope:'district' };
  const parts = name.split(' ');
  const namedDistrict = parts.length > 1 ? districts.find(value => value === parts[0] || value.replace(/[구군]$/, '') === parts[0]) : districts.find(value => name.startsWith(value) && name.length > value.length);
  const dongName = namedDistrict ? (parts.length > 1 ? parts.slice(1).join(' ') : name.slice(namedDistrict.length).trim()) : name;
  const exact = areas.filter(row => (!namedDistrict || row.district_name === namedDistrict) && row.dong_name === dongName);
  if (exact.length === 1) return { label:`${exact[0].district_name} ${exact[0].dong_name}`, areas:exact, scope:'dong' };
  if (exact.length > 1) throw new RegionMatchError(`“${dongName}”이 여러 구에 있습니다. 구·동을 선택해 주세요.`, exact.map(row => `${row.district_name} ${row.dong_name}`));
  const alias=regionAliases.find(item=>item.names.some(value=>compact(value)===compact(dongName)));
  if (alias) {
    const matches=areas.filter(row=>row.district_name===alias.district && alias.dongs.includes(canonicalDong(row.dong_name)));
    if (namedDistrict && namedDistrict!==alias.district)
      throw new RegionMatchError(`“${dongName}”은 ${alias.district}의 비교 권역입니다. 지역을 선택해 주세요.`,matches.map(row=>`${row.district_name} ${row.dong_name}`));
    if (!matches.length) throw new RegionMatchError(`“${dongName}”에 연결된 행정동 데이터가 없습니다.`);
    const names=matches.map(row=>row.dong_name);
    return {label:`${alias.district} 서면 일대 (${names.join('·')})`,areas:matches,scope:'alias-group',
      note:`서면은 ${names.join(', ')}을 비교 범위로 각각 분석했습니다. 실제 상권 경계나 역 반경을 의미하지 않습니다.`};
  }
  if (dongName.endsWith('동')) {
    const stem = dongName.slice(0, -1);
    const numbered = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[1-9][0-9]*동$`);
    const matches = areas.filter(row => (!namedDistrict || row.district_name === namedDistrict) && numbered.test(row.dong_name));
    if (matches.length > 1) {
      const matchedDistricts = [...new Set(matches.map(row => row.district_name))];
      if (matchedDistricts.length > 1) throw new RegionMatchError(`“${dongName}”에 해당하는 행정동이 여러 구에 있습니다. 구·동을 선택해 주세요.`, matches.map(row => `${row.district_name} ${row.dong_name}`));
      return { label:`${matchedDistricts[0]} ${dongName}`, areas:matches, scope:'dong-group',
        note:`${dongName} 검색 결과: ${matches.map(row => row.dong_name).join(', ')}을 각각 분석했습니다.` };
    }
  }
  const error=new RegionMatchError(`“${name}”에 연결된 구·행정동을 찾지 못했습니다. 지역을 더 구체적으로 입력해 주세요.`);
  error.code='REGION_NOT_FOUND';
  throw error;
}
