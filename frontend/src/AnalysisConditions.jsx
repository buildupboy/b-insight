import React,{useEffect,useState} from 'react';
import SearchSelect from './SearchSelect.jsx';

let cache=null;
function loadOptions(){
  if(cache&&Date.now()<cache.expires)return cache.promise;
  const entry={expires:Date.now()+300000};
  entry.promise=fetch('/api/analysis-options',{signal:AbortSignal.timeout(20000)}).then(async response=>{
    const data=await response.json();if(!response.ok)throw new Error(data.error||'선택 목록을 불러오지 못했습니다.');return data;
  }).catch(error=>{if(cache===entry)cache=null;throw error;});
  cache=entry;return entry.promise;
}
const preferences={
  competition:[{value:'normal',label:'보통'},{value:'low',label:'낮은 곳 선호'},{value:'any',label:'상관없음'}],
  stability:[{value:'normal',label:'보통'},{value:'important',label:'중요'}],
  growth:[{value:'normal',label:'보통'},{value:'important',label:'중요'}]
};
export default function AnalysisConditions({value,onChange,onSubmit,busy,comparison=false,matchedIndustry}){
  const [options,setOptions]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[validation,setValidation]=useState('');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    loadOptions().then(data=>{if(active)setOptions(data);}).catch(reason=>{if(active)setError(reason.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[retry]);
  const industries=options?.industries??[];
  const matchingNames=comparison?industries.filter(item=>item.label===(matchedIndustry||value.industry)):[];
  const inheritedIndustry=matchedIndustry&&matchingNames.length!==1?{value:value.industry,label:matchedIndustry}:null;
  const industry=industries.find(item=>item.value===value.industry) ??
    (matchingNames.length===1?matchingNames[0]:inheritedIndustry);
  const industryOptions=industry&&industry===inheritedIndustry?[industry,...industries]:industries;
  function change(field,next){onChange(current=>({...current,[field]:next}));setValidation('');}
  function submit(event){
    event.preventDefault();if(busy||loading||error)return;
    if(!industry){setValidation('목록에서 업종을 선택해주세요.');return;}
    if(!comparison&&!options.regions.some(item=>item.value===value.region)){setValidation('목록에서 희망 지역을 선택해주세요.');return;}
    if(Object.keys(preferences).some(field=>!preferences[field].some(item=>item.value===value[field]))){setValidation('각 선호 조건을 목록에서 선택해주세요.');return;}
    // Keep readable names in existing screens; use the exact DB code for ambiguous names.
    const uniqueName=industries.filter(item=>item.label===industry.label).length===1;
    setValidation('');onSubmit(event,{...value,industry:matchedIndustry?value.industry:uniqueName?industry.label:industry.value});
  }
  return <form className={`panel structured-conditions${comparison?' comparison-conditions':''}`} onSubmit={submit}>
    <div className="section-head"><h2>{comparison?'비교 조건 선택':'분석 조건 선택'}</h2>{!comparison&&<span>검색하거나 목록에서 직접 선택해주세요</span>}</div>
    {loading&&<p className="options-status" role="status">{comparison?'업종':'지역·업종'} 목록을 불러오는 중…</p>}
    {error&&<div className="options-error" role="alert"><p>{error}</p><button type="button" onClick={()=>setRetry(count=>count+1)}>다시 불러오기</button></div>}
    <div className="condition-list">
      <SearchSelect label={comparison?'비교 업종':'업종'} options={industryOptions} value={industry?.value??''} onChange={next=>change('industry',next)} disabled={busy||loading||!!error} placeholder="업종 검색"/>
      {!comparison&&<SearchSelect label="희망 지역" options={options?.regions||[]} value={value.region} onChange={next=>change('region',next)} disabled={busy||loading||!!error} placeholder="구·군 또는 행정동 검색"/>}
      {Object.entries({competition:'경쟁 강도',stability:'안정성',growth:'성장성'}).map(([field,label])=><SearchSelect key={field} label={label} options={preferences[field]} value={value[field]} onChange={next=>change(field,next)} disabled={busy} accent={value[field]==='low'||value[field]==='important'}/>)}
    </div>
    {validation&&<p className="options-error" role="alert">{validation}</p>}
    <div className="assist-row">{!comparison&&<span className="assist">선택한 조건으로 기존 상권 데이터를 분석해요</span>}<button className="primary" type="submit" disabled={busy||loading||!!error}>{busy?'분석 중…':comparison?'비교 조건 적용':'상권 분석하기'}</button></div>
  </form>;
}
