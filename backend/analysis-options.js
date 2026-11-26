import {loadRecommendationData} from './recommendation-db.js';
import {InputError,validate,assertPrivateInput} from './conditions.js';

export function validateAnalysisRequest(input) {
  assertPrivateInput(input);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new InputError('분석 요청을 확인해주세요.');
  if(input.conditions!==undefined) {
    const conditions=validate(input.conditions);
    if(input.prompt!==undefined&&(typeof input.prompt!=='string'||input.prompt.length>2000))throw new InputError('창업 조건은 2000자 이내로 입력해주세요.');
    return {...input,conditions};
  }
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>2000)throw new InputError('창업 조건을 2000자 이내로 입력해주세요.');
  return input;
}

export function createAnalysisOptionsLoader(loadData=loadRecommendationData,{now=Date.now,ttl=300000}={}) {
  let cache=null;
  return async()=>{
    if(cache&&now()<cache.expires)return cache.promise;
    const entry={expires:now()+ttl};
    entry.promise=Promise.resolve().then(loadData).then(data=>{
      const industries=[...new Map(data.industries.filter(row=>/^[A-Za-z][0-9]{5}$/.test(row.industry_code)&&row.industry_name)
        .map(row=>[row.industry_code,{value:row.industry_code,label:row.industry_name}])).values()]
        .sort((a,b)=>a.label.localeCompare(b.label,'ko')||a.value.localeCompare(b.value));
      const districts=[...new Set(data.areas.map(area=>area.district_name))].sort((a,b)=>a.localeCompare(b,'ko'));
      const dongs=[...new Map(data.areas.map(area=>[`${area.district_name} ${area.dong_name}`,{value:`${area.district_name} ${area.dong_name}`,label:`${area.district_name} ${area.dong_name}`}])).values()]
        .sort((a,b)=>a.label.localeCompare(b.label,'ko'));
      return {industries,regions:[{value:'부산 전체',label:'부산 전체'},...districts.map(name=>({value:name,label:name})),...dongs]};
    }).catch(error=>{if(cache===entry)cache=null;throw error;});
    cache=entry;return entry.promise;
  };
}
