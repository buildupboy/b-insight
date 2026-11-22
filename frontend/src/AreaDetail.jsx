import React, {useState} from 'react';
import EventTrend from './EventTrend.jsx';
import CompetitionMap from './CompetitionMap.jsx';
import SaveAreaButton from './SaveAreaButton.jsx';
import {recentEvents, recommendationReason} from './area-insights.mjs';

export function shown(value) {
  return value == null ? '데이터 부족' : Number(value).toLocaleString('ko-KR');
}

export const scoreLabels={fit:'지역·업종 적합도',competition:'경쟁 적합도',stability:'안정성',growth:'성장성'};

const operatingMonths=value=>value==null?'데이터 부족':`${Number(value).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}개월`;
const percent=value=>value==null?'데이터 부족':`${(value*100).toLocaleString('ko-KR',{maximumFractionDigits:1})}%`;

export default function AreaDetail({area,rank,result,backHref='#results',backLabel='추천 결과',onCompare,onOpenMap}) {
  const {metrics,scores,historyContext}=area;
  const [eventMonths,setEventMonths]=useState(12);
  const events=recentEvents(historyContext,eventMonths);
  const industry=result.matchedIndustry||result.conditions.industry;
  const dong=area.region&&area.name.startsWith(`${area.region} `)?area.name.slice(area.region.length+1):area.name;
  const same=metrics.industryStores,total=metrics.totalStores;
  const assets='/figma-assets/detail-';

  return <section className="area-detail" id={`area-${area.id}`} aria-labelledby="area-detail-title">
    <a className="back-link" href={backHref}>← {backLabel}</a>
    <section className="panel detail-overview">
      <div className="detail-identity">
        <span className="tag blue">{area.score==null?'상대평가 불가':rank==null?'상권 상세':`${rank}위 추천`}</span>
        <h1 id="area-detail-title" tabIndex={-1}>{dong} 상권</h1>
        <p>{[area.region,`${industry} 기준 분석`].filter(Boolean).join(' · ')}</p>
        {result.regionAttribution&&<a className="source-note" href={result.regionAttribution.url} target="_blank" rel="noreferrer">{result.regionAttribution.label}</a>}
        <div className="chips detail-tags">
          {scores.stability!=null&&<span className="tag green">안정성 {shown(scores.stability)}점</span>}
          {metrics.competition!=null&&<span className="tag amber">동일 업종 비중 {percent(metrics.competition)}</span>}
          {scores.growth!=null&&<span className="tag blue">성장성 {shown(scores.growth)}점</span>}
          <span className="tag green">{area.verdict}</span>
        </div>
      </div>
      <div className="detail-actions">
        <div className="detail-score">{area.score==null?<small>데이터 없음</small>:<><strong>{shown(area.score)}</strong><small>점</small></>}</div>
        <div className="detail-action-buttons">
          <SaveAreaButton area={area} industry={industry} primary/>
          <button type="button" onClick={onCompare}>기준 상권으로 비교</button>
          <a className="detail-map-action" href="#map" onClick={event=>{event.preventDefault();onOpenMap?.();}}>지도에서 보기</a>
        </div>
      </div>
    </section>

    <div className="detail-metric-grid">
      <section className="panel detail-metric"><h2>평균 영업기간</h2><strong className="detail-value">{operatingMonths(historyContext?.averageOperatingMonths)}</strong></section>
      <section className="panel detail-metric">
        <h2>개업 · 폐업</h2>
        <div className="event-period-options" role="group" aria-label="개업·폐업 조회 기간">
          {[12,24].map(months=><button key={months} type="button" aria-pressed={eventMonths===months} onClick={()=>setEventMonths(months)}>최근 {months/12}년</button>)}
        </div>
        {events?<><div className="detail-event-values" aria-live="polite"><span>개업 {shown(events.openings)}건</span><span>폐업 {shown(events.closures)}건</span></div>
          <p className="detail-event-period">{events.from} ~ {events.to} · 전체 업종</p></>:<p className="detail-muted">데이터 부족</p>}
      </section>
      <section className="panel detail-metric"><h2>동일 업종 점포</h2><strong className="detail-value">{same==null?'데이터 부족':`${shown(same)}개`}</strong></section>
    </div>

    <div className="detail-analysis-grid">
      <section className="panel detail-analysis">
        <h2>추천 이유</h2>
        <p>{recommendationReason(area,industry)}</p>
        <div className="detail-weights">{Object.entries(scoreLabels).map(([key,label])=><div className="weight" key={key}>
          <span>{label}<b>{scores[key]==null?'데이터 부족':`${shown(scores[key])}점 · ${area.effectiveWeights[key]??0}%`}</b></span>
          <div><i style={{width:`${area.effectiveWeights[key]??0}%`}}/></div>
        </div>)}</div>
        <details className="score-guide">
          <summary>점수 산정 기준</summary>
          <p>모든 점수는 부산 전체 행정동과 비교한 상대 점수(0~100점)예요.</p>
          <ul>
            <li><b>{scoreLabels.fit}</b> {dong}의 모든 업종 점포 수가 많을수록 높아요.</li>
            <li><b>{scoreLabels.competition}</b> {dong} 전체 점포 중 {industry} 비중이 낮을수록 높아요.</li>
            <li><b>{scoreLabels.stability}</b> 폐업한 점포(전체 업종)의 평균 영업기간이 길수록 높아요.</li>
            <li><b>{scoreLabels.growth}</b> 최근 12개월 개업이 폐업보다 많을수록 높아요(전체 업종).</li>
          </ul>
          <p>종합 점수는 각 점수에 위 비중(%)을 곱해 합산했어요.</p>
        </details>
        {historyContext?.growthPeriod&&<p className="detail-event-period">성장성 평가 기간 {historyContext.growthPeriod.from} ~ {historyContext.growthPeriod.to}</p>}
        <div className="detail-charts">
          <EventTrend key={`${area.id}-${eventMonths}`} trend={events?.rows}/>
          <section className="industry-distribution"><h3>업종 분포</h3>
            {total==null?<p className="detail-muted">데이터 없음</p>:<>
              <div className="detail-industry-donut" style={{background:`conic-gradient(#2454d6 ${total>0?same/total*100:0}%, #e0e4e9 0)`}} role="img" aria-label={`${industry} ${shown(same)}개, 그 외 업종 ${shown(total-same)}개`}><strong>{percent(total>0?same/total:0)}</strong></div>
              <dl className="detail-industry-legend"><div><dt>{industry}</dt><dd>{shown(same)}개</dd></div><div><dt>그 외 업종</dt><dd>{shown(total-same)}개</dd></div></dl>
            </>}
          </section>
        </div>
      </section>
      <CompetitionMap area={area} industry={industry}/>
    </div>
  </section>;
}
