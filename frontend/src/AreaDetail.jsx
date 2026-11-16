import React from 'react';

export function shown(value) {
  return value == null ? '데이터 없음' : Number(value).toLocaleString('ko-KR');
}

export const scoreLabels={fit:'지역·업종 적합도',competition:'경쟁 적합도',stability:'안정성',growth:'성장성'};

const months=value=>value==null?'자료 없음':`${shown(value)}개월`;
const percent=value=>value==null?'자료 없음':`${(value*100).toLocaleString('ko-KR',{maximumFractionDigits:1})}%`;
const trendText=(openings,closures)=>{
  if(openings==null||closures==null) return '확인된 개업·폐업 기록이 없습니다.';
  if(openings===closures) return '개업과 폐업 수가 같습니다.';
  return `${openings>closures?'개업이 폐업보다':'폐업이 개업보다'} ${shown(Math.abs(openings-closures))}곳 많습니다.`;
};

function EventTrend({trend}) {
  if (!trend?.length) return <p className="detail-muted">월별 이력을 확인할 수 없습니다.</p>;
  const max=Math.max(1,...trend.flatMap(row=>[row.openings,row.closures]));
  return <>
    <div className="detail-event-chart" aria-hidden="true">
      {trend.map(row=><div key={row.month}>
        <i style={{height:`${row.openings/max*100}%`}}/>
        <i style={{height:`${row.closures/max*100}%`}}/>
      </div>)}
    </div>
    <div className="detail-chart-legend"><span>개업</span><span>폐업</span></div>
    <details className="detail-data-table"><summary>월별 건수 보기</summary>
      <table><thead><tr><th scope="col">기준월</th><th scope="col">개업</th><th scope="col">폐업</th></tr></thead>
        <tbody>{trend.map(row=><tr key={row.month}><th scope="row">{row.month}</th><td>{shown(row.openings)}</td><td>{shown(row.closures)}</td></tr>)}</tbody>
      </table>
    </details>
  </>;
}

