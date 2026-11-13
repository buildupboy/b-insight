import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConditions, validate, InputError } from './conditions.js';
import { zones, stores, dongStores, discoverDongs, administrativeDongs, industryCodes, changes, history, DataApiError } from './data.js';
import { resolveRegion, resolveIndustry } from './resolve.js';
import { makeCandidate, rank } from './score.js';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const json = (response, status, value) => { response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); response.end(JSON.stringify(value)); };
const compact = value => String(value || '').toLowerCase().replace(/[\s_\-·(),./]/g,'');
const parseEventDate = value => {
  const m=String(value||'').match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if(!m) return null;
  const d=new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.valueOf())?null:d;
};
function historyIndustryTerms(industry,conditions) {
  const wanted=new Set([industry.label,industry.parent?.label,conditions.industry].map(compact).filter(v=>v.length>=2));
  const requested=[...wanted].join(' ');
  if(/[\uCE74\uD398]|[\uCEE4\uD53C]|[\uC74C\uB8CC]/.test(requested)) {
    for(const term of ['\uCE74\uD398','\uCEE4\uD53C','\uCEE4\uD53C\uC804\uBB38\uC810','\uCEE4\uD53C\u00B7\uC74C\uB8CC','\uCEE4\uD53C\uC810/\uCE74\uD398','\uC74C\uB8CC','\uBE44\uC54C\uCF5C \uC74C\uB8CC\uC810\uC5C5']) wanted.add(compact(term));
  }
  if(/^(\uC74C\uC2DD\uC810|\uC2DD\uB2F9|\uC678\uC2DD)$/.test(compact(industry.label))||/^(\uC74C\uC2DD\uC810|\uC2DD\uB2F9|\uC678\uC2DD)$/.test(compact(conditions.industry))) wanted.add(compact('\uC678\uC2DD'));
  return wanted;
}
function isHistoryIndustry(row,wanted) {
  const categories=[row.upjongnm,row.minornm,row.majornm].map(compact).filter(Boolean);
  return categories.some(c=>[...wanted].some(w=>c===w||(w.length>=2&&c.includes(w))||(w.length>=3&&w.includes(c))));
}
function latestIndustryEventDate(rows,industry,conditions) {
  const wanted=historyIndustryTerms(industry,conditions); let latest=null;
  for(const row of rows) {
    if(!isHistoryIndustry(row,wanted)) continue;
    for(const value of [row.apvpermymd,row.dcbymd]) { const date=parseEventDate(value); if(date&&(!latest||date>latest)) latest=date; }
  }
  return latest;
}
export function historyMetrics(result,dong,industry,conditions,storeRows,coverageDate=null) {
  if(result.truncated||result.total===null||result.rawCount<result.total) return {verified:false,reason:'\uC774\uB825 \uC804\uCCB4 \uC870\uD68C \uBBF8\uC644\uB8CC ('+result.rawCount+'/'+(result.total??'\uC804\uCCB4 \uAC74\uC218 \uBBF8\uD655\uC778')+')'};
  const wanted=historyIndustryTerms(industry,conditions);
  const addressKey=value=>compact(value).replace(/\uBD80\uC0B0\uAD11\uC5ED\uC2DC|\uBD80\uC0B0\uC2DC|\uBD80\uC0B0/g,'').replaceAll(compact(dong.signguNm),'');
  const addressKeys=new Set(storeRows.filter(r=>String(r.adongCd||'')===String(dong.adongCd)).flatMap(r=>[r.rdnmAdr,r.lnoAdr]).filter(Boolean).map(addressKey).filter(Boolean));
  const addressBuckets=new Map();
  for(const key of addressKeys){const prefix=key.slice(0,6);addressBuckets.set(prefix,[...(addressBuckets.get(prefix)||[]),key]);}
  const now=new Date();
  const addressMatches=row=>{
    const address=compact(row.rdnwhladdr), normalized=addressKey(row.rdnwhladdr);
    if(address.includes(compact(dong.adongNm))) return true;
    if(!normalized) return false;
    if(addressKeys.has(normalized)) return true;
    const candidates=normalized.length<6?[...addressKeys]:addressBuckets.get(normalized.slice(0,6))||[];
    return candidates.some(key=>normalized.startsWith(key)||key.startsWith(normalized));
  };
  const rowsInDong=result.rows.filter(addressMatches);
  const exactRows=rowsInDong.filter(row=>isHistoryIndustry(row,wanted));
  // 부산 이력의 업종 분류는 소진공 코드와 체계가 다릅니다. 세부 분류로
  // 충분한 표본을 연결하지 못하면 검증된 대분류(외식)까지 넓혀 동 단위
  // 업종 흐름을 계산하고, 결과에 집계 범위를 명시합니다.
  const foodIntent=[industry.label,industry.parent?.label,conditions.industry].some(value=>/카페|커피|음료|음식|식당|외식|제과|베이커리/.test(String(value||'')));
  const broadRows=foodIntent?rowsInDong.filter(row=>compact(row.majornm)==='외식'):[];
  const useBroad=exactRows.length<25&&broadRows.length>exactRows.length;
  const matchedRows=useBroad?broadRows:exactRows;
  const categoryScope=useBroad?'부산 점포이력 대분류 외식업 전체(동 기준)':`부산 점포이력 세부 업종 ${industry.label}(동 기준)`;
  const latestValues=matchedRows.flatMap(row=>[parseEventDate(row.apvpermymd),parseEventDate(row.dcbymd)]).filter(Boolean);
  const latest=latestValues.length?new Date(latestValues.reduce((max,date)=>Math.max(max,date.valueOf()),0)):null;
  if(!latest) {
    const rowsWithAnyDate=matchedRows.filter(row=>parseEventDate(row.apvpermymd)||parseEventDate(row.dcbymd)).length;
    return {verified:false,reason:matchedRows.length?`행정동·업종 일치 ${matchedRows.length.toLocaleString('ko-KR')}건 중 유효한 개업·폐업 날짜가 있는 행이 ${rowsWithAnyDate}건입니다.`:'행정동 주소와 업종을 함께 확인한 점포이력 행이 없습니다.'};
  }
  const requestedStart=new Date(Date.UTC(latest.getUTCFullYear(),latest.getUTCMonth()-conditions.months,latest.getUTCDate()));
  // 이력 API에는 현재 시점까지의 최신 자료가 항상 있는 것은 아니므로
  // 데이터에서 확인되는 마지막 사건일을 끝점으로 삼아 최신 관측 1년을 계산합니다.
  const periodEnd=latest, periodStart=requestedStart;
  const currentWindowStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-conditions.months,now.getUTCDate()));
  const stale=latest<currentWindowStart;
  const seen=new Set(); let openings=0,closures=0,matched=0,addressMatched=rowsInDong.length; const tenures=[];
  for(const row of matchedRows){
    matched++;
    const address=compact(row.rdnwhladdr), categories=[row.upjongnm,row.minornm,row.majornm].map(compact).filter(Boolean);
    const opened=parseEventDate(row.apvpermymd), closed=parseEventDate(row.dcbymd);
    const key=[compact(row.bplcnm),address,...categories,opened?.toISOString()||'',closed?.toISOString()||''].join('|');
    if(seen.has(key)) continue; seen.add(key);
    if(opened&&opened>=periodStart&&opened<=periodEnd) openings++;
    if(closed&&closed>=periodStart&&closed<=periodEnd) closures++;
    if(opened&&closed&&closed>=opened) tenures.push((closed-opened)/(1000*60*60*24*30.4375));
  }
  if(result.rawCount&&matched===0) {
    return {verified:false,reason:'\uC774\uB825 '+result.rawCount.toLocaleString('ko-KR')+'\uAC74 \uC911 \uD589\uC815\uB3D9 \uC8FC\uC18C \uC77C\uCE58 '+addressMatched.toLocaleString('ko-KR')+'\uAC74, \uC801\uC6A9 \uC5C5\uC885 \uBD84\uB958\uC758 \uC720\uD6A8 \uC774\uB825\uC740 0\uAC74'};
  }
  return {verified:true,truncated:false,openings,closures,closedTenureMonths:tenures.length?Math.round(tenures.reduce((a,b)=>a+b,0)/tenures.length):null,matchedRows:matched,categoryScope,period:{from:periodStart.toISOString().slice(0,10),to:periodEnd.toISOString().slice(0,10),stale,latestObserved:latest.toISOString().slice(0,10)},fields:['rdnwhladdr','upjongnm','minornm','majornm','apvpermymd','dcbymd']};
}
async function readBody(request) {
  let value = '';
  for await (const chunk of request) { value += chunk; if (value.length > 12000) throw new InputError('입력 크기를 줄여 주세요.'); }
  try { return JSON.parse(value); } catch { throw new InputError('요청 형식이 올바르지 않습니다.'); }
}
export async function analyze(input) {
  const conditions = input.conditions ? validate(input.conditions) : await parseConditions(input.prompt);
  const warnings = [];
  const allZones = await zones();
  if (!allZones.length) throw new InputError('부산 상권 후보를 찾지 못했습니다.');
  const region = resolveRegion(conditions.region, allZones);
  const small = await industryCodes('small');
  let industry;
  try { industry = resolveIndustry(conditions.industry, small.rows, []); }
  catch (error) {
    if (!(error instanceof InputError)) throw error;
    industry = resolveIndustry(conditions.industry, small.rows, (await industryCodes('large')).rows);
  }
  const dongs = new Map();
  const zoneDongCodes = new Map();
  for (const zone of region.zones.slice(0, 10)) {
    if (/^26\d{6}(?:\d{2})?$/.test(String(zone.adongCd)))
      dongs.set(String(zone.adongCd), { adongCd:String(zone.adongCd), adongNm:null, signguNm:zone.signguNm, signguCd:String(zone.signguCd) });
    if (/^26\d{6}(?:\d{2})?$/.test(String(zone.adongCd))) zoneDongCodes.set(String(zone.trarNo),new Set([String(zone.adongCd)]));
    try {
      const area = await stores(zone.trarNo);
      for (const row of area.rows) {
        if (/^26\d{6}(?:\d{2})?$/.test(String(row.adongCd)) && (!row.signguCd || String(row.signguCd) === String(zone.signguCd)))
          { dongs.set(String(row.adongCd), { adongCd:String(row.adongCd), adongNm:row.adongNm || dongs.get(String(row.adongCd))?.adongNm || null, signguNm:row.signguNm || zone.signguNm, signguCd:String(zone.signguCd) }); const codes=zoneDongCodes.get(String(zone.trarNo))||new Set(); codes.add(String(row.adongCd)); zoneDongCodes.set(String(zone.trarNo),codes); }
      }
    } catch (error) { warnings.push(error instanceof DataApiError ? error.message : '행정동 후보 확인 실패'); }
  }
  if (dongs.size < 2) {
    const districtCodes=[...new Set(region.zones.map(z=>String(z.signguCd)).filter(code=>/^26\d{3}$/.test(code)))];
    for (const code of districtCodes.slice(0, 2)) {
      try {
        const discovered=await discoverDongs(code);
        for (const row of discovered.rows) if (/^26\d{6}(?:\d{2})?$/.test(String(row.adongCd)) && String(row.signguCd)===code && row.adongNm && row.signguNm)
          dongs.set(String(row.adongCd),{adongCd:String(row.adongCd),adongNm:row.adongNm,signguNm:row.signguNm,signguCd:code});
        if (discovered.total !== null && discovered.rawCount < discovered.total)
          warnings.push('시군구의 점포 첫 페이지에서 행정동 후보를 추가로 확인했습니다. 전체 행정동 목록은 아닙니다.');
      } catch(error) { warnings.push(error instanceof DataApiError ? error.message : '시군구 행정동 후보 조회 실패'); }
    }
  }
  if (dongs.size < 2) {
    try {
      const listed=await administrativeDongs();
      const districtCodes=new Set(region.zones.map(z=>String(z.signguCd)));
      for (const dong of listed) if (districtCodes.has(String(dong.signguCd)))
        dongs.set(String(dong.adongCd),{adongCd:String(dong.adongCd),adongNm:dong.adongNm,signguNm:dong.signguNm,signguCd:String(dong.signguCd)});
      if (dongs.size>1) warnings.push('상권 주변 행정동 자료가 부족해 같은 구의 행정동으로 비교 범위를 넓혔습니다.');
    } catch(error) { warnings.push(error instanceof DataApiError ? error.message : '행정동 코드 자료 조회 실패'); }
  }
  if (region.zones.length > 10) warnings.push('관련 상권 10곳에서 확인된 행정동만 비교했습니다.');
  if (dongs.size > 12) warnings.push('먼저 확인된 행정동 12곳만 비교했습니다.');
  const survivalByDong = new Map();
  try {
    const change=await changes();
    if (!change.truncated || (change.total !== null && change.rawCount >= change.total)) {
      const zoneNames=new Map(), changeNames=new Map();
      const compact=value=>String(value||'').replace(/\s|_/g,'');
      for (const zone of allZones) { const name=compact(zone.mainTrarNm); zoneNames.set(name,[...(zoneNames.get(name)||[]),zone]); }
      for (const row of change.rows) { const name=compact(row.comm_nm); changeNames.set(name,[...(changeNames.get(name)||[]),row]); }
      const values=new Map();
      for (const [name,items] of zoneNames) {
        const matched=changeNames.get(name);
        const dongCodes=zoneDongCodes.get(String(items[0].trarNo)) || new Set(items[0].adongCd?[String(items[0].adongCd)]:[]);
        if (items.length!==1 || !dongCodes.size || [...dongCodes].some(code=>!/^26\d{6}(?:\d{2})?$/.test(code)) || !matched?.length) continue;
        const monthsValues=[...new Set(matched.map(row=>row.average_open_months).filter(v=>v!==null&&v!==undefined&&v!=='').map(Number).filter(v=>Number.isFinite(v)&&v>0&&v<=1200))];
        if (monthsValues.length!==1) continue;
        for (const dongCode of dongCodes) values.set(dongCode,[...(values.get(dongCode)||[]),monthsValues[0]]);
      }
      for (const [code,months] of values) survivalByDong.set(code,Math.round(months.reduce((a,b)=>a+b,0)/months.length));
    } else warnings.push('부산 변화지표 일부 페이지를 확인하지 못해 생존기간 참고값을 제외했습니다.');
  } catch(error) { warnings.push(error instanceof DataApiError ? error.message : '부산 변화지표 조회 실패'); }
  let historyData=null, historyCoverage=null;
  try {
    historyData=await history();
    if(!historyData.truncated) historyCoverage=latestIndustryEventDate(historyData.rows,industry,conditions);
    if(historyData.truncated) warnings.push(`부산 점포이력 전체 자료 조회가 미완료라 개업·폐업 수치는 표시하지 않습니다 (${historyData.rawCount}/${historyData.total??'전체 건수 확인 불가'}).`);
    if(historyData.stale) warnings.push(`새 점포이력 조회 실패로 저장된 이전 자료(${new Date(historyData.cachedAt).toLocaleDateString('ko-KR')})를 사용합니다.`);
  } catch(error) { warnings.push(error instanceof DataApiError ? error.message : '부산 점포이력 전체 자료 조회 실패'); }
  const candidates = [];
  for (const dong of [...dongs.values()].slice(0, 12)) {
    let all={rows:[],truncated:true}, filtered={rows:[],truncated:true};
    try { all=await dongStores(dong.adongCd); }
    catch (error) { warnings.push(error instanceof DataApiError ? error.message : dong.signguNm+' '+dong.adongNm+' 전체 점포 조회 실패'); }
    try { filtered=await dongStores(dong.adongCd,industry.filter); }
    catch (error) { warnings.push(error instanceof DataApiError ? error.message : dong.signguNm+' '+dong.adongNm+' 선택 업종 조회 실패'); }
    const names=[...new Set(all.rows.map(r=>r.adongNm).filter(Boolean))];
    if (!dong.adongNm && names.length === 1) dong.adongNm=names[0];
    if (!dong.adongNm) { warnings.push(dong.signguNm+' 행정동 이름을 확인할 수 없어 해당 후보를 제외했습니다.'); continue; }
    let events=null;
    try {
      if(!historyData) throw new Error('history unavailable');
      const mapped=historyMetrics(historyData,dong,industry,conditions,all.rows,historyCoverage);
      events=mapped;
      if(!mapped.verified) warnings.push(`${dong.signguNm} ${dong.adongNm}: ${mapped.reason}`);
      else if(mapped.period?.stale) warnings.push(`점포이력 최신 관측일은 ${mapped.period.latestObserved}입니다. 개업·폐업은 제공 자료의 최근 ${conditions.months}개월(${mapped.period.from}~${mapped.period.to}) 기준으로 표시합니다.`);
    } catch(error) { events={verified:false,reason:error instanceof DataApiError?error.message:'history fetch failed'}; warnings.push(`${dong.signguNm} ${dong.adongNm}: ${events.reason}`); }
    const survival=survivalByDong.get(dong.adongCd)??events?.closedTenureMonths??null;
    candidates.push(makeCandidate(dong,all,filtered,industry,events,survival));
  }
  return { conditions, resolvedRegion:region.label, matchedIndustry:industry.label, industryCode:industry.filter,
    results:rank(candidates,conditions), warnings:[...new Set(warnings)],
    analyzedAt:new Date().toISOString(),
    sources:['소상공인시장진흥공단 행정동 점포','부산광역시 상권 변화지표(같은 구 참고값)','부산광역시 상권 점포이력(업종 연결 확인 전 제외)'] };
}
export const server = createServer(async (request, response) => {
  try {
    const requested = new URL(request.url, 'http://localhost').pathname;
    if (requested === '/api/health') return json(response, 200, { ok:true, openaiConfigured:Boolean(process.env.OPENAI_API_KEY), publicDataConfigured:Boolean(process.env.DATA_GO_KR_SERVICE_KEY) });
    if (requested === '/api/analyze') {
      if (request.method !== 'POST') return json(response, 405, { error:'POST 요청이 필요합니다.' });
      try {
        const input = await readBody(request);
        if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2000) throw new InputError('창업 조건을 2000자 이내로 입력해 주세요.');
        return json(response, 200, await analyze(input));
      } catch (error) { return json(response, error instanceof InputError ? 422 : 502, { error:error instanceof InputError || error instanceof DataApiError ? error.message : '분석을 완료할 수 없습니다.', choices:error instanceof InputError ? error.choices : [], ...(error instanceof DataApiError ? { diagnostic:error.diagnostic } : {}) }); }
    }
    if (requested.startsWith('/api/')) return json(response, 404, {error:'API 경로를 찾을 수 없습니다.'});
    const relativePath = decodeURIComponent(requested);
    let target = relativePath === '/' ? path.join(dist, 'index.html') : path.resolve(dist, `.${relativePath}`);
    const relative = path.relative(dist, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end('Forbidden'); return; }
    try { if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
    catch { target = path.join(dist, 'index.html'); }
    const staticContent = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
    response.end(staticContent);
  } catch { response.writeHead(500).end('Server error'); }
});
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 4173);
  server.listen(port, () => console.log(`B-Insight is available at http://localhost:${port}`));
}
