import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConditions, validate, InputError, ConditionServiceError } from './conditions.js';
import { resolveDbRegion } from './region-match.js';
import { resolveDbIndustry, resolveIndustryIntent } from './industry-match.js';
import { makeCandidate, rank } from './score.js';
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
    if(opened&&opened>=periodStart&&opened<=periodEnd) { openings++; monthly.get(opened.toISOString().slice(0,7)).openings++; }
    if(closed&&closed>=periodStart&&closed<=periodEnd) { closures++; monthly.get(closed.toISOString().slice(0,7)).closures++; }
    if(opened&&closed&&closed>=opened) tenures.push((closed-opened)/(1000*60*60*24*30.4375));
  }
  if(result.rawCount&&matched===0) {
    return {verified:false,reason:'\uC774\uB825 '+result.rawCount.toLocaleString('ko-KR')+'\uAC74 \uC911 \uD589\uC815\uB3D9 \uC8FC\uC18C \uC77C\uCE58 '+addressMatched.toLocaleString('ko-KR')+'\uAC74, \uC801\uC6A9 \uC5C5\uC885 \uBD84\uB958\uC758 \uC720\uD6A8 \uC774\uB825\uC740 0\uAC74'};
  }
  return {verified:true,truncated:false,openings,closures,monthly:[...monthly.values()],closedTenureMonths:tenures.length?Math.round(tenures.reduce((a,b)=>a+b,0)/tenures.length):null,matchedRows:matched,categoryScope,period:{from:periodStart.toISOString().slice(0,10),to:periodEnd.toISOString().slice(0,10),stale,latestObserved:latest.toISOString().slice(0,10)},fields:['rdnwhladdr','upjongnm','minornm','majornm','apvpermymd','dcbymd']};
}
async function readBody(request) {
  let value = '';
  for await (const chunk of request) { value += chunk; if (value.length > 12000) throw new InputError('입력 크기를 줄여 주세요.'); }
  try { return JSON.parse(value); } catch { throw new InputError('요청 형식이 올바르지 않습니다.'); }
}
export async function analyze(input, repository = { loadRecommendationData, loadIndustryCounts, loadAreaContexts }) {
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
    const region = resolveDbRegion(input.regionChoice || conditions.region, data.areas);
    const industryResolution = input.industryChoice || input.conditions
      ? { requested:input.industryChoice || conditions.industry,
          match:resolveDbIndustry(input.industryChoice || conditions.industry,data.industries), recovered:false }
      : resolveIndustryIntent(conditions.industry,input.prompt,data.industries);
    const industry = industryResolution.match;
    if (industryResolution.recovered || input.industryChoice)
      conditions = { ...conditions, industry:industryResolution.requested };
    step = performance.now(); stage = 'database-counts';
    const areaCounts = await repository.loadIndustryCounts(industry.codes, region.areas);
    timing.dbQueryMs += Math.round(performance.now() - step);
    step = performance.now(); stage = 'scoring';
    const candidates = areaCounts.map(row => {
      const dong = { adongCd:Buffer.from(`${row.district_name}|${row.dong_name}`).toString('base64url'), signguNm:row.district_name, adongNm:row.dong_name };
      const all = { count:row.total }, filtered = { count:row.selected, total:row.selected, rawCount:row.selected };
      const candidate = makeCandidate(dong, all, filtered, industry);
      candidate.changeContext = null;
      return candidate;
    });
    const results = rank(candidates, conditions);
    timing.scoringMs = Math.round(performance.now() - step);
    step = performance.now(); stage = 'database-context';
    const selectedAreas = results.map(row => ({district_name:row.region,dong_name:row.name.slice(row.region.length+1)}));
    const contexts = await repository.loadAreaContexts(selectedAreas);
    timing.historyQueryMs = contexts.historyQueryMs;
    timing.changeQueryMs = contexts.changeQueryMs;
    timing.dbQueryMs += Math.round(performance.now() - step);
    for (const row of results) {
      const areaKey = `${row.region}\0${row.name.slice(row.region.length+1)}`;
      row.historyContext = contexts.history.get(areaKey) ?? null;
      row.marketReferences = contexts.markets.get(areaKey) ?? [];
    }
    const warnings = ['점포 DB에 기준월이 없어 점포 수의 관측 시점을 표시할 수 없습니다.',
      '상권 변화지표는 행정동 전체의 검증된 생존 지표가 아니므로 안정성 점수에 반영하지 않았습니다.',
      '점포이력은 최신 사건일이 오래됐고 현재 점포 업종코드와 분류 체계가 달라 동일 업종 개업·폐업 및 성장성 점수를 제외했습니다.'];
    if (industry.note) warnings.push(industry.note);
    if (region.note) warnings.push(region.note);
    if (conditions.populationRequested) warnings.push('인구·유동인구 자료가 DB에 없어 요청한 인구 지표는 점수에 반영하지 않았습니다.');
    if (conditions.stability === 'important') warnings.push('안정성 우선 요청은 적용 가능한 안정성 점수가 없어 가중치에 반영되지 않았습니다.');
    if (conditions.growth === 'important') warnings.push('성장성 우선 요청은 적용 가능한 성장성 점수가 없어 가중치에 반영되지 않았습니다.');
    if (region.scope === 'dong') warnings.push('행정동 한 곳의 점포 수는 표시하지만 상대평가 점수는 계산할 수 없습니다.');
    return { conditions, resolvedRegion:region.label, matchedIndustry:industry.label, industryCode:industry.filter,
      results, warnings, analyzedAt:new Date().toISOString(), sources:['Supabase PostgreSQL public.stores (부산 점포)',
        'public.commercial_history_by_dong (행정동 전체 업종 참고)',
        'public.commercial_change_by_dong (상권 단위 참고)'], timing };
  } catch (error) {
    if (error.requestedIndustry && conditions && !conditions.industry)
      conditions = { ...conditions, industry:error.requestedIndustry };
    if (stage === 'conditions') timing.conditionExtractionMs = Math.round(performance.now() - step);
    if (stage === 'database') timing.dbQueryMs = Math.round(performance.now() - step);
    if (stage === 'database-counts') timing.dbQueryMs += Math.round(performance.now() - step);
    if (stage === 'database-context') timing.dbQueryMs += Math.round(performance.now() - step);
    if (stage === 'scoring') timing.scoringMs = Math.round(performance.now() - step);
    error.timing = timing;
    error.extractedConditions = conditions ?? error.extractedConditions;
    throw error;
  }
}
export const server = createServer(async (request, response) => {
  try {
    const requested = new URL(request.url, 'http://localhost').pathname;
    if (requested === '/api/health') return json(response, 200, { ok:true, openaiConfigured:Boolean(process.env.OPENAI_API_KEY), databaseConfigured:Boolean(process.env.DATABASE_URL) });
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
