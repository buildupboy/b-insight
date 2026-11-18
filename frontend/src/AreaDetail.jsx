import React from 'react';

export function shown(value) {
  return value == null ? '데이터 없음' : Number(value).toLocaleString('ko-KR');
}

export const scoreLabels={fit:'지역·업종 적합도',competition:'경쟁 적합도',stability:'안정성',growth:'성장성'};

const months=value=>value==null?'자료 없음':`${shown(value)}개월`;
const operatingMonths=value=>value==null?'산출 불가':`${Number(value).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}개월`;
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
  const {metrics,scores,changeContext,industryEvidence,historyContext,marketReferences}=area;
  const industry=result.matchedIndustry||result.conditions.industry;
  const dong=area.region&&area.name.startsWith(`${area.region} `)?area.name.slice(area.region.length+1):area.name;
  const same=metrics.industryStores,total=metrics.totalStores;
  const dataMonth=String(area.dataDate??'').replace(/^(\d{4})-?(\d{2})$/,'$1년 $2월');
  const assets='/figma-assets/detail-';

  return <section className="area-detail" id={`area-${area.id}`} aria-labelledby="area-detail-title">
    <a className="back-link" href="#results">← 추천 결과</a>
    <section className="panel detail-overview">
      <div className="detail-identity">
        <span className="tag blue">{area.score==null?'상대평가 불가':`${rank}위 추천`}</span>
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
        <h2>평균 영업기간</h2><strong className="detail-value">{operatingMonths(historyContext?.averageOperatingMonths)}</strong>
        <p>폐업 업소 기록 기준 · 인허가일~폐업일 · {historyContext?.scope||'집계 범위 확인 불가'}</p>
        <p>유효 표본 {shown(historyContext?.validSample)}건 · 추천 점수 미반영</p>
        {historyContext?.operatingPeriod?.from&&<p>표본 인허가일 {historyContext.operatingPeriod.from}부터 폐업일 {historyContext.operatingPeriod.to}까지</p>}
        <p>동일 업소 식별 ID가 없어 주요 사건 필드가 같은 기록만 중복 제거했습니다.</p>
      </section>
      <section className="panel detail-metric">
        <h2>개업</h2><strong className="detail-value">{shown(historyContext?.permitRecords)}</strong>
        <p>인허가일 기준 · {historyContext?.scope||'행정동 전체 업종'} · 실제 개업일과 다를 수 있음</p>
        <p>{historyContext?.permitPeriod?.from?`${historyContext.permitPeriod.from} ~ ${historyContext.permitPeriod.to}`:'관측 기간 없음'} · 점수 미반영</p>
      </section>
      <section className="panel detail-metric">
        <h2>폐업</h2><strong className="detail-value">{shown(historyContext?.closureRecords)}</strong>
        <p>폐업 상태·유효한 폐업일 기준 · {historyContext?.scope||'행정동 전체 업종'}</p>
        <p>{historyContext?.closurePeriod?.from?`${historyContext.closurePeriod.from} ~ ${historyContext.closurePeriod.to}`:'관측 기간 없음'}</p>
        <p>폐업일 누락 {shown(historyContext?.exclusions?.missingClosure)}건·날짜 오류 {shown(historyContext?.exclusions?.invalidClosure)}건 제외 · 다른 영업 상태의 폐업일 {shown(historyContext?.nonClosedStatusWithDate)}건 미포함 · 점수 미반영</p>
      </section>
      <section className="panel detail-metric">
        <h2>동일 업종 점포</h2><strong className="detail-value">{same==null?'자료 없음':`${shown(same)}개`}</strong>
        <p>{industry} 기준{total!=null&&` · 전체 ${shown(total)}개`}</p>
        {dataMonth&&<p>점포 기준월 {dataMonth}</p>}
      </section>
    </div>

    <section className="panel detail-change">
      <div><h2>상권 변화 참고</h2><strong>{marketReferences?.length?`${shown(marketReferences.length)}개 상권 연결`:'자료 없음'}</strong></div>
      <div>{marketReferences?.length?<>{marketReferences.map(market=><p key={market.marketId}>{market.name} · {market.indicator||'변화 지표 없음'} · 평균 영업 {months(market.averageOpenMonths)} · 평균 폐업 {months(market.averageCloseMonths)} · 겹침 {market.overlapPct==null?'자료 없음':`${shown(market.overlapPct)}%`} · {market.isPrimary?'주 연결':'참고 연결'} · 경계 기준 {market.boundaryReferenceDate}</p>)}<p>각 값은 상권 단위·전체 업종 참고 자료입니다. 행정동 폐업 기록의 평균 영업기간이나 점수로 사용하지 않았습니다.</p></>:<p>이 행정동에 연결된 상권 변화 자료가 없습니다.</p>}</div>
    </section>

    <div className="detail-analysis-grid">
      <section className="panel detail-analysis">
        <h2>추천 이유</h2>
        <p>{area.score==null?area.scoreUnavailableReason:`이 후보는 ${Object.entries(area.effectiveWeights).map(([key,weight])=>`${scoreLabels[key]} ${shown(scores[key])}점(가중치 ${weight}%)`).join(', ')}을 반영해 ${shown(area.score)}점을 받았습니다.`}</p>
        <div className="detail-caution"><strong>주의할 점</strong>
          {result.normalizationBasis&&<p>{result.normalizationBasis.scope} {shown(result.normalizationBasis.candidateCount)}곳을 공통 기준으로 계산한 비교 지수입니다. 0점은 창업 불가, 100점은 성공 보장을 뜻하지 않습니다.</p>}
          {metrics.competition!=null&&<p>전체 점포 중 {industry} 비중은 {percent(metrics.competition)}입니다.</p>}
          <p>{historyContext?.note||'이력 자료가 없어 개업·폐업·평균 영업기간을 산출할 수 없습니다.'}</p>
          {historyContext?.records>0&&<p>평균 영업기간: 폐업 상태 {shown(historyContext.closedStateRecords)}건 중 {shown(historyContext.excludedSampleRecords)}건 제외. 사유별로 인허가일 누락 {shown(historyContext.exclusions.missingPermit)}건, 날짜 오류 {shown(historyContext.exclusions.invalidPermit)}건, 폐업일 누락 {shown(historyContext.exclusions.missingClosure)}건, 날짜 오류 {shown(historyContext.exclusions.invalidClosure)}건, 날짜 역전 {shown(historyContext.exclusions.reversedDates)}건입니다. 한 기록에 여러 사유가 겹칠 수 있습니다.</p>}
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
            <li>점포 수와 업종 비중 · Supabase public.stores{industryEvidence?.filter&&` (${Object.values(industryEvidence.filter).flat().join(', ')})`}</li>
            <li>평균 영업기간 · 이력의 폐업 기록·전체 업종 기준으로 산출했으며 점수에는 미적용</li>
            <li>상권 변화 · 상권 단위·전체 업종 참고값으로 점수에는 미적용</li>
            <li>개업·폐업과 추이 · 이력의 업종 대응과 관측 기간이 확인되지 않아 미적용</li>
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
