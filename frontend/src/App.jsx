import React, { useState } from 'react';

const examples=['부산 서면에서 카페를 열고 싶어요. 경쟁이 낮고 안정적인 곳을 추천해줘.','해운대에서 음식점 창업을 고민 중이야. 최근 12개월 변화를 반영해줘.'];
const shown=value=>value==null?'데이터 없음':Number(value).toLocaleString('ko-KR');
const eventBasis=(area,months)=>{const p=area.metrics.eventPeriod;const scope=area.metrics.eventCategoryScope||'동일 업종 · 행정동 기준';if(!p)return `${scope} · ${months}개월`;return `${scope} · ${p.from} ~ ${p.to} · 이력 ${shown(area.metrics.historyRecords)}건`;};
const defaults={industry:'',region:'부산 전체',competition:'normal',stability:'normal',growth:'normal',months:12,budget:null};
const scoreLabels={fit:'지역·업종 적합도',competition:'경쟁 적합도',stability:'안정성',growth:'성장성'};

export default function App() {
  const [prompt,setPrompt]=useState(''),[result,setResult]=useState(null),[conditions,setConditions]=useState(defaults);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[choices,setChoices]=useState([]),[diagnostic,setDiagnostic]=useState(null);
  const edit=(field,value)=>setConditions(current=>({...current,[field]:value}));
  async function analyze(event,revise=false) {
    event?.preventDefault();
    if (!prompt.trim()||loading) return;
    setLoading(true);setError('');setChoices([]);setDiagnostic(null);
    try {
      const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,...(revise?{conditions}:{})})});
      const data=await response.json();
      if (!response.ok) {setChoices(data.choices||[]);setDiagnostic(data.diagnostic||null);throw new Error(data.error||'분석에 실패했습니다.');}
      setResult(data);setConditions(data.conditions);window.scrollTo({top:0,behavior:'smooth'});
    } catch(reason) {setError(reason.message);} finally {setLoading(false);}
  }
  return <>
    <header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/></span>B-Insight</div>
      <nav aria-label="주 메뉴"><a className="active" href="#analysis">상권 분석</a><a href="#results">상권 지도</a><a href="#results">상권 비교</a><a href="#results">보관함</a></nav><div className="user"><div className="avatar">U</div></div></header>
    <main className={result?'results-layout':''} id="analysis">
      {!result?<><h1>어떤 창업을 준비하고 계신가요?</h1>
        <form className="panel input-panel" onSubmit={analyze}><label className="label" htmlFor="prompt">창업 조건</label>
          <textarea id="prompt" required maxLength={2000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="자유롭게 이야기해 보세요!"/>
          <div className="assist-row"><span className="assist">입력하신 창업 조건을 AI가 한 번에 분석해요</span><button className="primary" disabled={loading} type="submit">{loading?'분석 중…':'AI 상권 분석하기'}</button></div>
        </form><section className="examples"><p className="examples-title">이렇게 물어볼 수 있어요</p><div className="chips">{examples.map(example=><button className="chip" type="button" key={example} onClick={()=>setPrompt(example)}>{example}</button>)}</div></section>
        <section className="panel conditions"><div className="section-head"><h2>AI가 분석할 조건</h2><span>분석 후 조건을 수정할 수 있어요</span></div><div className="condition-list">
          {[['업종',conditions.industry||'입력 후 분석'],['희망 지역',conditions.region],['경쟁 선호',conditions.competition==='low'?'경쟁 낮은 곳 선호':'보통'],['안정성',conditions.stability==='important'?'중요':'보통'],['성장성',conditions.growth==='important'?'중요':'보통']].map(([label,value],i)=><div className={'condition '+(i===2||i===3?'accent':'')} key={label}><span>{label}</span><div className="value-wrap"><span className="value">{value}</span><span className="chevron" aria-hidden="true"/></div></div>)}
        </div></section></>:
      <section className="result-page" id="results">
        <button className="back-link" onClick={()=>{setResult(null);setError('');}}>← 조건 다시 입력</button>
        <h1>추천 창업 상권</h1>
        <div className="chips result-filters"><span className="tag">업종 · {result.matchedIndustry||conditions.industry}</span><span className="tag">지역 · {result.resolvedRegion||conditions.region}</span><span className="tag blue">기간 · 최근 {conditions.months}개월</span></div>
        <div className="results-grid"><div className="ranked">{result.results.length?result.results.map((area,index)=><article className="panel result-card" key={area.id}>
          <div className="card-head"><span className="rank">{index+1}위</span><div className="area"><h2>{area.name}</h2><span>부산광역시 {area.name} · 행정동 기준</span></div><div className="total-score">{area.score==null?<span className="no-score">데이터 부족</span>:area.score}<small>{area.score==null?'':' 점'}</small></div></div>
          <div className="card-badges"><span className="verdict">{area.verdict}</span><span>행정동 점포 비교</span><span>동일 업종 {shown(area.metrics.industryStores)}곳</span></div>
          <div className="metric-tiles">
            <div><span>평균 생존기간</span><strong>{area.metrics.survivalContext==null?'데이터 없음':`${shown(area.metrics.survivalContext)}개월`}</strong><small>{area.metrics.survivalContext==null?'연결 가능한 지표 없음':'같은 구 상권 평균 참고값'}</small></div>
            <div><span>{area.metrics.eventPeriod?.stale ? '기록된 개업' : '최근 개업'}</span><strong>{shown(area.metrics.openings)}</strong><small>{eventBasis(area,conditions.months)}</small></div>
            <div><span>{area.metrics.eventPeriod?.stale ? '기록된 폐업' : '최근 폐업'}</span><strong>{shown(area.metrics.closures)}</strong><small>{eventBasis(area,conditions.months)}</small></div>
            <div><span>동일 업종 점포</span><strong>{shown(area.metrics.industryStores)}</strong><small>전체 {shown(area.metrics.totalStores)}곳</small></div>
          </div>
          <div className="reason-box"><strong>✦ AI 추천 이유</strong><p>{area.score==null?'비교 가능한 행정동 자료가 부족해 점수를 표시하지 않았습니다.':`행정동의 전체 점포 ${shown(area.metrics.totalStores)}곳과 선택 업종 ${shown(area.metrics.industryStores)}곳을 비교했습니다. 경쟁 적합도 ${shown(area.scores.competition)}점, 상업 활동 비교 ${shown(area.scores.fit)}점을 반영했습니다.`}{area.metrics.survivalContext!=null?` 같은 구의 확인된 상권 평균 생존기간 ${shown(area.metrics.survivalContext)}개월은 참고값입니다.`:''}</p></div>
          <details className="evidence"><summary>점수와 데이터 근거 보기</summary><div className="score-grid">{Object.entries(scoreLabels).map(([key,label])=><div key={key}>{label}<strong>{shown(area.scores[key])}</strong><small>적용 가중치 {area.effectiveWeights[key]??0}%</small></div>)}</div><p>순증감: {shown(area.metrics.growth)} · 점포 기준월: {area.dataDate||'확인 불가'} · 업종 코드: {Object.values(area.industryEvidence.filter).join(', ')}</p><ul>{area.notes.map(note=><li key={note}>{note}</li>)}</ul></details>
          <div className="card-actions"><button className="detail-button" type="button" onClick={e=>e.currentTarget.closest('article').querySelector('.evidence').open=true}>상세 보기</button><button type="button" disabled title="검증된 행정동 중심 좌표가 없습니다.">지도에서 보기</button><button type="button" disabled title="보관함 기능은 준비 중입니다.">♧ 관심 상권 저장</button></div>
        </article>):<div className="panel empty">선택한 지역의 행정동을 공공데이터에서 확인하지 못했습니다. 아래 제공처 오류와 조회 제한을 확인해 주세요. 지역 코드를 직접 입력할 필요는 없습니다.</div>}</div>
          <aside className="side-column"><div className="panel methodology"><h2>점수는 이렇게 계산했어요</h2><p>첫 번째 후보의 실제 적용 가중치입니다. 누락 지표는 제외하고 다시 계산합니다.</p>{[['fit','지역·업종 적합도'],['competition','경쟁 적합도'],['stability','안정성'],['growth','성장성']].map(([key,label])=>{const weight=result.results[0]?.effectiveWeights[key]??0;return <div className="weight" key={key}><span>{label}<b>{weight}%</b></span><div><i style={{width:`${weight}%`}}/></div></div>;})}<p className="aside-note">현재 적합도는 행정동의 전체 점포 수를 비교한 상업 활동 대리 지표입니다. 임대료·매출·생존율을 추정하지 않습니다.</p></div>
            <div className="side-tip"><strong>나에게 맞는 상권을 찾아보세요</strong><p>조건을 바꾸면 상위 3개 행정동을 다시 비교합니다.</p></div>
            <div className="panel revise"><h2>분석 조건 수정</h2>{[['industry','업종'],['region','희망 지역']].map(([key,label])=><label key={key}>{label}<input value={conditions[key]} onChange={e=>edit(key,e.target.value)}/></label>)}<label>분석 기간 (개월)<input type="number" min="1" max="36" value={conditions.months} onChange={e=>edit('months',Number(e.target.value))}/></label><button className="primary" disabled={loading} onClick={e=>analyze(e,true)}>{loading?'재분석 중…':'조건 수정 후 재분석'}</button></div></aside></div>
        {result.historyContext&&<p className="limitations">{result.historyContext.note}</p>}
        {result.warnings.length>0&&<div className="warnings" role="status">{result.warnings.map(w=><p key={w}>{w}</p>)}</div>}
        <p className="source-note">분석 시각: {new Date(result.analyzedAt).toLocaleString('ko-KR')} · 출처: {result.sources.join(', ')}</p>
      </section>}
      {error&&<div className="error" role="alert"><p>{error}</p>{diagnostic&&<p>서비스: {diagnostic.service} / {diagnostic.operation} · HTTP {diagnostic.status??'연결 실패'} · {diagnostic.format}</p>}{choices.length>0&&<div className="chips">{choices.map(choice=><button type="button" className="chip" key={choice} onClick={()=>{setPrompt(p=>`${p.trim()} ${choice}`);setError('');setChoices([]);}}>{choice}</button>)}</div>}</div>}
      <span className="sr-only" role="status">{loading?'상권 데이터를 분석하고 있습니다.':''}</span>
    </main>
  </>;
}
