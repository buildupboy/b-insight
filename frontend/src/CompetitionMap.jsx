import React, {useEffect,useRef,useState} from 'react';
import {competitionQuery,kakaoSearchUrl,loadKakaoSdk,safeKakaoPlaceUrl} from './kakao-map.mjs';

export default function CompetitionMap({area,industry}) {
  const container=useRef(null),showPlace=useRef(null);
  const [status,setStatus]=useState('loading'),[places,setPlaces]=useState([]),[selected,setSelected]=useState(null);
  const [pagination,setPagination]=useState(null);
  const link=kakaoSearchUrl(area,industry);
  useEffect(()=>{
    let cancelled=false,markers=[],listeners=[],info,observer;
    setStatus('loading');setPlaces([]);setSelected(null);setPagination(null);
    const clear=()=>{info?.close();for(const remove of listeners)remove();listeners=[];for(const marker of markers)marker.setMap(null);markers=[];showPlace.current=null;};
    async function start(){
      try {
        const response=await fetch('/api/map-config',{signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw new Error('Map config unavailable');
        const {kakaoJavascriptKey}=await response.json();
        if(!kakaoJavascriptKey){if(!cancelled)setStatus('external');return;}
        const kakao=await loadKakaoSdk(kakaoJavascriptKey);
        if(cancelled)return;
        const map=new kakao.maps.Map(container.current,{center:new kakao.maps.LatLng(35.1796,129.0756),level:5});
        info=new kakao.maps.InfoWindow({zIndex:2,removable:true});
        const service=new kakao.maps.services.Places();
        service.keywordSearch(competitionQuery(area,industry),(data,result,pages)=>{
          if(cancelled)return;
          clear();
          if(result===kakao.maps.services.Status.ZERO_RESULT){setStatus('empty');setPlaces([]);setPagination(null);return;}
          if(result!==kakao.maps.services.Status.OK){setStatus('error');return;}
          const found=data.filter(place=>Number.isFinite(Number(place.x))&&Number.isFinite(Number(place.y)));
          if(!found.length){setStatus('empty');return;}
          const bounds=new kakao.maps.LatLngBounds();
          const select=(place,marker)=>{
            const content=document.createElement('div');content.className='kakao-place-popup';
            const title=document.createElement('strong');title.textContent=place.place_name;content.append(title);
            const address=document.createElement('p');address.textContent=place.road_address_name||place.address_name;content.append(address);
            const url=safeKakaoPlaceUrl(place.place_url);
            if(url){const anchor=document.createElement('a');anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent='카카오맵에서 보기 ↗';content.append(anchor);}
            info.setContent(content);info.open(map,marker);map.panTo(marker.getPosition());setSelected(place.id);
          };
          for(const place of found){
            const position=new kakao.maps.LatLng(Number(place.y),Number(place.x));
            const marker=new kakao.maps.Marker({map,position,title:place.place_name});
            const handler=()=>select(place,marker);
            kakao.maps.event.addListener(marker,'click',handler);
            listeners.push(()=>kakao.maps.event.removeListener(marker,'click',handler));
            markers.push(marker);bounds.extend(position);
          }
          showPlace.current=place=>{const index=found.findIndex(row=>row.id===place.id);if(index>=0)select(place,markers[index]);};
          map.setBounds(bounds);setPlaces(found);setPagination(pages);setSelected(null);setStatus('ready');
        },{size:15});
        observer=new ResizeObserver(()=>map.relayout());observer.observe(container.current);
      }catch {if(!cancelled)setStatus('error');}
    }
    start();
    return ()=>{cancelled=true;observer?.disconnect();clear();};
  },[area.id,area.name,industry]);

  return <aside className="panel detail-map" id="competition-map" aria-labelledby="competition-title">
    <div className="detail-map-title"><h2 id="competition-title">주변 경쟁 점포</h2><a href={link} target="_blank" rel="noreferrer">크게 보기 ↗</a></div>
    <div className="kakao-map-frame">
      <div className="kakao-map-canvas" ref={container} aria-label={`${area.name} ${industry} 점포 지도`}/>
      {status!=='ready'&&<div className="kakao-map-state" role="status">
        <strong>{status==='loading'?'주변 점포를 찾고 있어요':status==='empty'?'검색된 점포가 없습니다':'카카오맵에서 주변 점포를 확인하세요'}</strong>
        <span>{area.name} · {industry}</span>
        <a href={link} target="_blank" rel="noreferrer">카카오맵 열기 ↗</a>
      </div>}
    </div>
    <div className="detail-map-legend"><span><img src="/figma-assets/detail-shop.svg" alt=""/>동일 업종 검색 결과</span><span className="kakao-map-brand">Kakao Map</span></div>
    {status==='ready'&&<>
      <ul className="competition-place-list" aria-label="주변 점포 목록">{places.map(place=><li key={place.id}>
        <button type="button" aria-pressed={selected===place.id} onClick={()=>showPlace.current?.(place)}><strong>{place.place_name}</strong><span>{place.road_address_name||place.address_name}</span></button>
        {safeKakaoPlaceUrl(place.place_url)&&<a href={safeKakaoPlaceUrl(place.place_url)} target="_blank" rel="noreferrer" aria-label={`${place.place_name} 카카오맵 상세 보기`}>↗</a>}
      </li>)}</ul>
      {pagination?.last>1&&<div className="competition-pagination" role="group" aria-label="점포 검색 페이지">
        {Array.from({length:pagination.last},(_,i)=><button type="button" key={i} aria-pressed={pagination.current===i+1} onClick={()=>pagination.gotoPage(i+1)}>{i+1}</button>)}
      </div>}
    </>}
  </aside>;
}
