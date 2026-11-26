export const regionKey=(district,dong)=>`${district}\0${dong.replace(/제(?=\d+동$)/,'')}`;
export const scoreTier=score=>!Number.isFinite(score)?'none':score>=80?'blue':score>=70?'green':'amber';
export function matchesScore(score,filter) {
  if(filter==='all')return true;
  if(!Number.isFinite(score))return false;
  return filter==='under60'?score<60:score>=Number(filter);
}
export function geometryPolygons(geometry) {
  if(geometry?.type==='Polygon')return [geometry.coordinates];
  if(geometry?.type==='MultiPolygon')return geometry.coordinates;
  return [];
}
export function geometryBounds(geometry) {
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(const polygon of geometryPolygons(geometry))for(const ring of polygon)for(const [lng,lat] of ring){
    bounds[0]=Math.min(bounds[0],lng);bounds[1]=Math.min(bounds[1],lat);
    bounds[2]=Math.max(bounds[2],lng);bounds[3]=Math.max(bounds[3],lat);
  }
  return bounds;
}
const ringArea=ring=>Math.abs(ring.reduce((sum,[x,y],i)=>{const next=ring[(i+1)%ring.length];return sum+x*next[1]-next[0]*y;},0));
export function geometryAnchor(geometry) {
  const polygon=[...geometryPolygons(geometry)].sort((a,b)=>ringArea(b[0])-ringArea(a[0]))[0];
  if(!polygon)return null;
  const bounds=geometryBounds({type:'Polygon',coordinates:polygon});
  const lat=(bounds[1]+bounds[3])/2;
  const intersections=[];
  for(const ring of polygon)for(let i=0;i<ring.length-1;i++){
    const [x1,y1]=ring[i],[x2,y2]=ring[i+1];
    if((y1>lat)!==(y2>lat))intersections.push(x1+(lat-y1)*(x2-x1)/(y2-y1));
  }
  intersections.sort((a,b)=>a-b);
  let width=-1,point=null;
  for(let i=0;i+1<intersections.length;i+=2){
    if(intersections[i+1]-intersections[i]>width){width=intersections[i+1]-intersections[i];point=[(intersections[i]+intersections[i+1])/2,lat];}
  }
  return point;
}

export function storesInRange(stores, range, center) {
  if(range==='boundary')return stores;
  if(!center)return [];
  const radians=degrees=>degrees*Math.PI/180;
  const [longitude,latitude]=center;
  return stores.filter(store=>{
    const dLat=radians(store.latitude-latitude),dLng=radians(store.longitude-longitude);
    const arc=Math.sin(dLat/2)**2+Math.cos(radians(latitude))*Math.cos(radians(store.latitude))*Math.sin(dLng/2)**2;
    const distance=2*6371008.8*Math.asin(Math.min(1,Math.sqrt(arc)));
    return distance<=Number(range);
  });
}

export function panelReason(area) {
  if(area.score==null)return '비교할 수 있는 데이터가 부족합니다.';
  if(area.scores.stability>=70&&area.scores.growth>=70)return '과거 안정성과 성장 흐름이 좋은 상권이에요.';
  if(area.scores.competition>=70)return '동일 업종의 경쟁 부담이 낮은 편이에요.';
  if(area.scores.fit>=70)return '상업 활동이 활발한 지역이에요.';
  return '경쟁과 영업 이력을 함께 비교해 보세요.';
}
