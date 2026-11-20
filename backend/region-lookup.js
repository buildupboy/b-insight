import {setTimeout as delay} from 'node:timers/promises';
import {resolveDbRegion,RegionMatchError} from './region-match.js';

const cache=new Map();
let queue=Promise.resolve(),lastRequest=0;

async function searchPlaces(region) {
  const endpoint=process.env.REGION_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
  const key=`${endpoint}\n${region}`;
  const cached=cache.get(key);
  if(cached && cached.expiresAt>Date.now())return cached.promise;
  const entry={expiresAt:Date.now()+86400000};
  entry.promise=queue.then(async()=>{
    await delay(Math.max(0,1000-(Date.now()-lastRequest)));
    lastRequest=Date.now();
    const url=new URL(endpoint);
    url.search=new URLSearchParams({q:`부산광역시 ${region}`,format:'jsonv2',addressdetails:'1',countrycodes:'kr',limit:'5','accept-language':'ko'});
    const response=await fetch(url,{headers:{'User-Agent':'B-insight/1.0 (Busan commercial area analysis)'},signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Geocoder unavailable');
    const places=await response.json();
    if(!Array.isArray(places))throw new Error('Invalid geocoder result');
    return places;
  }).catch(error=>{if(cache.get(key)===entry)cache.delete(key);throw error;});
  queue=entry.promise.catch(()=>{});
  if(cache.size>=128)cache.delete(cache.keys().next().value);
  cache.set(key,entry);
  return entry.promise;
}

export async function resolveRegion(requested,areas,lookup=searchPlaces) {
  try {return resolveDbRegion(requested,areas);}
  catch(error){if(!(error instanceof RegionMatchError) || error.code!=='REGION_NOT_FOUND')throw error;}
  if(typeof requested!=='string' || requested.length>100)throw new RegionMatchError('지역명을 100자 이내로 입력해 주세요.');
  const region=requested.replace(/^부산(?:광역시|시)?(?:\s+|$)/,'').replace(/(?:에서|근처|주변|일대)$/,'').trim();
  let places;
  try {places=await lookup(region);}
  catch {throw new RegionMatchError('지역 검색에 연결할 수 없습니다. 구 또는 행정동을 입력하거나 잠시 후 다시 시도해 주세요.');}
  const districts=[...new Set(areas.map(row=>row.district_name))];
  const explicitDistrict=districts.find(district=>region.startsWith(district) || region.startsWith(`${district.replace(/[구군]$/,'')} `));
  const matches=new Map();
  for(const place of places){
    const address=place?.address;
    if(!address || address.country_code!=='kr' || ![address.city,address.state,address.province].some(value=>['부산','부산광역시','Busan'].includes(value)))continue;
    const district=districts.find(value=>[address.borough,address.city_district,address.county,address.municipality,address.suburb].includes(value));
    if(!district || (explicitDistrict && explicitDistrict!==district))continue;
    // Prefer the most specific address component; never invent a dong from a coordinate.
    for(const dong of [address.neighbourhood,address.quarter,address.suburb]){
      if(typeof dong!=='string' || !/(?:동|읍|면)$/.test(dong))continue;
      try {
        const result=resolveDbRegion(`${district} ${dong.replace(/제(?=\d+동$)/,'')}`,areas);
        if(!['dong','dong-group'].includes(result.scope))continue;
        for(const area of result.areas)matches.set(`${area.district_name}\0${area.dong_name}`,area);
        break;
      }catch(error){if(!(error instanceof RegionMatchError))throw error;}
    }
  }
  const found=[...matches.values()];
  if(!found.length)throw new RegionMatchError(`“${region}”의 검색 결과에서 DB와 일치하는 부산 행정동을 확인하지 못했습니다. 구 또는 행정동을 입력해 주세요.`);
  if(found.length>1)throw new RegionMatchError(`“${region}”에 해당할 수 있는 지역이 여러 곳입니다. 분석할 구·동을 선택해 주세요.`,found.map(row=>`${row.district_name} ${row.dong_name}`));
  const area=found[0];
  return {label:`${region} 일대 (${area.district_name} ${area.dong_name})`,areas:found,scope:'place',
    attribution:{label:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright'},
    note:`${region}의 검색 주소를 ${area.district_name} ${area.dong_name}과 연결했습니다. 검색 지점의 행정동 기준이며 상권 전체 경계나 역 반경을 의미하지 않습니다.`};
}