export default function AreaDetail({area,rank,result}) {
  const {metrics,scores,changeContext,industryEvidence}=area;
  const industry=result.matchedIndustry||result.conditions.industry;
  const dong=area.region&&area.name.startsWith(`${area.region} `)?area.name.slice(area.region.length+1):area.name;
  const same=metrics.industryStores,total=metrics.totalStores;
  const survival=metrics.survivalContext, city=changeContext?.citySurvival;
  const comparable=changeContext?.survival!=null&&city!=null;
  const survivalMax=comparable?Math.max(survival,city):1;
  const period=metrics.eventPeriod;
  const dataMonth=String(area.dataDate??'').replace(/^(\d{4})-?(\d{2})$/,'$1년 $2월');
  const assets='/figma-assets/detail-';

  return <section className="area-detail" id={`area-${area.id}`} aria-labelledby="area-detail-title">
    <a className="back-link" href="#results">← 추천 결과</a>
    <section className="panel detail-overview">
      <div className="detail-identity">
        <span className="tag blue">{rank}위 {area.score==null?'후보':'추천'}</span>
        <h1 id="area-detail-title" tabIndex={-1}>{dong} 상권</h1>
        <p>{[area.region,`${industry} 기준 분석`].filter(Boolean).join(' · ')}</p>
        <div className="chips detail-tags">
          {scores.stability!=null&&<span className="tag green">안정성 {shown(scores.stability)}점</span>}
          {metrics.competition!=null&&<span className="tag amber">동일 업종 비중 {percent(metrics.competition)}</span>}
          {changeContext?.status&&<span className="tag green">{changeContext.status}</span>}
          {area.score==null&&<span className="tag">{area.verdict}</span>}
        </div>
      </div>
      <div className="detail-actions">
        <div className="detail-score">{area.score==null?<small>자료 없음</small>:<><strong>{shown(area.score)}</strong><small>점</small></>}</div>
        <div className="detail-action-buttons">
          <button className="primary" type="button" disabled title="보관함 기능은 준비 중입니다."><img src={`${assets}bookmark.svg`} alt=""/>관심 상권 저장</button>
          <button type="button" disabled title="상권 비교 기능은 준비 중입니다.">비교에 추가</button>
          <button type="button" disabled title="검증된 위치 자료가 없습니다.">지도에서 보기</button>
        </div>
      </div>
    </section>

    <div className="detail-metric-grid">
      <section className="panel detail-metric">
        <h2>평균 생존기간</h2><strong className="detail-value">{months(survival)}</strong>
        {comparable?<>
          <div className="detail-comparison" aria-hidden="true">
            <div><span>{dong}</span><i style={{width:`${survival/survivalMax*100}%`}}/></div>
            <div><span>부산 평균</span><i style={{width:`${city/survivalMax*100}%`}}/></div>
          </div>
          <p>부산 평균 {months(city)} · {survival===city?'같은 기간':`${months(Math.abs(survival-city))} ${survival>city?'더 김':'더 짧음'}`}</p>
        </>:<p>{survival!=null&&changeContext?.survival==null?'폐업 이력에서 집계한 평균 영업기간':'비교 가능한 부산 평균 자료가 없습니다.'}</p>}
      </section>
      <section className="panel detail-metric">
        <h2>{period?.stale?'기록된 개업 · 폐업':'최근 개업 · 폐업'}</h2>
        {metrics.openings!=null&&metrics.closures!=null?<div className="detail-event-values">
          <span><span className="sr-only">개업 </span>+{shown(metrics.openings)}</span>
          <span><span className="sr-only">폐업 </span>−{shown(metrics.closures)}</span>
        </div>:<strong className="detail-value">자료 없음</strong>}
        <p>{trendText(metrics.openings,metrics.closures)}</p>
        {period&&<p>{period.from} ~ {period.to}</p>}
      </section>
      <section className="panel detail-metric">
        <h2>동일 업종 점포</h2><strong className="detail-value">{same==null?'자료 없음':`${shown(same)}개`}</strong>
        <p>{industry} 기준{total!=null&&` · 전체 ${shown(total)}개`}</p>
        {dataMonth&&<p>점포 기준월 {dataMonth}</p>}
      </section>
    </div>

    <section className="panel detail-change">
      <div><h2>상권 변화 상태</h2><strong>{changeContext?.status||'자료 없음'}</strong></div>
      <p>평균 폐업기간 {months(changeContext?.averageClosed)}</p>
    </section>

    <div className="detail-analysis-grid">
      <section className="panel detail-analysis">
        <h2>AI 추천 이유</h2>
        <p>{area.score==null?'이 후보의 종합점수를 계산할 만큼 비교 가능한 지표가 확보되지 않았습니다.':`이 후보는 ${Object.entries(area.effectiveWeights).map(([key,weight])=>`${scoreLabels[key]} ${shown(scores[key])}점(가중치 ${weight}%)`).join(', ')}을 반영해 ${shown(area.score)}점을 받았습니다.`}</p>
        <div className="detail-caution"><strong>주의할 점</strong>
          {metrics.competition!=null&&<p>전체 점포 중 {industry} 비중은 {percent(metrics.competition)}입니다.</p>}
          <p>{metrics.eventCategoryScope||'개업·폐업 집계 범위를 확인할 수 없습니다.'}{period?.stale&&' · 제공 자료의 최신 기록 기준이며 성장성 점수에서 제외했습니다.'}</p>
        </div>
        <div className="detail-charts">
          <section><h3>개업·폐업 추이</h3><EventTrend trend={metrics.eventTrend}/></section>
          <section><h3>업종 분포</h3>
            {total==null?<p className="detail-muted">점포 분포를 확인할 수 없습니다.</p>:<>
              {total>0&&<div className="detail-industry-bar" aria-hidden="true"><i style={{width:`${same/total*100}%`}}/></div>}
              <dl className="detail-industry-legend"><div><dt>{industry}</dt><dd>{shown(same)}개</dd></div><div><dt>그 외 업종</dt><dd>{shown(total-same)}개</dd></div></dl>
            </>}
          </section>
        </div>
        <details className="detail-evidence detail-data-table"><summary>데이터 출처와 산출 근거</summary>
          <table><thead><tr><th scope="col">비교 지표</th><th scope="col">점수</th><th scope="col">적용 가중치</th></tr></thead>
            <tbody>{Object.entries(scoreLabels).map(([key,label])=><tr key={key}><th scope="row">{label}</th><td>{shown(scores[key])}</td><td>{area.effectiveWeights[key]??0}%</td></tr>)}</tbody>
          </table>
          <ul>
            <li>점포 수와 업종 비중 · 소상공인시장진흥공단 상가정보{industryEvidence?.filter&&` (${Object.values(industryEvidence.filter).join(', ')})`}</li>
            <li>평균 생존기간과 상권 변화 · 부산광역시 상권 변화지표. 폐업 이력의 영업기간을 사용한 경우 평균 생존기간 카드에 표시했습니다.</li>
            <li>개업·폐업과 추이 · 부산광역시 점포이력{metrics.historyRecords!=null&&` · 주소·업종 일치 이력 ${shown(metrics.historyRecords)}건`}</li>
            {(area.notes||[]).map(note=><li key={note}>{note}</li>)}
          </ul>
        </details>
      </section>

      <aside className="panel detail-map">
        <div className="detail-map-title"><h2>주변 경쟁 점포</h2><span>지도 예시</span></div>
        <img className="detail-map-diagram" src={`${assets}diagram.svg`} alt=""/>
        <div className="detail-map-legend"><span><img src={`${assets}shop.svg`} alt=""/>동일 업종 점포</span><span><img src={`${assets}area.svg`} alt=""/>경쟁 밀집 구역</span></div>
        <p>선택한 상권의 실제 위치 자료는 제공되지 않습니다.</p>
      </aside>
    </div>
  </section>;
}
