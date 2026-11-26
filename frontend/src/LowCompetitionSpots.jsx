import React,{useEffect,useState} from 'react';

const meters=value=>`${Number(value).toLocaleString('ko-KR')}m`;
const shortAddress=address=>String(address||'').replace(/^부산광역시\s+\S+구\s+/,'');

export default function LowCompetitionSpots({areaId,dong,industry,industryCodes,map,maps}) {
  const [state,setState]=useState({status:'idle'});
  const [request,setRequest]=useState(0);

  useEffect(()=>{
    if(!request)return;
    const controller=new AbortController();
    const shapes=[];
    async function load(){
      setState({status:'loading'});
      try {
        const params=new URLSearchParams({area:areaId});
        for(const code of industryCodes)params.append('industryCode',code);
        const response=await fetch(`/api/map-spots?${params}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
        if(!response.ok)throw new Error('Spots unavailable');
        const result=await response.json();
        if(controller.signal.aborted)return;
        result.spots.forEach((spot,index)=>{
          const position=new maps.LatLng(spot.latitude,spot.longitude);
          shapes.push(new maps.Circle({map,center:position,radius:result.radius,strokeWeight:1,strokeColor:'#16804a',strokeStyle:'dash',fillColor:'#16804a',fillOpacity:.06}));
          const badge=document.createElement('span');badge.className='spot-marker';badge.textContent=String(index+1);
          badge.title=`경쟁이 적은 지점 ${index+1}`;
          shapes.push(new maps.CustomOverlay({map,position,content:badge,zIndex:6}));
        });
        setState({status:'ready',...result});
      } catch {
        if(!controller.signal.aborted)setState({status:'error'});
      }
    }
    load();
    return ()=>{controller.abort();for(const shape of shapes)shape.setMap(null);};
  },[areaId,industryCodes,map,maps,request]);

  const focus=spot=>{map.setLevel(4);map.panTo(new maps.LatLng(spot.latitude,spot.longitude));};

  return <section className="low-competition-spots" aria-labelledby="low-competition-title">
    <h3 id="low-competition-title">경쟁이 적은 지점</h3>
    <p className="spot-help">{dong} 안에서 반경 300m 안에 {industry} 점포가 적은 곳을 최대 3곳 찾아 지도에 초록색 번호로 표시해요.</p>
    <button type="button" className="spot-find" disabled={state.status==='loading'} onClick={()=>setRequest(value=>value+1)}>
      {state.status==='loading'?'찾는 중…':state.status==='ready'?'다시 찾기':'경쟁이 적은 지점 찾기'}
    </button>
    {state.status==='error'&&<p role="alert" className="spot-error">지점을 찾지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
    {state.status==='ready'&&(state.spots.length?<ol className="spot-list">{state.spots.map((spot,index)=><li key={`${spot.latitude},${spot.longitude}`}>
      <button type="button" onClick={()=>focus(spot)}>
        <b>{index+1}</b>
        <span><strong>{spot.address?`${shortAddress(spot.address)} 근처`:'주소 미확인 지점'}</strong>
          <small>반경 300m {industry} {spot.sameIndustryWithin}곳 · 가장 가까운 {industry} {spot.nearestSameIndustryMeters==null?'300m 안에 없음':meters(spot.nearestSameIndustryMeters)} · 주변 점포 {spot.storesWithin.toLocaleString('ko-KR')}곳</small></span>
      </button>
    </li>)}</ol>:<p className="spot-help">조건에 맞는 지점을 찾지 못했어요.</p>)}
    <details className="spot-guide">
      <summary>찾는 방법과 한계</summary>
      <p>찾는 방법</p>
      <ul>
        <li>지금 점포가 있는 위치를 50m 단위로 묶어 후보로 써요.</li>
        <li>주변 300m 안 점포 수가 {dong} 후보 중 중간 이상인 곳만 남겨, 너무 한적한 곳은 빼요.</li>
        <li>{industry} 점포가 적은 순, 가장 가까운 {industry} 점포가 먼 순으로 골라요. 옆 동 점포도 거리에 포함해요.</li>
      </ul>
      <p>한계</p>
      <ul>
        <li>점포가 하나도 없는 곳(신축 상가, 새로 개발된 거리 등)은 후보에서 빠져요.</li>
        <li>공실, 임대료, 용도지역은 반영하지 않아요. 실제로 입점할 수 있는지는 따로 확인해야 해요.</li>
        <li>거리는 직선거리예요. 도로, 하천, 철길 같은 실제 이동 경로는 반영하지 않아요.</li>
        <li>경쟁 점포가 적은 이유가 수요가 적어서일 수도 있어요.</li>
        <li>점포 데이터의 수집 시점이 표시되지 않아 지금 현황과 다를 수 있어요.</li>
      </ul>
    </details>
  </section>;
}
