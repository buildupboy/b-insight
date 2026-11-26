import React, { useLayoutEffect, useRef, useState } from 'react';

export default function EventTrend({trend}) {
  const [selectedMonth,setSelectedMonth] = useState(null);
  const rows=trend ?? [];
  const scrollRef=useRef(null);
  useLayoutEffect(()=>{
    const container=scrollRef.current;
    if(container)container.scrollLeft=container.scrollWidth-container.clientWidth;
  },[rows.length,rows.at(-1)?.month]);
  const selected=rows.find(row=>row.month===selectedMonth) ?? rows.at(-1);
  const step=Math.max(1,Math.ceil(Math.max(4,...rows.flatMap(row=>[row.openings,row.closures]))/4));
  const ceiling=step*4;
  const width=Math.max(660,rows.length*24),height=248,left=52,right=30,top=26,bottom=210;
  const labelEvery=Math.max(1,Math.ceil(rows.length/8));
  const plotWidth=width-left-right;
  const x=index=>left+index*plotWidth/Math.max(1,rows.length-1);
  const y=value=>bottom-value/ceiling*(bottom-top);
  const path=key=>rows.map((row,index)=>`${index?'L':'M'} ${x(index)} ${y(row[key])}`).join(' ');
  return <section className="event-trend">
    <div className="trend-heading">
      <h3>개업·폐업 추이</h3><span className="tag">전체 업종</span>
      <div className="trend-legend"><span>개업</span><span>폐업</span></div>
    </div>
    {!rows.length?<p className="detail-muted">데이터 부족</p>:<>
      <p className="trend-tooltip" role="status" aria-live="polite">{selected.month} · 개업 {selected.openings.toLocaleString('ko-KR')}건 · 폐업 {selected.closures.toLocaleString('ko-KR')}건</p>
      <div ref={scrollRef} className="trend-scroll" tabIndex={0} role="region" aria-label="전체 업종 월별 개업·폐업 그래프">
        <svg style={{minWidth:width}} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="전체 업종 월별 개업·폐업 건수">
          <text x={left-10} y={16} textAnchor="end" className="trend-axis">건</text>
          {[0,1,2,3,4].map(i=><g key={i}>
            <line x1={left} x2={width-right} y1={y(step*i)} y2={y(step*i)} className="trend-grid"/>
            <text x={left-10} y={y(step*i)+4} textAnchor="end" className="trend-axis">{(step*i).toLocaleString('ko-KR')}</text>
          </g>)}
          {selected&&<line x1={x(rows.indexOf(selected))} x2={x(rows.indexOf(selected))} y1={top} y2={bottom} className="trend-guide"/>}
          <path d={path('openings')} fill="none" stroke="#2454d6" strokeWidth={2.5} strokeLinejoin="round"/>
          <path d={path('closures')} fill="none" stroke="#cc875b" strokeWidth={2.5} strokeLinejoin="round"/>
          {rows.map((row,index)=>{
            const label=`${row.month} 개업 ${row.openings}건, 폐업 ${row.closures}건`;
            return <g key={row.month} role="button" tabIndex={0} aria-label={label} aria-pressed={selected.month===row.month}
              className="trend-month" onMouseEnter={()=>setSelectedMonth(row.month)} onFocus={()=>setSelectedMonth(row.month)}
              onClick={()=>setSelectedMonth(row.month)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedMonth(row.month);}}}>
              <title>{label}</title>
              <circle cx={x(index)} cy={y(row.openings)} r={3.5} fill="#2454d6" stroke="#fff" strokeWidth={1.5}/>
              <circle cx={x(index)} cy={y(row.closures)} r={3.5} fill="#cc875b" stroke="#fff" strokeWidth={1.5}/>
              <rect x={x(index)-plotWidth/Math.max(1,rows.length-1)/2} y={top-6} width={plotWidth/Math.max(1,rows.length-1)} height={bottom-top+12} className="trend-hit" fill="transparent"/>
              {(index%labelEvery===0||index===rows.length-1)&&<text x={x(index)} y={235} textAnchor="middle" className="trend-axis">{row.month}</text>}
            </g>;
          })}
        </svg>
      </div>
    </>}
  </section>;
}
