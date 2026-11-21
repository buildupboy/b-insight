import React,{useEffect,useMemo,useRef,useState} from 'react';
import {loadKakaoSdk} from './kakao-map.mjs';
import {shown} from './AreaDetail.jsx';
import {geometryAnchor,geometryBounds,geometryPolygons,matchesScore,panelReason,regionKey,scoreTier} from './commercial-map.mjs';

const icons='/figma-assets/map-';
const defaultFilters={region:'부산진구',industry:'카페',score:'all',range:'boundary'};
const months=value=>value==null?'데이터 부족':`${Number(value).toLocaleString('ko-KR',{maximumFractionDigits:1})}개월`;

export default function CommercialMap({initialConditions,onConditionsChange,onOpenDetail,comparisonSelection}) {
  const [filters,setFilters]=useState({...defaultFilters,region:initialConditions?.region||defaultFilters.region,industry:initialConditions?.industry||defaultFilters.industry});
  const [data,setData]=useState(comparisonSelection?.snapshot??null),[features,setFeatures]=useState([]),[selectedId,setSelectedId]=useState(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[choices,setChoices]=useState([]);
  const [mapStatus,setMapStatus]=useState('loading'),[appliedScore,setAppliedScore]=useState('all'),[range,setRange]=useState('boundary');
  const [viewportIds,setViewportIds]=useState(comparisonSelection?.ids??null);
  const canvas=useRef(null),map=useRef(null),sdk=useRef(null),handles=useRef(new Map()),focusArea=useRef(null),circle=useRef(null),requestId=useRef(0);
  const selected=data?.areas.find(area=>area.id===selectedId) ?? null;
  const featureByKey=useMemo(()=>new Map(features.map(feature=>[regionKey(feature.properties.district_name,feature.properties.dong_name),feature])),[features]);
  const displayed=useMemo(()=>{
    if(!data)return [];
    const ids=new Set(viewportIds??data.visibleIds);
    return data.areas.filter(area=>ids.has(area.id)&&matchesScore(area.score,appliedScore));
  },[data,viewportIds,appliedScore]);

  async function search(next=filters) {
    const id=++requestId.current;
    setLoading(true);setError('');setChoices([]);
    try {
      const response=await fetch('/api/map-data',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(75000),body:JSON.stringify({
        region:next.region,industry:next.industry,competition:initialConditions?.competition,stability:initialConditions?.stability,growth:initialConditions?.growth,
      })});
      const result=await response.json();
      if(id!==requestId.current)return;
      if(!response.ok){setChoices(result.choiceType==='region'?result.choices??[]:[]);throw new Error(result.error||'지도를 검색하지 못했습니다.');}
      setData(result);setViewportIds(null);setAppliedScore(next.score);setRange(next.range);
      onConditionsChange?.(result.conditions);
    }catch(reason){if(id===requestId.current)setError(reason.name==='TimeoutError'?'지도 분석이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.':reason.message);}
    finally{if(id===requestId.current)setLoading(false);}
  }
  useEffect(()=>{if(!comparisonSelection)search();return ()=>{requestId.current++;};},[]);
  useEffect(()=>{
    let cancelled=false,observer;
    async function start(){
      try {
        const [config,boundaries]=await Promise.all([
          fetch('/api/map-config').then(response=>{if(!response.ok)throw new Error();return response.json();}),
          fetch('/data/busan-dongs.geojson').then(response=>{if(!response.ok)throw new Error();return response.json();}),
        ]);
        if(cancelled)return;
        setFeatures(boundaries.features);
        if(!config.kakaoJavascriptKey){setMapStatus('key');return;}
        const kakao=await loadKakaoSdk(config.kakaoJavascriptKey);
        if(cancelled)return;
        sdk.current=kakao;
        map.current=new kakao.maps.Map(canvas.current,{center:new kakao.maps.LatLng(35.158,129.06),level:7});
        observer=new ResizeObserver(()=>map.current?.relayout());observer.observe(canvas.current);
        setMapStatus('ready');
      }catch {if(!cancelled)setMapStatus('error');}
    }
    start();
    return ()=>{cancelled=true;observer?.disconnect();map.current=null;};
  },[]);
  useEffect(()=>{setSelectedId(previous=>displayed.some(area=>area.id===previous)?previous:displayed[0]?.id??null);},[displayed]);

  useEffect(()=>{
    if(mapStatus!=='ready'||!map.current)return;
    const kakao=sdk.current,records=new Map(),removers=[];
    for(const area of displayed){
      const dong=area.name.slice(area.region.length+1);
      const feature=featureByKey.get(regionKey(area.region,dong));
      if(!feature)continue;
      const point=geometryAnchor(feature.geometry);
      if(!point)continue;
      const select=()=>{setSelectedId(area.id);focusArea.current?.(area.id);};
      const polygons=geometryPolygons(feature.geometry).map(rings=>{
        const polygon=new kakao.maps.Polygon({map:map.current,
          path:rings.map(ring=>ring.map(([lng,lat])=>new kakao.maps.LatLng(lat,lng))),
          strokeWeight:1,strokeColor:'#8694ad',strokeOpacity:.35,fillColor:'#2454d6',fillOpacity:.025,
        });
        kakao.maps.event.addListener(polygon,'click',select);
        removers.push(()=>kakao.maps.event.removeListener(polygon,'click',select));
        return polygon;
      });
      const button=document.createElement('button');button.type='button';button.className=`business-map-marker tier-${scoreTier(area.score)}`;
      button.setAttribute('aria-label',`${dong} ${area.score==null?'데이터 부족':`${area.score}점`} 선택`);
      const label=document.createElement('span');label.textContent=dong;
      const score=document.createElement('strong');score.textContent=area.score==null?'—':String(area.score);
      const tail=document.createElement('img');tail.src=`${icons}tail-${scoreTier(area.score)==='none'?'amber':scoreTier(area.score)}.svg`;tail.alt='';
      button.append(label,score,tail);button.addEventListener('click',select);
      removers.push(()=>button.removeEventListener('click',select));
      const overlay=new kakao.maps.CustomOverlay({map:map.current,position:new kakao.maps.LatLng(point[1],point[0]),content:button,yAnchor:1,zIndex:3});
      records.set(area.id,{area,feature,polygons,overlay,button,tail,point});
    }
    handles.current=records;
    focusArea.current=id=>{
      const record=records.get(id);if(!record)return;
      const bounds=geometryBounds(record.feature.geometry);
      const mobile=canvas.current.clientWidth<700;
      map.current.setBounds(new kakao.maps.LatLngBounds(new kakao.maps.LatLng(bounds[1],bounds[0]),new kakao.maps.LatLng(bounds[3],bounds[2])),90,mobile?35:370,mobile?340:80,40);
    };
    return ()=>{
      for(const remove of removers)remove();
      for(const record of records.values()){for(const polygon of record.polygons)polygon.setMap(null);record.overlay.setMap(null);}
      handles.current=new Map();focusArea.current=null;
    };
  },[displayed,featureByKey,mapStatus]);

  useEffect(()=>{
    for(const [id,record] of handles.current){
      const active=id===selectedId;
      for(const polygon of record.polygons)polygon.setOptions({strokeWeight:active?2:1,strokeColor:active?'#2454d6':'#8694ad',strokeOpacity:active?1:.35,strokeStyle:active?'shortdash':'solid',fillOpacity:active ? .15 : .025});
      record.button.classList.toggle('is-selected',active);record.button.setAttribute('aria-pressed',String(active));
      record.tail.src=`${icons}tail-${active?'selected':scoreTier(record.area.score)==='none'?'amber':scoreTier(record.area.score)}.svg`;
      record.overlay.setZIndex(active?5:3);
    }
  },[selectedId,displayed,mapStatus]);

  useEffect(()=>{
    if(mapStatus!=='ready'||!map.current||!data||!features.length)return;
    const ids=new Set(viewportIds??data.visibleIds),bounds=new sdk.current.maps.LatLngBounds();let count=0;
    for(const area of data.areas){
      if(!ids.has(area.id))continue;
      const feature=featureByKey.get(regionKey(area.region,area.name.slice(area.region.length+1)));if(!feature)continue;
      const box=geometryBounds(feature.geometry);bounds.extend(new sdk.current.maps.LatLng(box[1],box[0]));bounds.extend(new sdk.current.maps.LatLng(box[3],box[2]));count++;
    }
    if(count){
      const mobile=canvas.current.clientWidth<700;
      map.current.setBounds(bounds,90,mobile?30:360,mobile?360:80,35);
    }
  },[data,features,mapStatus,featureByKey,viewportIds]);

  useEffect(()=>{
    circle.current?.setMap(null);circle.current=null;
    if(range==='boundary'||!selected||mapStatus!=='ready')return;
    const record=handles.current.get(selected.id);if(!record)return;
    circle.current=new sdk.current.maps.Circle({map:map.current,center:new sdk.current.maps.LatLng(record.point[1],record.point[0]),radius:Number(range),strokeWeight:1,strokeColor:'#2454d6',strokeStyle:'dash',fillColor:'#2454d6',fillOpacity:.04});
    return ()=>{circle.current?.setMap(null);circle.current=null;};
  },[range,selectedId,displayed,mapStatus]);

  function searchViewport(){
    if(!map.current||!data)return;
    const bounds=map.current.getBounds(),sw=bounds.getSouthWest(),ne=bounds.getNorthEast();
    const ids=data.areas.filter(area=>{
      const feature=featureByKey.get(regionKey(area.region,area.name.slice(area.region.length+1)));if(!feature)return false;
      const box=geometryBounds(feature.geometry);
      return box[0]<=ne.getLng()&&box[2]>=sw.getLng()&&box[1]<=ne.getLat()&&box[3]>=sw.getLat();
    }).map(area=>area.id);
    setViewportIds(ids);
  }
  function locate(){
    if(!map.current||!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(position=>{map.current?.panTo(new sdk.current.maps.LatLng(position.coords.latitude,position.coords.longitude));},()=>setError('현재 위치를 확인하지 못했습니다.'),{timeout:7000});
  }
  const industries=[...new Set([filters.industry,...(data?.industries??[])])];
  return <section className="business-map-page" aria-labelledby="business-map-title">
    <h1 id="business-map-title">상권 지도</h1>
    <form className="business-map-filters panel" onSubmit={event=>{event.preventDefault();search();}}>
      <label className="business-region-input"><span aria-hidden="true">⌕</span><input aria-label="지역 또는 상권명" list="map-districts" value={filters.region} placeholder="지역 또는 상권명 검색" onChange={event=>setFilters({...filters,region:event.target.value})}/></label>
      <datalist id="map-districts">{data?.districts.map(district=><option key={district} value={district}/>)}</datalist>
      <label className="map-filter-select"><span>업종</span><select aria-label="지도 업종" value={filters.industry} onChange={event=>setFilters({...filters,industry:event.target.value})}>{industries.map(industry=><option key={industry} value={industry}>{industry===filters.industry&&/^[A-Za-z][0-9]{5}$/.test(industry)?data?.matchedIndustry||'선택한 업종':industry}</option>)}</select></label>
      <label className="map-filter-select"><span>상권 점수</span><select aria-label="상권 점수" value={filters.score} onChange={event=>setFilters({...filters,score:event.target.value})}><option value="all">전체</option><option value="80">80점 이상</option><option value="70">70점 이상</option><option value="60">60점 이상</option><option value="under60">60점 미만</option></select></label>
      <label className="map-filter-select"><span>지도 범위</span><select aria-label="지도 표시 범위" title="점수는 행정동 기준이며 원은 대표 지점 주변의 표시 범위입니다." value={filters.range} onChange={event=>setFilters({...filters,range:event.target.value})}><option value="boundary">행정동</option><option value="500">500m</option><option value="1000">1km</option></select></label>
      <button className="primary" disabled={loading} type="submit">{loading?'분석 중':'적용하기'}</button>
      <button className="map-reset" type="button" onClick={()=>{setFilters(defaultFilters);search(defaultFilters);}}>초기화</button>
    </form>
    {error&&<div className="error" role="alert"><p>{error}</p>{choices.map(choice=><button type="button" key={choice} onClick={()=>{const next={...filters,region:choice};setFilters(next);search(next);}}>{choice}</button>)}</div>}
    <div className="business-map-viewport">
      <div ref={canvas} className="business-map-canvas" aria-label="부산 상권 지도"/>
      {mapStatus!=='ready'&&<div className="business-map-unavailable" role="status"><strong>{mapStatus==='loading'?'카카오맵을 불러오고 있어요':'카카오맵을 불러올 수 없습니다'}</strong><span>{mapStatus==='key'?'카카오맵 키와 웹 도메인 설정을 확인해 주세요.':'지역 목록에서 상권 정보를 확인할 수 있습니다.'}</span></div>}
      <div className="map-location-bar"><img src={`${icons}pin.svg`} alt=""/><span>부산광역시</span><span>›</span><select aria-label="지도 지역" value={data?.districts.includes(filters.region)?filters.region:''} onChange={event=>{const next={...filters,region:event.target.value};setFilters(next);search(next);}}><option value="">{viewportIds?'현 지도 범위':data?.resolvedRegion||filters.region}</option>{data?.districts.map(district=><option key={district}>{district}</option>)}</select><img src={`${icons}chevron.svg`} alt=""/></div>
      <button className="map-search-viewport" type="button" disabled={mapStatus!=='ready'} onClick={searchViewport}>현 지도에서 재검색</button>
      {loading&&<span className="business-map-loading" role="status">상권 정보를 불러오고 있어요</span>}
      {selected&&<aside className="selected-market-panel" aria-labelledby="selected-market-title">
        <div className="selected-market-header"><span>선택한 상권</span><button type="button" aria-label="선택 상권 닫기" onClick={()=>setSelectedId(null)}><img src={`${icons}close.svg`} alt=""/></button></div>
        <h2 id="selected-market-title">{selected.name.slice(selected.region.length+1)} 상권</h2><p className="selected-market-address">부산광역시 {selected.name}</p>
        <div className="selected-market-tags">{selected.scores.stability!=null&&<span>안정성 {selected.scores.stability>=70?'높음':`${shown(selected.scores.stability)}점`}</span>}{selected.scores.competition!=null&&<span className="amber">{selected.scores.competition<40?'경쟁 다소 강함':'경쟁 적합'}</span>}</div>
        <div className="selected-market-score"><div><span>상권 종합 점수</span><strong>{selected.score==null?'자료 부족':selected.score>=80?'우수':selected.score>=70?'양호':selected.score>=60?'보통':'검토 필요'}</strong></div><b>{selected.score??'—'}</b><small>/ 100</small></div>
        <dl className="selected-market-metrics"><div><dt>평균 영업기간</dt><dd>{months(selected.historyContext?.averageOperatingMonths)}</dd></div><div><dt>누적 개업 / 폐업</dt><dd>{shown(selected.historyContext?.permitRecords)} / {shown(selected.historyContext?.closureRecords)}</dd></div><div><dt>동일 업종 점포</dt><dd>{shown(selected.metrics.industryStores)}개</dd></div></dl>
        <p className="selected-market-reason">{panelReason(selected)}</p>
        <button className="primary selected-market-detail" type="button" onClick={()=>onOpenDetail(selected,data)}><span>상권 상세 보기</span><img src={`${icons}arrow-right.svg`} alt=""/></button>
      </aside>}
      <div className="business-map-controls"><div><button type="button" aria-label="지도 확대" disabled={mapStatus!=='ready'} onClick={()=>map.current.setLevel(map.current.getLevel()-1)}><img src={`${icons}plus.svg`} alt=""/></button><button type="button" aria-label="지도 축소" disabled={mapStatus!=='ready'} onClick={()=>map.current.setLevel(map.current.getLevel()+1)}><img src={`${icons}minus.svg`} alt=""/></button></div><button type="button" aria-label="내 위치로 이동" disabled={mapStatus!=='ready'} onClick={locate}><img src={`${icons}locate.svg`} alt=""/></button></div>
    </div>
    <div className="business-map-footer"><span>점수·선택 영역은 행정동 기준입니다.</span><a href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">경계: SGIS · vuski/admdongkor, 2026.10 · CC BY 4.0</a></div>
    {(mapStatus!=='ready'||!displayed.length)&&<div className="business-map-region-list" aria-label="지도 상권 목록">{displayed.map(area=><button key={area.id} type="button" aria-pressed={selectedId===area.id} onClick={()=>{setSelectedId(area.id);focusArea.current?.(area.id);}}><span>{area.name}</span><strong>{area.score==null?'자료 부족':`${area.score}점`}</strong></button>)}{data&&!displayed.length&&<p>조건에 맞는 상권이 없습니다.</p>}</div>}
  </section>;
}
