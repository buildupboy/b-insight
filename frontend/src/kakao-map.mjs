export function competitionQuery(area,industry) {
  return `부산광역시 ${area.name} ${industry.replace(/전체$/,'').replaceAll('/',' ').trim()}`;
}

export function kakaoSearchUrl(area,industry) {
  return `https://map.kakao.com/link/search/${encodeURIComponent(competitionQuery(area,industry))}`;
}

export function safeKakaoPlaceUrl(value) {
  try {const url=new URL(value);return url.protocol==='https:' && url.hostname==='place.map.kakao.com'?url.href:null;}
  catch {return null;}
}

let sdkPromise;
export function loadKakaoSdk(key) {
  if(window.kakao?.maps?.services)return Promise.resolve(window.kakao);
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timeout=setTimeout(()=>fail(),12000);
    const fail=()=>{clearTimeout(timeout);script.remove();reject(new Error('Kakao map unavailable'));};
    script.src=`https://dapi.kakao.com/v2/maps/sdk.js?${new URLSearchParams({appkey:key,autoload:'false',libraries:'services'})}`;
    script.async=true;
    script.onerror=fail;
    script.onload=()=>{
      if(!window.kakao?.maps){fail();return;}
      window.kakao.maps.load(()=>{
        if(!window.kakao.maps.services){fail();return;}
        clearTimeout(timeout);
        resolve(window.kakao);
      });
    };
    document.head.append(script);
  }).catch(error=>{sdkPromise=undefined;throw error;});
  return sdkPromise;
}
