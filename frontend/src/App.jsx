import React, { useEffect, useRef, useState } from 'react';
import AreaDetail, { scoreLabels, shown, recommendationReason } from './AreaDetail.jsx';
import {kakaoSearchUrl} from './kakao-map.mjs';
import CommercialMap from './CommercialMap.jsx';
import AreaComparison from './AreaComparison.jsx';
import {loadComparison} from './comparison.mjs';
import {useAuth,UserMenu} from './AuthContext.jsx';
import SaveAreaButton from './SaveAreaButton.jsx';
import SavedAreas from './SavedAreas.jsx';
import AnalysisConditions from './AnalysisConditions.jsx';

const examples=['부산진구에서 카페를 열고 싶어요. 경쟁이 낮은 곳을 추천해줘.','해운대구에서 미용실 창업을 고민 중이야.'];
const operatingMonths=value=>value==null?'데이터 부족':`${Number(value).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}개월`;
const defaults={industry:'',region:'부산 전체',competition:'normal',stability:'normal',growth:'normal',populationRequested:false,populationTypes:[],budget:null};

export default function App() {
  const [inputMode,setInputMode]=useState('natural'),[structuredConditions,setStructuredConditions]=useState(defaults);
  const analysisLock=useRef(false);
  const [prompt,setPrompt]=useState(''),[result,setResult]=useState(null),[conditions,setConditions]=useState(defaults);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[choices,setChoices]=useState([]),[choiceType,setChoiceType]=useState(null),[pendingConditions,setPendingConditions]=useState(null);
  const [hash,setHash]=useState(()=>window.location.hash);
  const [mapConditions,setMapConditions]=useState(null),[detailFromMap,setDetailFromMap]=useState(false);
  const [comparisonConditions,setComparisonConditions]=useState(defaults),[comparisonIds,setComparisonIds]=useState([null,null,null]);
  const [comparisonSnapshot,setComparisonSnapshot]=useState(null),[mapComparison,setMapComparison]=useState(null),[detailFromComparison,setDetailFromComparison]=useState(false);
  const {saved,error:savedError,toggleSaved}=useAuth();
  const [detailFromSaved,setDetailFromSaved]=useState(false);
  const isMap=hash==='#map';
  const isComparison=hash==='#compare',isSaved=hash==='#saved';
  const loadingDialog=useRef(null);
  const errorNotice=useRef(null);
  const lastArea=useRef(null);
  const selectionRef=useRef({});
  const selectedIndex=result?.results.findIndex(area=>hash===`#area-${area.id}`)??-1;
  const selectedArea=selectedIndex>=0?result.results[selectedIndex]:null;
  useEffect(()=>{
    const update=()=>setHash(window.location.hash);
    window.addEventListener('hashchange',update);
    return ()=>window.removeEventListener('hashchange',update);
  },[]);
  useEffect(()=>{
    if (selectedArea) {
      lastArea.current=selectedArea.id;
      window.scrollTo(0,0);
      document.getElementById('area-detail-title')?.focus({preventScroll:true});
    } else if (lastArea.current) {
      document.getElementById(`area-link-${lastArea.current}`)?.focus();
      lastArea.current=null;
    }
  },[selectedArea]);
  useEffect(()=>{
    const dialog=loadingDialog.current;
    if (loading) dialog.showModal();
    else dialog.close();
  },[loading]);
  useEffect(()=>{
    if (error) errorNotice.current?.scrollIntoView({block:'nearest'});
  },[error]);
  const edit=(field,value)=>setConditions(current=>({...current,[field]:value}));
  async function openSavedDetail(area) {
    setLoading(true);setError('');
    try {
      const snapshot=await loadComparison({...defaults,industry:area.industry||'카페'});
      if(!snapshot.areas.some(item=>item.id===area.id))throw new Error('해당 상권의 현재 데이터를 찾을 수 없습니다.');
      setResult({...snapshot,results:snapshot.areas});setConditions(snapshot.conditions);
      setDetailFromMap(false);setDetailFromComparison(false);setDetailFromSaved(true);
      window.location.hash=`area-${area.id}`;
    }catch(reason){setError(reason.message);}finally{setLoading(false);}
  }
  useEffect(()=>{if(hash==='#analysis'){setResult(null);setDetailFromSaved(false);}},[hash]);
  useEffect(()=>{
    if(!result&&hash.startsWith('#area-')){
      const area=saved.find(item=>hash===`#area-${item.id}`);
      if(area)openSavedDetail(area);
    }
  },[hash,saved]);
  function openComparison(area=null,source=result) {
    setError('');setComparisonConditions(source?.conditions||mapConditions||conditions);
    if(area)setComparisonIds([area.id,null,null]);
    window.location.hash='compare';
  }
  function openComparisonDetail(area,snapshot) {
    setResult({...snapshot,results:snapshot.areas});setConditions(snapshot.conditions);setDetailFromSaved(false);setDetailFromMap(false);setDetailFromComparison(true);
    window.location.hash=`area-${area.id}`;
  }
  function openComparisonMap(areas,snapshot) {
    setMapConditions(snapshot.conditions);setMapComparison({ids:areas.map(area=>area.id),snapshot});window.location.hash='map';
  }
  async function openMapDetail(area,mapData) {
    if(mapData.normalizationBasis){openComparisonDetail(area,mapData);setDetailFromComparison(false);setDetailFromMap(true);return;}
    setLoading(true);setError('');
    try {
      const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(75000),
        body:JSON.stringify({prompt:`${area.name} ${mapData.matchedIndustry}`,conditions:{...mapData.conditions,region:area.name}})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'상권 상세 정보를 불러오지 못했습니다.');
      setResult(data);setConditions(data.conditions);setDetailFromSaved(false);setDetailFromMap(true);setDetailFromComparison(false);
      window.location.hash=`area-${area.id}`;
    }catch(reason){setError(reason.message);}
    finally{setLoading(false);}
  }
  async function analyze(event,revise=false,selection=null,structured=null) {
    event?.preventDefault();
    if (analysisLock.current||loading||(!structured&&!revise&&!prompt.trim())) return;
    analysisLock.current=true;
    selectionRef.current=selection?{...selectionRef.current,...selection}:{};
    if (!selection) setPendingConditions(null);
    setLoading(true);setError('');setChoices([]);setChoiceType(null);
    try {
      const response=await fetch('/api/analyze',{method:'POST',signal:AbortSignal.timeout(75000),headers:{'Content-Type':'application/json'},body:JSON.stringify(structured?{conditions:structured}:revise?{conditions}:{prompt,...(selection&&pendingConditions?{conditions:pendingConditions}:{}),...selectionRef.current})});
      if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('분석 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      const data=await response.json();
      if (!response.ok) {setChoices(data.choices||[]);setChoiceType(data.choiceType||null);setPendingConditions(data.conditions||null);throw new Error(data.error||'분석에 실패했습니다.');}
      setResult(data);setConditions(data.conditions);setPendingConditions(null);setDetailFromSaved(false);setDetailFromMap(false);setDetailFromComparison(false);window.location.hash='results';window.scrollTo({top:0,behavior:'smooth'});
    } catch(reason) {
      setError(reason.name==='TimeoutError'?'분석 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.':reason.message);
    } finally {analysisLock.current=false;setLoading(false);}
  }
  return <>
    <header className="topbar"><a className="brand brand-home" href="#analysis" aria-label="B-Insight 상권 분석 홈" onClick={()=>{setResult(null);setError('');setChoices([]);setPendingConditions(null);setDetailFromSaved(false);setDetailFromMap(false);setDetailFromComparison(false);}}><span className="brand-logo"><img src="/figma-assets/binsight-logo.svg" alt=""/></span><span>B-Insight</span></a>
      <nav aria-label="주 메뉴"><a className={!isMap&&!isComparison&&!isSaved?'active':''} href="#analysis" onClick={()=>{setResult(null);setError('');}}>상권 분석</a><a className={isMap?'active':''} href="#map" onClick={()=>{setError('');setMapComparison(null);}}>상권 지도</a><a className={isComparison?'active':''} href="#compare" onClick={()=>{if(!isComparison)openComparison();}}>상권 비교</a><a className={isSaved?'active':''} href="#saved">보관함</a></nav><UserMenu/></header>
    <main className={isComparison||isSaved?'comparison-layout':isMap?'map-page-layout':result?'results-layout':''} id="analysis">
      {savedError&&<p className="error" role="alert">{savedError}</p>}
      {isComparison?<AreaComparison conditions={comparisonConditions} ids={comparisonIds} onIdsChange={setComparisonIds} onConditionsChange={setComparisonConditions} onSnapshot={setComparisonSnapshot} onOpenDetail={openComparisonDetail} onOpenMap={openComparisonMap} saved={saved} onToggleSaved={area=>toggleSaved(area,comparisonConditions.industry)}/>:
      isSaved?<SavedAreas onOpenDetail={openSavedDetail}/>:
      isMap?<CommercialMap initialConditions={mapConditions||result?.conditions} comparisonSelection={mapComparison} onConditionsChange={setMapConditions} onOpenDetail={openMapDetail}/>:
      selectedArea?<AreaDetail area={selectedArea} rank={detailFromSaved||detailFromMap||detailFromComparison?null:selectedIndex+1} result={result} backHref={detailFromSaved?'#saved':detailFromComparison?'#compare':detailFromMap?'#map':'#results'} backLabel={detailFromSaved?'내 보관함':detailFromComparison?'상권 비교':detailFromMap?'상권 지도':'추천 결과'} onCompare={()=>openComparison(selectedArea)}/>:!result?<><h1>어떤 창업을 준비하고 계신가요?</h1>
        <div className="analysis-input-tabs" role="tablist" aria-label="상권 분석 입력 방식">
          <button id="natural-tab" type="button" role="tab" aria-selected={inputMode==='natural'} aria-controls="analysis-input-panel" tabIndex={inputMode==='natural'?0:-1} onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();setInputMode('structured');document.getElementById('structured-tab')?.focus();}}} onClick={()=>setInputMode('natural')}>자연어 입력</button>
          <button id="structured-tab" type="button" role="tab" aria-selected={inputMode==='structured'} aria-controls="analysis-input-panel" tabIndex={inputMode==='structured'?0:-1} onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();setInputMode('natural');document.getElementById('natural-tab')?.focus();}}} onClick={()=>setInputMode('structured')}>조건 선택</button>
        </div>
        <div id="analysis-input-panel" className="analysis-input-panel" role="tabpanel" aria-labelledby={inputMode==='natural'?'natural-tab':'structured-tab'}>
          {inputMode==='structured'?<AnalysisConditions value={structuredConditions} onChange={setStructuredConditions} busy={loading} onSubmit={(event,value)=>analyze(event,false,null,value)}/>:<>        <form className="panel input-panel" onSubmit={analyze}><label className="label" htmlFor="prompt">창업 조건</label>
          <textarea id="prompt" required maxLength={2000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="자유롭게 이야기해 보세요!"/>
          <div className="assist-row"><span className="assist">입력하신 창업 조건을 AI가 한 번에 분석해요</span><button className="primary" type="submit">AI 상권 분석하기</button></div>
        </form><section className="examples"><p className="examples-title">이렇게 물어볼 수 있어요</p><div className="chips">{examples.map(example=><button className="chip" type="button" key={example} onClick={()=>setPrompt(example)}>{example}</button>)}</div></section>
        <section className="panel conditions"><div className="section-head"><h2>AI가 분석할 조건</h2><span>분석 후 조건을 수정할 수 있어요</span></div><div className="condition-list">
          {[['업종',conditions.industry||'입력 후 분석'],['희망 지역',conditions.region],['경쟁 선호',conditions.competition==='low'?'경쟁 낮은 곳 선호':'보통'],['안정성',conditions.stability==='important'?'중요':'보통'],['성장성',conditions.growth==='important'?'중요':'보통']].map(([label,value],i)=><div className={'condition '+(i===2||i===3?'accent':'')} key={label}><span>{label}</span><div className="value-wrap"><span className="value">{value}</span><span className="chevron" aria-hidden="true"/></div></div>)}
        </div></section></>}
        </div></>:
      <section className="result-page" id="results">
        <button className="back-link" onClick={()=>{setResult(null);setError('');}}>← 조건 다시 입력</button>
        <h1>추천 창업 상권</h1>
        <div className="chips result-filters"><span className="tag">업종 · {result.matchedIndustry||conditions.industry}</span><span className="tag">지역 · {result.resolvedRegion||conditions.region}</span></div>
        {result.regionAttribution&&<a className="source-note" href={result.regionAttribution.url} target="_blank" rel="noreferrer">{result.regionAttribution.label}</a>}
        <div className="results-grid"><div className="ranked">{result.results.length?result.results.map((area,index)=><article className="panel result-card" key={area.id} onClick={event=>{
          if (!event.target.closest('a,button,summary')&&!window.getSelection()?.toString()) window.location.hash=`area-${area.id}`;
        }}>
          <div className="card-head"><span className="rank">{area.score==null?'후보':`${index+1}위`}</span><div className="area"><h2>{area.name}</h2><span>부산광역시 {area.name} · 행정동 기준</span></div><div className="total-score">{area.score==null?<span className="no-score">상대평가 불가</span>:area.score}<small>{area.score==null?'':' 점'}</small></div></div>
          <div className="card-badges"><span className="verdict">{area.verdict}</span><span>행정동 점포 비교</span><span>동일 업종 {shown(area.metrics.industryStores)}곳</span></div>
          <div className="metric-tiles">
            <div><span>평균 영업기간</span><strong>{operatingMonths(area.historyContext?.averageOperatingMonths)}</strong></div>
            <div><span>개업</span><strong>{shown(area.historyContext?.permitRecords)}{area.historyContext?.permitRecords!=null?'건':''}</strong></div>
            <div><span>폐업</span><strong>{shown(area.historyContext?.closureRecords)}{area.historyContext?.closureRecords!=null?'건':''}</strong></div>
            <div><span>동일 업종 점포</span><strong>{shown(area.metrics.industryStores)}{area.metrics.industryStores!=null?'개':''}</strong></div>
          </div>
          <div className="reason-box"><strong>✦ 추천 이유</strong><p>{recommendationReason(area,result.matchedIndustry||conditions.industry)}</p></div>

          <div className="card-actions"><a className="detail-button" id={`area-link-${area.id}`} href={`#area-${area.id}`}>상세 보기</a><a className="map-link" href={kakaoSearchUrl(area,result.matchedIndustry||conditions.industry)} target="_blank" rel="noreferrer">지도에서 보기 ↗</a><SaveAreaButton area={area} industry={result.matchedIndustry||conditions.industry}/></div>
        </article>):<div className="panel empty">선택한 지역의 점포 데이터를 DB에서 확인하지 못했습니다. 구 또는 행정동 이름으로 다시 입력해 주세요.</div>}</div>
          <aside className="side-column"><div className="panel methodology"><h2>점수 항목과 가중치</h2>{Object.entries(scoreLabels).map(([key,label])=>{const weight=result.results[0]?.effectiveWeights[key]??0;return <div className="weight" key={key}><span>{label}<b>{weight}%</b></span><div><i style={{width:`${weight}%`}}/></div></div>;})}</div>
            <div className="side-tip"><strong>나에게 맞는 상권을 찾아보세요</strong><p>조건을 바꾸면 상위 3개 행정동을 다시 비교합니다.</p></div>
            <div className="panel revise"><h2>분석 조건 수정</h2>{[['industry','업종'],['region','희망 지역']].map(([key,label])=><label key={key}>{label}<input value={key==='industry'&&/^[A-Za-z][0-9]{5}$/.test(conditions[key])?result.matchedIndustry:conditions[key]} onChange={e=>edit(key,e.target.value)}/></label>)}<button className="primary" onClick={e=>analyze(e,true)}>조건 수정 후 재분석</button></div></aside></div>
      </section>}
      {error&&<div ref={errorNotice} className="error" role="alert"><p>{error}</p>{choices.length>0&&<div className="chips">{choices.map(choice=><button type="button" className="chip" key={choice} onClick={event=>analyze(event,false,{[choiceType==='industry'?'industryChoice':'regionChoice']:choice})}>{choice}</button>)}</div>}</div>}
    </main>
    <dialog ref={loadingDialog} className="analysis-dialog" aria-labelledby="analysis-dialog-title" aria-describedby="analysis-dialog-description analysis-dialog-note" onCancel={event=>event.preventDefault()}>
      <div className="analysis-dots" aria-hidden="true"><span/><span/><span/></div>
      <h2 id="analysis-dialog-title">분석 중입니다.</h2>
      <p id="analysis-dialog-description">입력하신 창업 조건에 맞춰<br/>상권 데이터를 꼼꼼히 분석하고 있어요.</p>
      <p id="analysis-dialog-note">잠시만 기다려 주세요.</p>
    </dialog>
  </>;
}
