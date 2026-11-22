import React,{useEffect,useState} from 'react';
import {storesInRange} from './commercial-map.mjs';

export default function StoreLocationPins({areaId,industry,industryCodes,range,center,map,maps}) {
  const [state,setState]=useState({status:'loading'});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const markers=[];
    const popup=new maps.InfoWindow({removable:true});
    const clear=()=>{
      popup.close();
      for(const {marker,show} of markers){
        maps.event.removeListener(marker,'click',show);
        marker.setMap(null);
      }
      markers.length=0;
    };
    async function load(){
      setState({status:'loading'});
      try {
        const params=new URLSearchParams({area:areaId});
        for(const code of industryCodes)params.append('industryCode',code);
        const response=await fetch(`/api/map-stores?${params}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
        if(!response.ok)throw new Error('Store locations unavailable');
        const {stores}=await response.json();
        if(controller.signal.aborted)return;
        const visible=storesInRange(stores,range,center);
        for(const store of visible){
          const name=store.name||'점포명 미등록';
          const position=new maps.LatLng(store.latitude,store.longitude);
          const marker=new maps.Marker({map,position,title:name,clickable:true});
          const show=()=>{
            const content=document.createElement('div');content.className='kakao-place-popup';
            const title=document.createElement('strong');title.textContent=name;content.append(title);
            if(store.address){
              const address=document.createElement('p');address.textContent=store.address;content.append(address);
            }
            popup.setContent(content);popup.open(map,marker);
          };
          markers.push({marker,show});
          maps.event.addListener(marker,'click',show);
        }
        setState({status:'ready',count:markers.length});
      } catch {
        if(controller.signal.aborted)return;
        clear();
        setState({status:'error'});
      }
    }
    load();
    return ()=>{controller.abort();clear();};
  },[areaId,industryCodes,range,center,map,maps,retry]);

  return <div className="selected-market-store-pins">
    <p role="status">{state.status==='loading'?'점포 위치를 불러오고 있어요.':
      state.status==='error'?'점포 위치를 불러오지 못했어요.':
      state.count?`${industry} 점포 ${state.count.toLocaleString('ko-KR')}곳을 지도에 표시했어요.`:
      `선택 범위에 위치가 확인된 ${industry} 점포가 없어요.`}</p>
    {state.status==='error'&&<button type="button" onClick={()=>setRetry(value=>value+1)}>다시 시도</button>}
  </div>;
}
