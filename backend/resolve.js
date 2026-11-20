import { InputError } from './conditions.js';
const compact = value => String(value || '').replace(/\s|부산광역시|부산시|부산/g, '').replace(/(근처|일대|주변|에서|전체)$/,'').trim();

export function resolveRegion(region, allZones) {
  const name = compact(region);
  if (!name || name === '전체') return { zones: allZones.slice(0, 10), label: '부산 전체 (최대 10개 비교)', scope: 'city' };
  const districts = [...new Map(allZones.map(z => [String(z.signguCd), z.signguNm])).entries()].filter(([code, label]) => code && label);
  const district = districts.filter(([, label]) => compact(label) === name || compact(label).replace(/구$/, '') === name);
  if (district.length === 1) return { zones: allZones.filter(z => String(z.signguCd) === district[0][0]).slice(0, 10), label: district[0][1], scope: 'district' };
  const matches = allZones.filter(z => compact(z.mainTrarNm).includes(name));
  if (matches.length) return { zones: matches.slice(0, 10), label: region, scope: 'zone' };
  throw new InputError(`“${region}”에 해당하는 부산 상권을 확인할 수 없습니다. 지역을 더 구체적으로 입력해 주세요.`, districts.slice(0, 8).map(([, label]) => label));
}

export function resolveIndustry(industry, small, large) {
  const name = industry.replace(/\s/g, '');
  const aliases = name === '카페' ? ['카페', '커피전문점', '커피-음료'] : name === '음식점' ? ['음식점', '음식점업', '음식'] : [name];
  const exactSmall = small.filter(row => aliases.includes(String(row.indsSclsNm || '').replace(/\s/g, '')));
  if (exactSmall.length === 1) return { filter: { indsSclsCd: exactSmall[0].indsSclsCd }, label: exactSmall[0].indsSclsNm, parent: exactSmall[0].indsMclsCd ? { code:exactSmall[0].indsMclsCd, label:exactSmall[0].indsMclsNm || '관련 중분류' } : null };
  const exactLarge = large.filter(row => aliases.includes(String(row.indsLclsNm || '').replace(/\s/g, '')));
  if (exactLarge.length === 1) return { filter: { indsLclsCd: exactLarge[0].indsLclsCd }, label: exactLarge[0].indsLclsNm };
  const possible = small.filter(row => aliases.some(word => String(row.indsSclsNm || '').replace(/\s/g, '').includes(word)));
  if (possible.length === 1) return { filter: { indsSclsCd: possible[0].indsSclsCd }, label: possible[0].indsSclsNm, parent: possible[0].indsMclsCd ? { code:possible[0].indsMclsCd, label:possible[0].indsMclsNm || '관련 중분류' } : null };
  throw new InputError(`“${industry}”에 맞는 업종 코드를 하나로 확인할 수 없습니다. 업종을 구체적으로 선택해 주세요.`, [...new Set(possible.map(row => row.indsSclsNm))].slice(0, 8));
}
