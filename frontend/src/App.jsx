import React, { useEffect, useRef, useState } from 'react';
import AreaDetail, { scoreLabels, shown } from './AreaDetail.jsx';

const examples=['부산진구에서 카페를 열고 싶어요. 경쟁이 낮은 곳을 추천해줘.','해운대구에서 미용실 창업을 고민 중이야.'];
const historyBasis=(area,type)=>{const h=area.historyContext;if(!h?.records)return '점포이력 DB · 행정동 전체 업종 이력 없음';const period=type==='permit'?h.permitPeriod:h.closurePeriod;return `점포이력 DB · 행정동 전체 업종 · ${type==='permit'?'인허가일 기준':'폐업 상태·폐업일 기준'} · ${period?.from?`${period.from} ~ ${period.to}`:'유효 날짜 없음'} · 점수 미반영`;};
const operatingMonths=value=>value==null?'산출 불가':`${Number(value).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}개월`;
const defaults={industry:'',region:'부산 전체',competition:'normal',stability:'normal',growth:'normal',populationRequested:false,months:12,budget:null};

export default function App() {
  const [prompt,setPrompt]=useState(''),[result,setResult]=useState(null),[conditions,setConditions]=useState(defaults);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[choices,setChoices]=useState([]),[choiceType,setChoiceType]=useState(null),[pendingConditions,setPendingConditions]=useState(null),[diagnostic,setDiagnostic]=useState(null),[elapsedMs,setElapsedMs]=useState(null);
  const [hash,setHash]=useState(()=>window.location.hash);
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
  async function analyze(event,revise=false,selection=null) {
    event?.preventDefault();
    if (!prompt.trim()||loading) return;
    selectionRef.current=selection?{...selectionRef.current,...selection}:{};
    if (!selection) setPendingConditions(null);
    const started=performance.now();
    setLoading(true);setError('');setChoices([]);setChoiceType(null);setDiagnostic(null);setElapsedMs(null);
    try {
      const response=await fetch('/api/analyze',{method:'POST',signal:AbortSignal.timeout(75000),headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,...(revise?{conditions}:{}),...(selection&&pendingConditions?{conditions:pendingConditions}:{}),...selectionRef.current})});
      if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('분석 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      const data=await response.json();
      if (!response.ok) {setChoices(data.choices||[]);setChoiceType(data.choiceType||null);setPendingConditions(data.conditions||null);setDiagnostic(data.diagnostic||null);throw new Error(data.error||'분석에 실패했습니다.');}
      setResult(data);setConditions(data.conditions);setPendingConditions(null);window.scrollTo({top:0,behavior:'smooth'});
      requestAnimationFrame(()=>setElapsedMs(Math.round(performance.now()-started)));
    } catch(reason) {
      setError(reason.name==='TimeoutError'?'분석 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.':reason.message);
      requestAnimationFrame(()=>setElapsedMs(Math.round(performance.now()-started)));
    } finally {setLoading(false);}
  }
  return <>
    <header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/></span>B-Insight</div>
      <nav aria-label="주 메뉴"><a className="active" href="#analysis">상권 분석</a><a href="#results">상권 지도</a><a href="#results">상권 비교</a><a href="#results">보관함</a></nav><div className="user"><div className="avatar">U</div></div></header>
    <main className={result?'results-layout':''} id="analysis">
      {selectedArea?<AreaDetail area={selectedArea} rank={selectedIndex+1} result={result}/>:!result?<><h1>어떤 창업을 준비하고 계신가요?</h1>
        <form className="panel input-panel" onSubmit={analyze}><label className="label" htmlFor="prompt">창업 조건</label>
          <textarea id="prompt" required maxLength={2000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="자유롭게 이야기해 보세요!"/>
          <div className="assist-row"><span className="assist">입력하신 창업 조건을 AI가 한 번에 분석해요</span><button className="primary" type="submit">AI 상권 분석하기</button></div>
        </form><section className="examples"><p className="examples-title">이렇게 물어볼 수 있어요</p><div className="chips">{examples.map(example=><button className="chip" type="button" key={example} onClick={()=>setPrompt(example)}>{example}</button>)}</div></section>
        <section className="panel conditions"><div className="section-head"><h2>AI가 분석할 조건</h2><span>분석 후 조건을 수정할 수 있어요</span></div><div className="condition-list">
          {[['업종',conditions.industry||'입력 후 분석'],['희망 지역',conditions.region],['경쟁 선호',conditions.competition==='low'?'경쟁 낮은 곳 선호':'보통'],['안정성',conditions.stability==='important'?'중요':'보통'],['성장성',conditions.growth==='important'?'중요':'보통']].map(([label,value],i)=><div className={'condition '+(i===2||i===3?'accent':'')} key={label}><span>{label}</span><div className="value-wrap"><span className="value">{value}</span><span className="chevron" aria-hidden="true"/></div></div>)}
        </div></section></>:
      <section className="result-page" id="results">
        <button className="back-link" onClick={()=>{setResult(null);setError('');}}>← 조건 다시 입력</button>
        <h1>추천 창업 상권</h1>
        {elapsedMs!=null&&<p className="source-note">분석 완료 · 소요 시간 {(elapsedMs/1000).toFixed(1)}초</p>}
        <div className="chips result-filters"><span className="tag">업종 · {result.matchedIndustry||conditions.industry}</span><span className="tag">지역 · {result.resolvedRegion||conditions.region}</span></div>
        <div className="results-grid"><div className="ranked">{result.results.length?result.results.map((area,index)=><article className="panel result-card" key={area.id} onClick={event=>{
          if (!event.target.closest('a,button,summary')&&!window.getSelection()?.toString()) window.location.hash=`area-${area.id}`;
        }}>
          <div className="card-head"><span className="rank">{area.score==null?'후보':`${index+1}위`}</span><div className="area"><h2>{area.name}</h2><span>부산광역시 {area.name} · 행정동 기준</span></div><div className="total-score">{area.score==null?<span className="no-score">상대평가 불가</span>:area.score}<small>{area.score==null?'':' 점'}</small></div></div>
          <div className="card-badges"><span className="verdict">{area.verdict}</span><span>행정동 점포 비교</span><span>동일 업종 {shown(area.metrics.industryStores)}곳</span></div>
          <div className="metric-tiles">
            <div><span>평균 영업기간</span><strong>{operatingMonths(area.historyContext?.averageOperatingMonths)}</strong><small>점포이력 DB · 폐업 업소 기록 기준 · 인허가일~폐업일 · 전체 업종 · 유효 표본 {shown(area.historyContext?.validSample)}건 · {area.historyContext?.operatingPeriod?.from?`${area.historyContext.operatingPeriod.from} ~ ${area.historyContext.operatingPeriod.to}`:'기간 없음'} · 점수 미반영</small></div>
            <div><span>개업</span><strong>{shown(area.historyContext?.permitRecords)}</strong><small>{historyBasis(area,'permit')}</small></div>
            <div><span>폐업</span><strong>{shown(area.historyContext?.closureRecords)}</strong><small>{historyBasis(area,'closure')}</small></div>
            <div><span>동일 업종 점포</span><strong>{shown(area.metrics.industryStores)}</strong><small>전체 {shown(area.metrics.totalStores)}곳</small></div>
          </div>
          {area.marketReferences?.length>0&&<p className="source-note">상권 참고: {area.marketReferences[0].name} · 평균 영업 {shown(area.marketReferences[0].averageOpenMonths)}개월 · 상권 단위 전체 업종, 점수 미반영</p>}
          <div className="reason-box"><strong>✦ 추천 이유</strong><p>{area.score==null?area.scoreUnavailableReason:`행정동의 전체 점포 ${shown(area.metrics.totalStores)}곳과 선택 업종 ${shown(area.metrics.industryStores)}곳을 비교했습니다. 경쟁 적합도 ${shown(area.scores.competition)}점, 상업 활동 비교 ${shown(area.scores.fit)}점을 반영했습니다.`}</p></div>

          <div className="card-actions"><a className="detail-button" id={`area-link-${area.id}`} href={`#area-${area.id}`}>상세 보기</a><button type="button" disabled title="검증된 행정동 중심 좌표가 없습니다.">지도에서 보기</button><button type="button" disabled title="보관함 기능은 준비 중입니다.">♧ 관심 상권 저장</button></div>
        </article>):<div className="panel empty">선택한 지역의 점포 데이터를 DB에서 확인하지 못했습니다. 구 또는 행정동 이름으로 다시 입력해 주세요.</div>}</div>
          <aside className="side-column"><div className="panel methodology"><h2>점수는 이렇게 계산했어요</h2><p>첫 번째 후보의 실제 적용 가중치입니다. 누락 지표는 제외하고 다시 계산합니다.</p>{Object.entries(scoreLabels).map(([key,label])=>{const weight=result.results[0]?.effectiveWeights[key]??0;return <div className="weight" key={key}><span>{label}<b>{weight}%</b></span><div><i style={{width:`${weight}%`}}/></div></div>;})}<p className="aside-note">현재 적합도는 행정동의 전체 점포 수를 비교한 상업 활동 대리 지표입니다. 임대료·매출·생존율을 추정하지 않습니다.</p></div>
            <div className="side-tip"><strong>나에게 맞는 상권을 찾아보세요</strong><p>조건을 바꾸면 상위 3개 행정동을 다시 비교합니다.</p></div>
            <div className="panel revise"><h2>분석 조건 수정</h2>{[['industry','업종'],['region','희망 지역']].map(([key,label])=><label key={key}>{label}<input value={conditions[key]} onChange={e=>edit(key,e.target.value)}/></label>)}<button className="primary" onClick={e=>analyze(e,true)}>조건 수정 후 재분석</button></div></aside></div>
        {result.historyContext&&<p className="limitations">{result.historyContext.note}</p>}
        {result.warnings.length>0&&<div className="warnings" role="status">{result.warnings.map(w=><p key={w}>{w}</p>)}</div>}
        <p className="source-note">분석 시각: {new Date(result.analyzedAt).toLocaleString('ko-KR')} · 출처: {result.sources.join(', ')}</p>
      </section>}
      {error&&<div ref={errorNotice} className="error" role="alert"><p>{error}</p>{elapsedMs!=null&&<p>분석 중단 · 소요 시간 {(elapsedMs/1000).toFixed(1)}초</p>}{diagnostic&&<p>서비스: {diagnostic.service} / {diagnostic.operation} · HTTP {diagnostic.status??'연결 실패'} · {diagnostic.format}</p>}{choices.length>0&&<div className="chips">{choices.map(choice=><button type="button" className="chip" key={choice} onClick={event=>analyze(event,false,{[choiceType==='industry'?'industryChoice':'regionChoice']:choice})}>{choice}</button>)}</div>}</div>}
    </main>
    <dialog ref={loadingDialog} className="analysis-dialog" aria-labelledby="analysis-dialog-title" aria-describedby="analysis-dialog-description analysis-dialog-note" onCancel={event=>event.preventDefault()}>
      <div className="analysis-dots" aria-hidden="true"><span/><span/><span/></div>
      <h2 id="analysis-dialog-title">분석 중입니다.</h2>
      <p id="analysis-dialog-description">입력하신 창업 조건에 맞춰<br/>상권 데이터를 꼼꼼히 분석하고 있어요.</p>
      <p id="analysis-dialog-note">잠시만 기다려 주세요.</p>
    </dialog>
  </>;
}
