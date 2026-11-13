import { loadHistorySnapshot, saveHistorySnapshot } from './history-store.js';
const key = process.env.DATA_GO_KR_SERVICE_KEY;
const semas = process.env.SEMAS_API_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const changeBase = process.env.BUSAN_CHANGE_API_BASE_URL || 'https://apis.data.go.kr/6260000/BusanCommercialChangeService';
const historyBase = process.env.BUSAN_STORE_HISTORY_API_BASE_URL || 'https://apis.data.go.kr/6260000/BusanCommercialHistoryService';
const cache = new Map();
const fields = {
  baroApi: ['ctprvnCd','signguCd','signguNm','adongCd','adongNm','stdrDt'],
  storeZoneInAdmi: ['trarNo','mainTrarNm','ctprvnCd','signguCd','signguNm','adongCd','stdrDt'],
  smallUpjongList: ['indsLclsCd','indsMclsCd','indsMclsNm','indsSclsCd','indsSclsNm','stdrDt'],
  largeUpjongList: ['indsLclsCd','indsLclsNm','stdrDt'],
  storeListInArea: ['bizesId','adongCd','adongNm','signguCd','signguNm','indsLclsCd','indsMclsCd','indsSclsCd','rdnmAdr','lnoAdr','stdrYm'],
  storeListInDong: ['bizesId','adongCd','adongNm','signguCd','signguNm','indsLclsCd','indsMclsCd','indsSclsCd','rdnmAdr','lnoAdr','stdrYm'],
  getCommercialChangeList: ['type_nm','comm_nm','change_indicator_nm','average_open_months','average_close_months','busan_average_open_months','busan_average_close_months'],
  getCommercialHistoryList: ['bplcnm','majornm','minornm','upjongnm','trdstatenm','geom','rdnwhladdr','apvpermymd','dcbymd']
};
const keys = { storeZoneInAdmi:'trarNo', smallUpjongList:'indsSclsCd', largeUpjongList:'indsLclsCd', storeListInArea:'bizesId', storeListInDong:'bizesId' };
const operationOf = route => route.split('/').filter(Boolean).at(-1);
const serviceOf = route => route.includes('CommercialChange') ? '부산 상권 변화지표' : route.includes('CommercialHistory') ? '부산 점포이력' : '소진공 상가정보';
const safeCode = value => value != null && /^[A-Za-z0-9_-]{1,40}$/.test(String(value)) ? String(value) : null;
const xmlTag = (text, tag) => text.match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*([^<]*)\\s*</${tag}>`, 'i'))?.[1]?.trim();
const reasonFor = (code, text = '') => {
  const s = `${code || ''} ${text}`.toLowerCase();
  if (/auth|key|access|credential|인증|활용/.test(s)) return '인증키 또는 해당 서비스 활용 권한을 확인해 주세요.';
  if (/limit|quota|exceed|traffic|초과|제한/.test(s)) return '호출 한도에 도달했습니다.';
  if (/param|argument|input|request|필수|변수/.test(s)) return '요청변수 또는 상세기능 경로를 확인해 주세요.';
  return '제공처가 오류를 반환했습니다.';
};
export class DataApiError extends Error {
  constructor(diagnostic, reason) {
    super(`${diagnostic.service} / ${diagnostic.operation}: ${reason}`);
    this.name = 'DataApiError'; this.diagnostic = diagnostic;
  }
}
function diagnostic(route, params, keyName, status = null, contentType = null, format = 'unknown', code = null) {
  return { service:serviceOf(route), operation:operationOf(route), status, contentType, format,
    parameterNames:[keyName, ...Object.keys(params)].sort(), code:safeCode(code) };
}
function select(row, operation) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return Object.fromEntries((fields[operation] || []).filter(name => row[name] !== undefined).map(name => [name,row[name]]));
}
function normalize(payload, operation) {
  const body = payload?.response?.body ?? payload?.body ?? payload;
  const raw = body?.items?.item ?? body?.items ?? body?.item ?? body?.data ?? [];
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const sourceFields = [...new Set(items.slice(0,3).flatMap(item => item && typeof item === 'object' ? Object.keys(item) : []))].filter(name => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)).sort();
  const totalValue = body?.totalCount ?? body?.totalCnt;
  const total = totalValue !== undefined && totalValue !== null && totalValue !== '' && Number.isSafeInteger(Number(totalValue)) && Number(totalValue) >= 0 ? Number(totalValue) : null;
  const rows = items.map(row => select(row,operation)).filter(Boolean);
  return { rows, total, invalid:items.length-rows.length, rawCount:items.length, sourceFields };
}
function cached(name, ttl, run) {
  const entry = cache.get(name);
  if (entry && entry.until > Date.now()) return entry.promise;
  const promise = run().catch(error => { cache.delete(name); throw error; });
  cache.set(name,{ promise, until:Date.now()+ttl }); return promise;
}
export async function request(base, route, params = {}, keyName = 'servicekey') {
  const operation = operationOf(route);
  if (!fields[operation]) throw new Error('지원하지 않는 공공데이터 상세기능입니다.');
  const initial = diagnostic(route,params,keyName);
  if (!key) throw new DataApiError(initial,'서버 인증키가 설정되지 않았습니다.');
  const url = new URL(base.replace(/\/$/,'')+route);
  let decoded = key;
  try { decoded = decodeURIComponent(key); } catch { /* raw key */ }
  // URLSearchParams applies URL encoding exactly once to a decoded service key.
  url.searchParams.set(keyName,decoded);
  for (const [name,value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(name,String(value));
  let response;
  try { response = await fetch(url,{signal:AbortSignal.timeout(12000)}); }
  catch { throw new DataApiError(initial,'제공처에 연결할 수 없습니다.'); }
  const text = await response.text();
  const trimmed = text.trim();
  const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim();
  const contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mediaType) ? mediaType.slice(0,60) : null;
  const format = !trimmed ? 'empty' : /^[\[{]/.test(trimmed) ? 'json' : /^<\s*(!doctype\s+html|html)/i.test(trimmed) ? 'html' : /^</.test(trimmed) ? 'xml' : 'other';
  let code = null, payload;
  if (format === 'json') {
    try { payload = JSON.parse(text); } catch { throw new DataApiError(diagnostic(route,params,keyName,response.status,contentType,'invalid-json'),'JSON 문법이 올바르지 않습니다.'); }
    const header = payload?.response?.header ?? payload?.header ?? payload;
    code = header?.resultCode ?? header?.resultCd ?? header?.returnReasonCode ?? null;
    if (code != null && !['00','0'].includes(String(code))) {
      throw new DataApiError(diagnostic(route,params,keyName,response.status,contentType,format,code),reasonFor(code,header?.resultMsg ?? header?.returnAuthMsg));
    }
  } else if (format === 'xml') {
    code = xmlTag(trimmed,'returnReasonCode') ?? xmlTag(trimmed,'resultCode');
    const detail = xmlTag(trimmed,'returnAuthMsg') ?? xmlTag(trimmed,'resultMsg') ?? xmlTag(trimmed,'errMsg') ?? '';
    throw new DataApiError(diagnostic(route,params,keyName,response.status,contentType,format,code),
      code != null && !['00','0'].includes(String(code)) ? reasonFor(code,detail) : 'JSON 요청에 XML이 반환됐습니다. 응답 형식과 요청변수를 확인해 주세요.');
  } else {
    const reason = format === 'html' ? 'HTML 오류 페이지가 반환됐습니다. 제공처 경로 또는 게이트웨이를 확인해 주세요.' :
      format === 'empty' ? '빈 응답이 반환됐습니다.' : '알 수 없는 응답 형식이 반환됐습니다.';
    throw new DataApiError(diagnostic(route,params,keyName,response.status,contentType,format),reason);
  }
  if (!response.ok) throw new DataApiError(diagnostic(route,params,keyName,response.status,contentType,format,code),`HTTP ${response.status} 오류입니다.`);
  return { ...normalize(payload,operation), diagnostic:diagnostic(route,params,keyName,response.status,contentType,format,code) };
}
export function deduplicate(rows, operation) {
  const keyName = keys[operation];
  if (!keyName) return { rows, duplicates:0, missingIds:0 };
  const seen = new Set(), unique = []; let duplicates = 0, missingIds = 0;
  for (const row of rows) {
    const id = row[keyName];
    if (id === undefined || id === null || id === '') { missingIds++; continue; }
    const value = String(id);
    if (seen.has(value)) { duplicates++; continue; }
    seen.add(value); unique.push(row);
  }
  return { rows:unique, duplicates, missingIds };
}
export async function pages(base, route, params, keyName, maxPages = 6, pageSize = 100) {
  const operation = operationOf(route), rows = [];
  let total = null, rawCount = 0, invalid = 0, lastDiagnostic = null, shortPage = false;
  for (let pageNo=1;pageNo<=maxPages;pageNo++) {
    const page = await request(base,route,{...params,pageNo,numOfRows:pageSize},keyName);
    rows.push(...page.rows); rawCount += page.rawCount; invalid += page.invalid;
    total = page.total ?? total; lastDiagnostic = page.diagnostic;
    shortPage = page.rawCount < pageSize;
    if (page.rawCount === 0 || (total !== null && rawCount >= total) || (total === null && shortPage)) break;
  }
  const distinct = deduplicate(rows,operation);
  const truncated = (!shortPage && (total === null || rawCount < total)) || (total !== null && rawCount < total) || invalid > 0 || distinct.missingIds > 0 || distinct.duplicates > 0;
  return { ...distinct, total, truncated, rawCount, invalid, diagnostic:lastDiagnostic };
}
export function zones() {
  return cached('busan-zones',3600000,async () => {
    const result = await request(semas,process.env.SEMAS_ZONES_BY_DONG_PATH || '/storeZoneInAdmi',{divId:'ctprvnCd',key:'26',type:'json'});
    const distinct = deduplicate(result.rows,'storeZoneInAdmi');
    if ((result.total !== null && result.rawCount < result.total) || distinct.missingIds) throw new DataApiError(result.diagnostic,'상권 목록이 일부만 제공됐거나 상권번호가 누락됐습니다.');
    const busan = distinct.rows.filter(row => String(row.ctprvnCd) === '26');
    if (busan.some(row => !/^\d{3,10}$/.test(String(row.trarNo)) || !/^\d{5}$/.test(String(row.signguCd)) || !row.mainTrarNm)) throw new DataApiError(result.diagnostic,'상권번호 또는 지역 필드가 올바르지 않습니다.');
    return busan;
  });
}
export function industryCodes(kind = 'small') {
  const route = kind === 'large' ? (process.env.SEMAS_UPJONG_LARGE_PATH || '/largeUpjongList') : (process.env.SEMAS_UPJONG_SMALL_PATH || '/smallUpjongList');
  return cached(`codes-${kind}`,86400000,async () => {
    const result = await request(semas,route,{type:'json'},kind === 'large' ? 'ServiceKey' : 'servicekey');
    const distinct = deduplicate(result.rows,operationOf(route));
    const codeField = kind === 'large' ? 'indsLclsCd' : 'indsSclsCd';
    const length = kind === 'large' ? 2 : 6;
    if ((result.total !== null && result.rawCount < result.total) || distinct.missingIds || distinct.rows.some(row => String(row[codeField]).length !== length)) throw new DataApiError(result.diagnostic,'업종 코드 목록이 불완전하거나 코드 형식이 올바르지 않습니다.');
    return { ...result, ...distinct };
  });
}
export function stores(zoneId, filter = {}) {
  if (!/^\d{3,10}$/.test(String(zoneId))) throw new Error('상권번호 형식이 올바르지 않습니다.');
  return cached(`stores-${zoneId}-${JSON.stringify(filter)}`,600000,async () => {
    const result = await pages(semas,process.env.SEMAS_STORES_BY_AREA_PATH || '/storeListInArea',{key:zoneId,type:'json',...filter},'ServiceKey',5);
    const invalidFilter = Object.entries(filter).some(([name,code]) => result.rows.some(row => String(row[name]) !== String(code)));
    return { ...result, truncated:result.truncated || invalidFilter, invalidFilter };
  });
}
export function dongStores(adongCd, filter = {}) {
  if (!/^26\d{6}(?:\d{2})?$/.test(String(adongCd))) throw new Error('행정동 코드 형식이 올바르지 않습니다.');
  return cached(`dong-${adongCd}-${JSON.stringify(filter)}`,600000,async () => {
    const result = await pages(semas,'/storeListInDong',{divId:'adongCd',key:adongCd,type:'json',...filter},'servicekey',10,1000);
    const invalid = result.rows.some(row => String(row.adongCd) !== String(adongCd) || Object.entries(filter).some(([name,code]) => String(row[name]) !== String(code)));
    return { ...result, truncated:result.truncated || invalid };
  });
}
export function discoverDongs(signguCd) {
  if (!/^26\d{3}$/.test(String(signguCd))) throw new Error('시군구 코드 형식이 올바르지 않습니다.');
  return cached(`discover-${signguCd}`,3600000,() =>
    request(semas,'/storeListInDong',{divId:'signguCd',key:signguCd,pageNo:1,numOfRows:1000,type:'json'},'servicekey'));
}
export function administrativeDongs() {
  return cached('busan-administrative-dongs',86400000,async()=>{
    const result=await request(semas,'/baroApi',{resId:'dong',catId:'admi',type:'json'},'ServiceKey');
    return result.rows.filter(row=>String(row.ctprvnCd)==='26' && /^26\d{6}(?:\d{2})?$/.test(String(row.adongCd)) &&
      /^26\d{3}$/.test(String(row.signguCd)) && row.adongNm && row.signguNm);
  });
}
export function changes() {
  return cached('changes',3600000,() => pages(changeBase,process.env.BUSAN_CHANGE_API_PATH || '/getCommercialChangeList',{resultType:'json'},'serviceKey',60,100));
}
// The live Busan endpoint accepts rdnwhladdr but currently returns the same
// unfiltered first page for every address. Fetch the published result set once
// and do exact address/category filtering locally; never treat a partial scan
// as a complete dong-level count.
export function history() {
  const ttl=Number(process.env.BUSAN_HISTORY_CACHE_TTL_MS)||86400000;
  return cached('history-all',ttl,async () => {
    const persistent=process.env.NODE_ENV!=='test';
    if(persistent) {
      const fresh=loadHistorySnapshot(ttl);
      if(fresh) return {...fresh,fromDisk:true};
    }
    const stale=persistent?loadHistorySnapshot(Number.MAX_SAFE_INTEGER):null;
    try {
      const route=process.env.BUSAN_STORE_HISTORY_API_PATH || '/getCommercialHistoryList';
      const pageSize=1000, maxPages=400, concurrency=3;
      const first=await request(historyBase,route,{resultType:'json',pageNo:1,numOfRows:pageSize},'serviceKey');
      if(first.total===null || first.total>maxPages*pageSize) return {...first,rows:first.rows,truncated:true};
      const pageCount=Math.ceil(first.total/pageSize);
      const rows=[...first.rows]; let rawCount=first.rawCount, invalid=first.invalid;
      const requested=Array.from({length:Math.max(0,pageCount-1)},(_,i)=>i+2);
      for(let i=0;i<requested.length;i+=concurrency) {
        const batch=await Promise.all(requested.slice(i,i+concurrency).map(pageNo=>
          request(historyBase,route,{resultType:'json',pageNo,numOfRows:pageSize},'serviceKey')));
        for(const page of batch) {
          if(page.total!==null && page.total!==first.total) throw new DataApiError(page.diagnostic,'점포이력 전체 건수가 페이지마다 달라 안전하게 집계할 수 없습니다.');
          rows.push(...page.rows); rawCount+=page.rawCount; invalid+=page.invalid;
        }
      }
      const seen=new Set(), unique=[];
      for(const row of rows) { const fingerprint=JSON.stringify(row); if(!seen.has(fingerprint)){seen.add(fingerprint);unique.push(row);} }
      const truncated=rawCount<first.total || invalid>0;
      const result={...first,rows:unique,total:first.total,rawCount,invalid,truncated,fromDisk:false,cachedAt:Date.now()};
      if(persistent&&!truncated) saveHistorySnapshot(result);
      return result;
    } catch(error) {
      if(stale) return {...stale,stale:true};
      throw error;
    }
  });
}
