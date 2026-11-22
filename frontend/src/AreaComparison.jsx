import React,{useEffect,useMemo,useRef,useState} from 'react';
import {comparisonMetrics,formatMetric,metricValue,metricDifference,selectComparison,loadComparison,comparisonKey} from './comparison.mjs';
import AnalysisConditions from './AnalysisConditions.jsx';
import SaveAreaButton from './SaveAreaButton.jsx';
import {panelReason} from './commercial-map.mjs';

function Difference({area,base,metric}) {
  const diff=metricDifference(area,base,metric);
  if(diff.kind==='missing')return null;
  if(diff.kind==='incompatible')return <small className="comparison-muted">비교 불가</small>;
  if(diff.kind==='equal')return <small className="comparison-delta equal" aria-label="기준과 동일">— 동일</small>;
  const unit=metric.differenceUnit||metric.unit;
  const amount=diff.amount.toLocaleString('ko-KR',{maximumFractionDigits:metric.digits});
  return <small className={`comparison-delta ${diff.kind}`} aria-label={`기준보다 ${amount}${unit} ${diff.kind==='up'?'높음':'낮음'}`}>
    <span aria-hidden="true">{diff.kind==='up'?'▲':'▼'} {amount}{unit}</span>
  </small>;
}

export default function AreaComparison({conditions,ids,onIdsChange,onConditionsChange,onOpenDetail,onOpenMap,saved}) {
  const [draft,setDraft]=useState(conditions),[snapshot,setSnapshot]=useState(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [slot,setSlot]=useState(null),[query,setQuery]=useState(''),[district,setDistrict]=useState(''),[savedOnly,setSavedOnly]=useState(false);
  const dialog=useRef(null),title=useRef(null);
  const key=comparisonKey(conditions);
  useEffect(()=>{
    let active=true;setSnapshot(null);setError('');
    if(!conditions.industry){setLoading(false);return;}
    setLoading(true);
    loadComparison(conditions,{refresh:retry>0}).then(data=>{
      if(active)setSnapshot(data);
    }).catch(reason=>{if(active)setError(reason.name==='TimeoutError'?'비교 데이터 조회가 지연되고 있습니다. 다시 시도해 주세요.':reason.message);})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[key,retry]);
  useEffect(()=>{title.current?.focus();},[]);
  useEffect(()=>{
    if(slot!==null&&!dialog.current.open)dialog.current.showModal();
    else if(slot===null&&dialog.current.open)dialog.current.close();
  },[slot]);
  const selected=ids.map(id=>snapshot?.areas.find(area=>area.id===id)??null);
  const candidates=useMemo(()=>snapshot?.areas.filter(area=>(!district||area.region===district)&&
    (!savedOnly||saved.some(item=>item.id===area.id))&&area.name.replace(/\s/g,'').includes(query.replace(/\s/g,'')))
    .sort((a,b)=>a.name.localeCompare(b.name,'ko'))??[],[snapshot,district,savedOnly,saved,query]);
  function choose(index,onlySaved=false){
    setQuery('');setDistrict('');setSavedOnly(onlySaved);setSlot(index);
  }
  const selectedCount=selected.filter(Boolean).length;
  return <section className="comparison-page" aria-labelledby="comparison-title">
    <h1 id="comparison-title" ref={title} tabIndex={-1}>상권 비교</h1>
    <AnalysisConditions comparison value={draft} onChange={setDraft} busy={loading}
      matchedIndustry={draft.industry===conditions.industry?snapshot?.matchedIndustry:undefined}
      onSubmit={(_,value)=>onConditionsChange(value)}/>
    {loading&&<p role="status">비교 데이터를 불러오는 중…</p>}
    {error&&<div className="comparison-column-error" role="alert"><span>{error}</span> <button onClick={()=>setRetry(value=>value+1)}>다시 시도</button></div>}
    <div className="comparison-scroll" role="region" aria-label="상권 비교표, 좁은 화면에서 가로 스크롤" tabIndex={0}>
      <table className="comparison-table">
        <caption className="sr-only">기준 상권 1개와 비교 상권 최대 2개의 지표 비교</caption>
        <colgroup><col className="comparison-label-col"/><col/><col/><col/></colgroup>
        <thead><tr><th scope="col">항목</th>{[0,1,2].map(index=>{
          const area=selected[index];return <th scope="col" key={index} className={index===0?'comparison-base':''}>
            <div className="comparison-area-heading"><span className={`comparison-rank ${index===0?'base':''}`}>{index+1}</span>
              {area?<strong>{area.name}</strong>:<button className="comparison-add" disabled={!snapshot} onClick={()=>choose(index)}>{index===0?'기준 상권 선택':'+ 비교 상권 추가'}</button>}
              {index===0&&<span className="comparison-base-badge">기준</span>}</div>
            {area&&<div className="comparison-header-actions"><button onClick={()=>choose(index)}>변경</button>
              {index>0&&<button aria-label={`${area.name} 비교 삭제`} onClick={()=>onIdsChange(selectComparison(ids,index,null))}>삭제</button>}
              <SaveAreaButton area={area} industry={snapshot.matchedIndustry||conditions.industry}/></div>}
          </th>;
        })}</tr></thead>
        <tbody>{comparisonMetrics.map(metric=><tr key={metric.key}>
          <th scope="row">{metric.label}</th>
          {[0,1,2].map(index=>{
            const area=selected[index];return <td key={index} className={`${index===0?'comparison-base ':''}${metric.key==='score'?'comparison-score':''}`}>
              {area?<div className="comparison-value"><span>{formatMetric(metricValue(area,metric.key),metric)}</span>{index>0&&selected[0]&&<Difference area={area} base={selected[0]} metric={metric}/>}</div>:
                    <span className="comparison-muted">—</span>}
            </td>;
          })}</tr>)}
          <tr className="comparison-summary">
            <th scope="row">AI 한 줄 정리</th>
            {selected.map((area,index)=><td key={index} className={index===0?'comparison-base':''}>{area?panelReason(area):'—'}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
    <div className="comparison-actions"><button className="primary" disabled={!selected[0]} onClick={()=>onOpenDetail(selected[0],snapshot)}>{selected[0]?.name||'기준 상권'} 상세 보기</button>
      <button disabled={!selectedCount} onClick={()=>onOpenMap(selected.filter(Boolean),snapshot)}>선택한 {selectedCount}개 상권 지도에서 보기</button>
      <button disabled={!snapshot} onClick={()=>choose(ids.findIndex(id=>!id)>=0?ids.findIndex(id=>!id):1,true)}>관심 상권에서 고르기</button></div>
    <dialog className="comparison-dialog" ref={dialog} onCancel={()=>setSlot(null)} onClose={()=>setSlot(null)} aria-labelledby="comparison-picker-title">
      <div className="comparison-dialog-head"><h2 id="comparison-picker-title">{slot===0?'기준 상권 선택':'비교 상권 추가·변경'}</h2><button aria-label="상권 선택 닫기" onClick={()=>setSlot(null)}>×</button></div>
      <div className="comparison-picker-filters"><input aria-label="구·행정동 검색" autoFocus placeholder="구 또는 행정동 검색" value={query} onChange={event=>setQuery(event.target.value)}/>
        <select aria-label="구 선택" value={district} onChange={event=>setDistrict(event.target.value)}><option value="">전체 구·군</option>{snapshot?.districts.map(name=><option key={name}>{name}</option>)}</select></div>
      <label className="comparison-saved-filter"><input type="checkbox" checked={savedOnly} onChange={event=>setSavedOnly(event.target.checked)}/> 관심 상권만 보기</label>
      <div className="comparison-picker-list">{candidates.map(area=>{
        const duplicate=ids.some((id,index)=>index!==slot&&id===area.id),current=ids[slot]===area.id;
        return <button key={area.id} disabled={duplicate} aria-pressed={current} onClick={()=>{onIdsChange(selectComparison(ids,slot,area.id));setSlot(null);}}><span>{area.name}</span><small>{duplicate?'이미 선택됨':current?'현재 선택':area.score==null?'점수 데이터 없음':`${area.score}점`}</small></button>;
      })}{!candidates.length&&<p>검색 결과가 없습니다.</p>}</div>
    </dialog>
  </section>;
}
