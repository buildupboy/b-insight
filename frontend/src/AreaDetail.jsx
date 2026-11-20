import React from 'react';
import EventTrend from './EventTrend.jsx';
import CompetitionMap from './CompetitionMap.jsx';
import {kakaoSearchUrl} from './kakao-map.mjs';

export function shown(value) {
  return value == null ? '데이터 부족' : Number(value).toLocaleString('ko-KR');
}

export const scoreLabels={fit:'지역·업종 적합도',competition:'경쟁 적합도',stability:'안정성',growth:'성장성'};

export function recommendationReason(area,industry) {
  if (area.score==null) return '추천 점수를 계산할 데이터가 부족합니다.';
  const labels={fit:'상권 활동',competition:'동일 업종 경쟁 수준',stability:'전체 상권의 영업기간',growth:'전체 상권의 과거 성장 흐름'};
  const criteria=Object.keys(labels).filter(key=>area.effectiveWeights[key]>0).map(key=>labels[key]);
  return `${industry} 점포 ${shown(area.metrics.industryStores)}개가 있는 상권입니다. ${criteria.join('·')}을 비교해 추천했습니다.`;
}

const operatingMonths=value=>value==null?'데이터 부족':`${Number(value).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}개월`;
const percent=value=>value==null?'데이터 부족':`${(value*100).toLocaleString('ko-KR',{maximumFractionDigits:1})}%`;

export default function AreaDetail({area,rank,result,backHref='#results',backLabel='추천 결과',onCompare,onToggleSaved,isSaved=false}) {
  const {metrics,scores,historyContext}=area;
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
          {metrics.growth!=null&&<span className="tag green">{metrics.growth>0?'개업 우세':metrics.growth<0?'폐업 우세':'개업·폐업 균형'}</span>}
          <span className="tag green">{area.verdict}</span>
        </div>
      </div>
      <div className="detail-actions">
        <div className="detail-score">{area.score==null?<small>데이터 없음</small>:<><strong>{shown(area.score)}</strong><small>점</small></>}</div>
        <div className="detail-action-buttons">
          <button className="primary" type="button" aria-pressed={isSaved} onClick={onToggleSaved}><img src={`${assets}bookmark.svg`} alt=""/>{isSaved?'관심 상권 저장됨':'관심 상권 저장'}</button>
          <button type="button" onClick={onCompare}>기준 상권으로 비교</button>
          <a className="detail-map-action" href={kakaoSearchUrl(area,industry)} target="_blank" rel="noreferrer">지도에서 보기 ↗</a>
        </div>
      </div>
    </section>

    <div className="detail-metric-grid">
      <section className="panel detail-metric"><h2>평균 영업기간</h2><strong className="detail-value">{operatingMonths(historyContext?.averageOperatingMonths)}</strong></section>
      <section className="panel detail-metric"><h2>개업 · 폐업</h2><div className="detail-event-values"><span>{historyContext?.permitRecords==null?'데이터 부족':`+${shown(historyContext.permitRecords)}`}</span><span>{historyContext?.closureRecords==null?'데이터 부족':`−${shown(historyContext.closureRecords)}`}</span></div></section>
      <section className="panel detail-metric"><h2>동일 업종 점포</h2><strong className="detail-value">{same==null?'데이터 부족':`${shown(same)}개`}</strong></section>
    </div>

    <section className="panel detail-change"><div><h2>과거 상권 흐름</h2><strong>{metrics.growth==null?'데이터 부족':metrics.growth>0?'개업 우세':metrics.growth<0?'폐업 우세':'개업·폐업 균형'}</strong></div></section>

    <div className="detail-analysis-grid">
      <section className="panel detail-analysis">
        <h2>추천 이유</h2>
        <p>{recommendationReason(area,industry)}</p>
        {scores.competition!=null&&scores.competition<40&&<div className="detail-caution"><strong>주의할 점</strong><p>비교 상권 대비 동일 업종의 경쟁 수준이 높은 편입니다.</p></div>}
        <div className="detail-weights">{Object.entries(scoreLabels).map(([key,label])=><div className="weight" key={key}>
          <span>{label}<b>{scores[key]==null?'데이터 부족':`${shown(scores[key])}점`} · {area.effectiveWeights[key]??0}%</b></span>
          <div><i style={{width:`${area.effectiveWeights[key]??0}%`}}/></div>
        </div>)}</div>
        <div className="detail-charts">
          <EventTrend key={area.id} trend={historyContext?.eventTrend}/>
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
