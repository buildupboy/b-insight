import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConditions, validate, InputError, ConditionServiceError } from './conditions.js';
import { resolveRegion } from './region-lookup.js';
import { resolveDbIndustry, resolveIndustryIntent } from './industry-match.js';
import { makeCandidate, rank } from './score.js';
import { describePreferences } from './preferences.js';
import { loadRecommendationData, loadIndustryCounts, RecommendationDbError } from './recommendation-db.js';
import { loadAreaContexts } from './recommendation-context-db.js';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const json = (response, status, value) => { response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); response.end(JSON.stringify(value)); };
const logTiming = (status, timing) => { if (process.env.NODE_ENV !== 'test') console.info(JSON.stringify({event:'recommendation_analyze',status,timing})); };
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
export function historyMetrics(result,dong,industry,conditions,storeRows) {
  if(result.truncated||result.total===null||result.rawCount<result.total) return {verified:false,reason:'\uC774\uB825 \uC804\uCCB4 \uC870\uD68C \uBBF8\uC644\uB8CC ('+result.rawCount+'/'+(result.total??'\uC804\uCCB4 \uAC74\uC218 \uBBF8\uD655\uC778')+')'};
  const wanted=historyIndustryTerms(industry,conditions);
  const addressKey=value=>compact(value).replace(/\uBD80\uC0B0\uAD11\uC5ED\uC2DC|\uBD80\uC0B0\uC2DC|\uBD80\uC0B0/g,'').replaceAll(compact(dong.signguNm),'');
  const addressKeys=new Set(storeRows.filter(r=>String(r.adongCd||'')===String(dong.adongCd)).flatMap(r=>[r.rdnmAdr,r.lnoAdr]).filter(Boolean).map(addressKey).filter(Boolean));
  const addressBuckets=new Map();
  for(const key of addressKeys){const prefix=key.slice(0,6);addressBuckets.set(prefix,[...(addressBuckets.get(prefix)||[]),key]);}
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
  const periodStart=new Date(latestValues.reduce((min,date)=>Math.min(min,date.valueOf()),Infinity));
  const periodEnd=latest;
  const monthly=new Map();
  for (const month=new Date(Date.UTC(periodStart.getUTCFullYear(),periodStart.getUTCMonth(),1)); month<=periodEnd; month.setUTCMonth(month.getUTCMonth()+1)) {
    const key=month.toISOString().slice(0,7);
    monthly.set(key,{month:key,openings:0,closures:0});
  }
  const seen=new Set(); let openings=0,closures=0,matched=0,addressMatched=rowsInDong.length; const tenures=[];
  for(const row of matchedRows){
    matched++;
    const address=compact(row.rdnwhladdr), categories=[row.upjongnm,row.minornm,row.majornm].map(compact).filter(Boolean);
    const opened=parseEventDate(row.apvpermymd), closed=parseEventDate(row.dcbymd);
    const key=[compact(row.bplcnm),address,...categories,opened?.toISOString()||'',closed?.toISOString()||''].join('|');
    if(seen.has(key)) continue; seen.add(key);
    if(opened) { openings++; monthly.get(opened.toISOString().slice(0,7)).openings++; }
    if(closed) { closures++; monthly.get(closed.toISOString().slice(0,7)).closures++; }
    if(opened&&closed&&closed>=opened) tenures.push((closed-opened)/(1000*60*60*24*30.4375));
  }
  if(result.rawCount&&matched===0) {
    return {verified:false,reason:'\uC774\uB825 '+result.rawCount.toLocaleString('ko-KR')+'\uAC74 \uC911 \uD589\uC815\uB3D9 \uC8FC\uC18C \uC77C\uCE58 '+addressMatched.toLocaleString('ko-KR')+'\uAC74, \uC801\uC6A9 \uC5C5\uC885 \uBD84\uB958\uC758 \uC720\uD6A8 \uC774\uB825\uC740 0\uAC74'};
  }
  return {verified:true,truncated:false,openings,closures,monthly:[...monthly.values()],closedTenureMonths:tenures.length?Math.round(tenures.reduce((a,b)=>a+b,0)/tenures.length):null,matchedRows:matched,categoryScope,period:{from:periodStart.toISOString().slice(0,10),to:periodEnd.toISOString().slice(0,10),latestObserved:latest.toISOString().slice(0,10)},fields:['rdnwhladdr','upjongnm','minornm','majornm','apvpermymd','dcbymd']};
}
async function readBody(request) {
  let value = '';
  for await (const chunk of request) { value += chunk; if (value.length > 12000) throw new InputError('입력 크기를 줄여 주세요.'); }
  try { return JSON.parse(value); } catch { throw new InputError('요청 형식이 올바르지 않습니다.'); }
}
export async function analyze(input, repository = { loadRecommendationData, loadIndustryCounts, loadAreaContexts }, resultLimit=3) {
  const timing = { conditionExtractionMs:null, dbQueryMs:null, historyQueryMs:null, changeQueryMs:null, scoringMs:null, serverTotalMs:null };
  let conditions;
  let step = performance.now(), stage = 'conditions';
  try {
    conditions = input.conditions ? validate(input.conditions) : await parseConditions(input.prompt);
    timing.conditionExtractionMs = Math.round(performance.now() - step);
    step = performance.now(); stage = 'database';
    const data = await repository.loadRecommendationData();
    timing.dbQueryMs = Math.round(performance.now() - step);
    stage = 'matching';
    if (!data.coverage.total || !data.areas.length) throw new RecommendationDbError('Supabase에 추천 가능한 부산 점포가 없습니다.');
    const region = await resolveRegion(input.regionChoice || conditions.region, data.areas);
    const industryResolution = input.industryChoice || input.conditions
      ? { requested:input.industryChoice || conditions.industry,
          match:resolveDbIndustry(input.industryChoice || conditions.industry,data.industries), recovered:false }
      : resolveIndustryIntent(conditions.industry,input.prompt,data.industries);
    const industry = industryResolution.match;
    if (industryResolution.recovered || input.industryChoice)
      conditions = { ...conditions, industry:industryResolution.requested };
    step = performance.now(); stage = 'database-analysis';
    // One existing industry-count query covers every Busan dong; the requested region limits results, not score normalization.
    const [areaCounts,contexts] = await Promise.all([
      repository.loadIndustryCounts(industry.codes,data.areas),
      repository.loadAreaContexts(data.areas),
    ]);
    timing.dbQueryMs += Math.round(performance.now() - step);
    timing.historyQueryMs=contexts.historyQueryMs;
    timing.changeQueryMs=contexts.changeQueryMs;
    step = performance.now(); stage = 'scoring';
    const candidates = areaCounts.map(row => {
      const dong = { adongCd:Buffer.from(`${row.district_name}|${row.dong_name}`).toString('base64url'), signguNm:row.district_name, adongNm:row.dong_name };
      const all = { count:row.total }, filtered = { count:row.selected, total:row.selected, rawCount:row.selected };
      const candidate = makeCandidate(dong, all, filtered, industry);
      candidate.changeContext = null;
      return candidate;
    });
    for (const row of candidates) {
      const areaKey=`${row.region}\0${row.name.slice(row.region.length+1)}`;
      const history=contexts.history.get(areaKey) ?? null;
      row.historyContext=history;
      row.marketReferences=[];
      row.metrics.stability=history?.stability ?? null;
      row.metrics.growth=history?.growth ?? null;
      row.metrics.survivalContext=row.metrics.stability;
      row.provenance.stability=Number.isFinite(row.metrics.stability)?['public.commercial_history_by_dong (행정동 전체 업종 평균 영업기간)']:[];
      row.provenance.growth=Number.isFinite(row.metrics.growth)?['public.commercial_history_by_dong (행정동 전체 업종 공통 12개월 순증감 비율)']:[];
      row.notes=['안정성과 성장성은 행정동 전체 업종의 과거 이력 기준입니다.'];
    }
    const included = new Set(region.areas.map(area=>`${area.district_name}\0${area.dong_name}`));
    const scoped = candidates.filter(row=>included.has(`${row.region}\0${row.name.slice(row.region.length+1)}`));
    const results = rank(candidates,conditions,scoped,resultLimit);
    const normalizationBasis = {scope:'부산 전체 행정동',candidateCount:candidates.length,
      scoredCandidateCount:candidates.filter(row=>row.score!=null).length,method:'5·95백분위'};
    const preferenceSummary = describePreferences(conditions,results);
    timing.scoringMs = Math.round(performance.now()-step);
    const warnings = ['안정성과 성장성은 행정동 전체 업종의 과거 이력 기준이며 현재 성장률이나 선택 업종만의 평가가 아닙니다.'];
    if (industry.note) warnings.push(industry.note);
    if (region.note) warnings.push(region.note);
    for (const item of preferenceSummary.unsupported) warnings.push(`${item.label} 조건: ${item.reason}`);
    return { ...(region.attribution?{regionAttribution:region.attribution}:{}),conditions, preferenceSummary, normalizationBasis, resolvedRegion:region.label, matchedIndustry:industry.label, industryCode:industry.filter,
      results, warnings, analyzedAt:new Date().toISOString(), sources:['Supabase PostgreSQL public.stores (부산 점포)',
        'public.commercial_history_by_dong (행정동 전체 업종·전체 기간)'], timing };
  } catch (error) {
    if (error.requestedIndustry && conditions && !conditions.industry)
      conditions = { ...conditions, industry:error.requestedIndustry };
    if (stage === 'conditions') timing.conditionExtractionMs = Math.round(performance.now() - step);
    if (stage === 'database') timing.dbQueryMs = Math.round(performance.now() - step);
    if (stage === 'database-analysis') timing.dbQueryMs += Math.round(performance.now() - step);
    if (stage === 'scoring') timing.scoringMs = Math.round(performance.now() - step);
    error.timing = timing;
    error.extractedConditions = conditions ?? error.extractedConditions;
    throw error;
  }
}
export async function analyzeMap(input,repository={loadRecommendationData,loadIndustryCounts,loadAreaContexts}) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new InputError('지도 검색 조건을 확인해 주세요.');
  const conditions=validate({industry:input.industry ?? '카페',region:input.region ?? '부산진구',
    competition:input.competition ?? 'normal',stability:input.stability ?? 'normal',growth:input.growth ?? 'normal'});
  const data=await repository.loadRecommendationData();
  const scope=await resolveRegion(conditions.region,data.areas);
  const analysis=await analyze({prompt:'상권 지도',conditions:{...conditions,region:'부산 전체'}},
    {...repository,loadRecommendationData:async()=>data},data.areas.length);
  const visible=new Set(scope.areas.map(area=>`${area.district_name}\0${area.dong_name}`));
  return {conditions,resolvedRegion:scope.label,matchedIndustry:analysis.matchedIndustry,
    industries:[...new Set(data.industries.map(row=>row.industry_name))].sort((a,b)=>a.localeCompare(b,'ko')),
    districts:[...new Set(data.areas.map(row=>row.district_name))].sort((a,b)=>a.localeCompare(b,'ko')),
    visibleIds:analysis.results.filter(row=>visible.has(`${row.region}\0${row.name.slice(row.region.length+1)}`)).map(row=>row.id),
    areas:analysis.results.map(row=>({id:row.id,name:row.name,region:row.region,score:row.score,verdict:row.verdict,
      scores:row.scores,effectiveWeights:row.effectiveWeights,metrics:row.metrics,
      historyContext:row.historyContext?{averageOperatingMonths:row.historyContext.averageOperatingMonths,
        permitRecords:row.historyContext.permitRecords,closureRecords:row.historyContext.closureRecords}:null})),
    ...(scope.attribution?{regionAttribution:scope.attribution}:{})};
}

export const server = createServer(async (request, response) => {
  try {
    const requested = new URL(request.url, 'http://localhost').pathname;
    if (requested === '/api/health') return json(response, 200, { ok:true, openaiConfigured:Boolean(process.env.OPENAI_API_KEY), databaseConfigured:Boolean(process.env.DATABASE_URL) });
    if (requested === '/api/map-config') {
      response.setHeader('Cache-Control','no-store');
      return json(response,200,{kakaoJavascriptKey:process.env.KAKAO_JAVASCRIPT_KEY || ''});
    }
    if (requested === '/api/map-data') {
      if(request.method!=='POST')return json(response,405,{error:'POST 요청이 필요합니다.'});
      try {return json(response,200,await analyzeMap(await readBody(request)));}
      catch(error){return json(response,error instanceof InputError?422:502,{
        error:error instanceof InputError || error instanceof RecommendationDbError?error.message:'상권 지도 데이터를 조회할 수 없습니다.',
        choices:error.choices ?? [],choiceType:error.choiceType ?? null});}
    }
    if (requested === '/api/analyze') {
      if (request.method !== 'POST') return json(response, 405, { error:'POST 요청이 필요합니다.' });
      const started = performance.now();
      try {
        const input = await readBody(request);
        if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2000) throw new InputError('창업 조건을 2000자 이내로 입력해 주세요.');
        const result = await analyze(input);
        result.timing.serverTotalMs = Math.round(performance.now() - started);
        logTiming(200, result.timing);
        return json(response, 200, result);
      } catch (error) {
        const status = error instanceof InputError ? 422 : error instanceof ConditionServiceError ? 503 : 502;
        const timing = { ...(error.timing || {}), serverTotalMs:Math.round(performance.now() - started) };
        logTiming(status, timing);
        return json(response, status, { error:error instanceof InputError || error instanceof RecommendationDbError || error instanceof ConditionServiceError ? error.message : '분석을 완료할 수 없습니다.',
          choices:error instanceof InputError ? error.choices : [], choiceType:error.choiceType ?? null,
          conditions:error.extractedConditions ?? null,
          timing });
      }
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
