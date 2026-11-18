import pg from 'pg';
import { RecommendationDbError } from './recommendation-db.js';
import { historySampleMinimums } from './history-industry.js';

const options = { connectionTimeoutMillis:8000, query_timeout:15000 };
const validDate = value => {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$|^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const year=match[1]??match[4], month=match[2]??match[5], day=match[3]??match[6];
  if (year === '0000') return null;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === iso ? iso : null;
};
const key = (district,dong) => `${district}\0${dong}`;
const dayMilliseconds = 24*60*60*1000;
const daysPerMonth = 365.2425/12;

// Group only the requested administrative dongs. The source has no stable
// business licence ID, so records are deduplicated by their event fields.
function makeHistoryCteSql(targetSql = 'SELECT * FROM unnest($1::text[], $2::text[]) AS t(district_name,dong_name)', categorySql = '$3::jsonb') {
  return `WITH target AS (${targetSql}), dedup AS (
    SELECT h.district_name, h.administrative_dong_name,
      btrim(coalesce(h.bplcnm,'')) AS bplcnm,
      btrim(coalesce(h.rdnwhladdr,'')) AS rdnwhladdr,
      btrim(coalesce(h.majornm,'')) AS majornm,
      btrim(coalesce(h.minornm,'')) AS minornm,
      btrim(coalesce(h.upjongnm,'')) AS upjongnm,
      btrim(coalesce(h.trdstatenm,'')) AS trdstatenm,
      btrim(coalesce(h.apvpermymd,'')) AS apvpermymd,
      btrim(coalesce(h.dcbymd,'')) AS dcbymd,
      count(*)::int AS copies
    FROM public.commercial_history_by_dong h
    JOIN target t ON h.district_name=t.district_name
      AND h.administrative_dong_name=t.dong_name
    WHERE (${categorySql} IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(${categorySql}) AS category(majornm text,minornm text,upjongnm text)
      WHERE btrim(h.majornm)=category.majornm AND btrim(h.minornm)=category.minornm AND btrim(h.upjongnm)=category.upjongnm
    ))
    GROUP BY 1,2,3,4,5,6,7,8,9,10
  ), normalized AS (
    SELECT *, replace(apvpermymd,'-','') AS permit_text,
      replace(dcbymd,'-','') AS closure_text
    FROM dedup
  ), parsed AS (
    SELECT *,
      CASE WHEN apvpermymd ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{8})$'
        AND permit_text ~ '^[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
        AND left(permit_text,4)<>'0000'
        THEN CASE WHEN right(permit_text,2)::int <= extract(day FROM (make_date(left(permit_text,4)::int,substring(permit_text,5,2)::int,1) + interval '1 month - 1 day'))
          THEN to_date(permit_text,'YYYYMMDD') END END AS parsed_permit,
      CASE WHEN dcbymd ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{8})$'
        AND closure_text ~ '^[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
        AND left(closure_text,4)<>'0000'
        THEN CASE WHEN right(closure_text,2)::int <= extract(day FROM (make_date(left(closure_text,4)::int,substring(closure_text,5,2)::int,1) + interval '1 month - 1 day'))
          THEN to_date(closure_text,'YYYYMMDD') END END AS parsed_closure
    FROM normalized
  ), valid AS (
    SELECT *,
      CASE WHEN to_char(parsed_permit,'YYYYMMDD')=permit_text THEN parsed_permit END AS permit_date,
      CASE WHEN to_char(parsed_closure,'YYYYMMDD')=closure_text THEN parsed_closure END AS closure_date
    FROM parsed
  )`;
}
const historyCteSql=makeHistoryCteSql();

const historyEventsCte = `events AS (
    SELECT district_name, administrative_dong_name, permit_date AS date, 1 AS openings, 0 AS closures
    FROM valid WHERE permit_date IS NOT NULL
    UNION ALL
    SELECT district_name, administrative_dong_name, closure_date AS date, 0 AS openings, 1 AS closures
    FROM valid WHERE trdstatenm='폐업' AND closure_date IS NOT NULL
  )`;
const historyMonthlySelect = `SELECT district_name, administrative_dong_name, to_char(date,'YYYY-MM') AS month,
      sum(openings)::int AS openings, sum(closures)::int AS closures
    FROM events GROUP BY district_name,administrative_dong_name,to_char(date,'YYYY-MM')
    ORDER BY month`;
export const historyMonthlySql = `${historyCteSql}, ${historyEventsCte} ${historyMonthlySelect}`;

export function fillHistoryMonths(rows) {
  if (!rows.length) return [];
  const found = new Map(rows.map(row => [row.month, row]));
  const months = [...found.keys()].sort();
  const result = [];
  const end = months.at(-1);
  let [year, month] = months[0].split('-').map(Number);
  for (let current = months[0]; current <= end; current = `${year}-${String(month).padStart(2,'0')}`) {
    const row = found.get(current);
    result.push({month:current, openings:Number(row?.openings ?? 0), closures:Number(row?.closures ?? 0)});
    if (++month > 12) { month = 1; year++; }
  }
  return result;
}

const historyAggregateSelect = `SELECT district_name, administrative_dong_name,
      count(*)::int AS records,
      coalesce(sum(copies-1),0)::int AS duplicate_records,
      count(*) FILTER (WHERE trdstatenm='폐업')::int AS closed_state_records,
      count(*) FILTER (WHERE permit_date IS NOT NULL)::int AS permit_records,
      count(*) FILTER (WHERE trdstatenm='폐업' AND closure_date IS NOT NULL)::int AS closure_records,
      count(*) FILTER (WHERE trdstatenm<>'폐업' AND closure_date IS NOT NULL)::int AS non_closed_status_with_date,
      count(*) FILTER (WHERE trdstatenm='폐업' AND apvpermymd='')::int AS missing_permit,
      count(*) FILTER (WHERE trdstatenm='폐업' AND apvpermymd<>'' AND permit_date IS NULL)::int AS invalid_permit,
      count(*) FILTER (WHERE trdstatenm='폐업' AND dcbymd='')::int AS missing_closure,
      count(*) FILTER (WHERE trdstatenm='폐업' AND dcbymd<>'' AND closure_date IS NULL)::int AS invalid_closure,
      count(*) FILTER (WHERE trdstatenm='폐업' AND permit_date IS NOT NULL
        AND closure_date IS NOT NULL AND closure_date<permit_date)::int AS reversed_dates,
      count(*) FILTER (WHERE trdstatenm='폐업' AND permit_date IS NOT NULL
        AND closure_date IS NOT NULL AND closure_date>=permit_date)::int AS valid_sample,
      (avg((closure_date-permit_date)::numeric) FILTER (WHERE trdstatenm='폐업'
        AND permit_date IS NOT NULL AND closure_date IS NOT NULL
        AND closure_date>=permit_date) / (365.2425::numeric/12))::float8 AS average_operating_months,
      min(permit_date)::text AS permit_from,
      max(permit_date)::text AS permit_to,
      min(closure_date) FILTER (WHERE trdstatenm='폐업')::text AS closure_from,
      max(closure_date) FILTER (WHERE trdstatenm='폐업')::text AS closure_to,
      min(permit_date) FILTER (WHERE trdstatenm='폐업' AND permit_date IS NOT NULL
        AND closure_date IS NOT NULL AND closure_date>=permit_date)::text AS tenure_from,
      max(closure_date) FILTER (WHERE trdstatenm='폐업' AND permit_date IS NOT NULL
        AND closure_date IS NOT NULL AND closure_date>=permit_date)::text AS tenure_to,
      min(least(permit_date,CASE WHEN trdstatenm='폐업' THEN closure_date END))::text AS first_observed,
      max(greatest(permit_date,CASE WHEN trdstatenm='폐업' THEN closure_date END))::text AS last_observed
    FROM valid GROUP BY district_name,administrative_dong_name`;

export const historyAggregateSql = `${historyCteSql} ${historyAggregateSelect}`;
// Both aggregates share the same deduplicated, validated records in one statement.
export const historyContextSql = `${historyCteSql}, ${historyEventsCte},
  area_totals AS (${historyAggregateSelect}),
  monthly_totals AS (${historyMonthlySelect})
  SELECT coalesce((SELECT jsonb_agg(t) FROM area_totals t),'[]'::jsonb) AS history_rows,
    coalesce((SELECT jsonb_agg(m ORDER BY m.month) FROM monthly_totals m),'[]'::jsonb) AS monthly_rows`;

export const historySummaryAvailabilitySql = "SELECT to_regclass('binsight_private.history_summary') IS NOT NULL AS available";
export const historySummaryReadSql = 'SELECT history_rows,monthly_rows FROM binsight_private.history_summary WHERE id=1 AND schema_version=1';
export const historySummaryBuildSql = `${makeHistoryCteSql(
  'SELECT DISTINCT district_name,administrative_dong_name AS dong_name FROM public.commercial_history_by_dong WHERE district_name IS NOT NULL AND administrative_dong_name IS NOT NULL',
  'NULL::jsonb')}, ${historyEventsCte},
  area_totals AS (${historyAggregateSelect}), monthly_totals AS (${historyMonthlySelect})
  SELECT coalesce((SELECT jsonb_agg(t) FROM area_totals t),'[]'::jsonb) AS history_rows,
    coalesce((SELECT jsonb_agg(m ORDER BY m.month) FROM monthly_totals m),'[]'::jsonb) AS monthly_rows`;

export function historyFromAggregate(rows, targets, monthlyRows = []) {
  const found = new Map(rows.map(row => [key(row.district_name,row.administrative_dong_name),row]));
  const monthly = new Map();
  for (const row of monthlyRows) {
    const areaKey = key(row.district_name,row.administrative_dong_name);
    if (!monthly.has(areaKey)) monthly.set(areaKey, []);
    monthly.get(areaKey).push(row);
  }
  return new Map(targets.map(area => {
    const row = found.get(key(area.district_name,area.dong_name));
    const records = row?.records ?? 0;
    return [key(area.district_name,area.dong_name), {
      scope:'행정동 전체 업종', source:'public.commercial_history_by_dong',
      records, duplicateRecords:row?.duplicate_records ?? 0,
      eventTrend:fillHistoryMonths(monthly.get(key(area.district_name,area.dong_name)) ?? []),
      closedStateRecords:records ? row.closed_state_records : null,
      permitRecords:records ? row.permit_records : null,
      closureRecords:records ? row.closure_records : null,
      nonClosedStatusWithDate:records ? row.non_closed_status_with_date : null,
      undatedClosedRecords:(row?.missing_closure ?? 0)+(row?.invalid_closure ?? 0),
      averageOperatingMonths:row?.valid_sample ? Number(row.average_operating_months) : null,
      validSample:records ? row.valid_sample : null,
      excludedSampleRecords:records ? row.closed_state_records-row.valid_sample : null,
      exclusions:{missingPermit:row?.missing_permit ?? 0,invalidPermit:row?.invalid_permit ?? 0,
        missingClosure:row?.missing_closure ?? 0,invalidClosure:row?.invalid_closure ?? 0,
        reversedDates:row?.reversed_dates ?? 0},
      firstObserved:row?.first_observed ?? null,lastObserved:row?.last_observed ?? null,
      permitPeriod:{from:row?.permit_from ?? null,to:row?.permit_to ?? null},
      closurePeriod:{from:row?.closure_from ?? null,to:row?.closure_to ?? null},
      operatingPeriod:{from:row?.tenure_from ?? null,to:row?.tenure_to ?? null},
      note:'행정동 전체 업종의 과거 폐업 기록 기준입니다. 점포 업종코드와 이력 분류의 대응이 검증되지 않아 선택 업종 지표와 추천 점수에는 반영하지 않았습니다.'
    }];
  }));
}

export function summarizeHistory(rows, targets) {
  const grouped = new Map(targets.map(area => [key(area.district_name,area.dong_name), {
    scope:'행정동 전체 업종', source:'public.commercial_history_by_dong',
    records:0, permitRecords:0, closureRecords:0, undatedClosedRecords:0,
    closedStateRecords:0,nonClosedStatusWithDate:0,excludedSampleRecords:0,
    duplicateRecords:0,averageOperatingMonths:null,validSample:0,
    exclusions:{missingPermit:0,invalidPermit:0,missingClosure:0,invalidClosure:0,reversedDates:0},
    firstObserved:null, lastObserved:null,
    permitPeriod:{from:null,to:null},closurePeriod:{from:null,to:null},operatingPeriod:{from:null,to:null},
    note:'현재 점포 업종코드와 이력 업종 분류의 대응이 검증되지 않아 점수와 동일 업종 개업·폐업 수에는 반영하지 않았습니다.'
  }]));
  const seen = new Set();
  for (const row of rows) {
    const area = grouped.get(key(row.district_name,row.administrative_dong_name));
    if (!area) continue;
    const identity = [row.district_name,row.administrative_dong_name,row.bplcnm,row.rdnwhladdr,
      row.majornm,row.minornm,row.upjongnm,row.trdstatenm,row.apvpermymd,row.dcbymd]
      .map(value=>String(value??'').trim()).join('\0');
    if (seen.has(identity)) { area.duplicateRecords++; continue; }
    seen.add(identity);
    area.records++;
    const permit = validDate(row.apvpermymd);
    const closed = String(row.trdstatenm??'').trim() === '폐업';
    const closure = closed ? validDate(row.dcbymd) : null;
    if (closed) area.closedStateRecords++;
    else if (validDate(row.dcbymd)) area.nonClosedStatusWithDate++;
    if (permit) area.permitRecords++;
    if (closure) area.closureRecords++;
    if (permit) {
      if (!area.permitPeriod.from || permit<area.permitPeriod.from) area.permitPeriod.from=permit;
      if (!area.permitPeriod.to || permit>area.permitPeriod.to) area.permitPeriod.to=permit;
    }
    if (closure) {
      if (!area.closurePeriod.from || closure<area.closurePeriod.from) area.closurePeriod.from=closure;
      if (!area.closurePeriod.to || closure>area.closurePeriod.to) area.closurePeriod.to=closure;
    }
    if (closed && !closure) area.undatedClosedRecords++;
    if (closed) {
      if (!String(row.apvpermymd??'').trim()) area.exclusions.missingPermit++;
      else if (!permit) area.exclusions.invalidPermit++;
      if (!String(row.dcbymd??'').trim()) area.exclusions.missingClosure++;
      else if (!closure) area.exclusions.invalidClosure++;
      if (permit && closure && closure < permit) area.exclusions.reversedDates++;
      if (permit && closure && closure >= permit) {
        area.validSample++;
        area._totalDays=(area._totalDays??0)+(new Date(`${closure}T00:00:00Z`)-new Date(`${permit}T00:00:00Z`))/dayMilliseconds;
        if (!area.operatingPeriod.from || permit<area.operatingPeriod.from) area.operatingPeriod.from=permit;
        if (!area.operatingPeriod.to || closure>area.operatingPeriod.to) area.operatingPeriod.to=closure;
      }
    }
    for (const date of [permit,closure]) {
      if (!date) continue;
      if (!area.firstObserved || date < area.firstObserved) area.firstObserved = date;
      if (!area.lastObserved || date > area.lastObserved) area.lastObserved = date;
    }
  }
  for (const area of grouped.values()) {
    area.excludedSampleRecords=area.closedStateRecords-area.validSample;
    if (!area.records) {
      area.permitRecords=null;area.closureRecords=null;area.validSample=null;
      area.closedStateRecords=null;area.nonClosedStatusWithDate=null;area.excludedSampleRecords=null;
    }
    area.averageOperatingMonths=area.validSample ? area._totalDays/area.validSample/daysPerMonth : null;
    delete area._totalDays;
  }
  return grouped;
}

export function industryHistoryFromAggregate(rows, monthlyRows, areas, mapping) {
  const history = historyFromAggregate(rows,areas,monthlyRows);
  const latest = monthlyRows.map(row=>row.month).sort().at(-1) ?? null;
  const months = [];
  if (latest) {
    const [year,month] = latest.split('-').map(Number);
    for (let offset=11;offset>=0;offset--) months.push(new Date(Date.UTC(year,month-1-offset,1)).toISOString().slice(0,7));
  }
  for (const item of history.values()) {
    item.scope='행정동 동일 업종';
    item.industryCodes=mapping?.codes ?? [];
    item.mappingVerified=Boolean(mapping);
    item.minimumSamples=historySampleMinimums;
    item.note='동일 업종의 과거 영업기간과 개업·폐업 기록 기준입니다.';
    item.eventPeriod=latest ? {from:months[0],to:latest,latestObserved:latest} : null;
    const byMonth=new Map(item.eventTrend.map(row=>[row.month,row]));
    const trend=months.map(month=>byMonth.get(month) ?? {month,openings:0,closures:0});
    const hasDates=Boolean(mapping && item.records && item.firstObserved && latest);
    const openings=trend.reduce((sum,row)=>sum+row.openings,0);
    const closures=trend.reduce((sum,row)=>sum+row.closures,0);
    const enoughEvents=hasDates && openings+closures>=historySampleMinimums.growth;
    item.observedEventTrend=hasDates ? trend : [];
    item.eventSample=hasDates ? openings+closures : 0;
    item.periodOpenings=hasDates ? openings : null;
    item.periodClosures=hasDates ? closures : null;
    item.eventTrend=enoughEvents ? trend : [];
    item.growth=enoughEvents ? (openings-closures)/(openings+closures) : null;
    item.averageOperatingMonths=mapping && item.validSample>=historySampleMinimums.stability ? item.averageOperatingMonths : null;
    item.stability=item.averageOperatingMonths;
  }
  return history;
}

export function applyAreaHistoryScores(history) {
  const latest=[...history.values()].flatMap(item=>item.eventTrend.map(row=>row.month)).sort().at(-1);
  const from=latest ? (()=>{const [year,month]=latest.split('-').map(Number);return new Date(Date.UTC(year,month-12,1)).toISOString().slice(0,7);})() : null;
  for (const item of history.values()) {
    const window=item.eventTrend.filter(row=>row.month>=from && row.month<=latest);
    const openings=window.reduce((sum,row)=>sum+row.openings,0);
    const closures=window.reduce((sum,row)=>sum+row.closures,0);
    item.stability=item.validSample>=historySampleMinimums.stability && Number.isFinite(item.averageOperatingMonths) ? item.averageOperatingMonths : null;
    item.growth=openings+closures>=historySampleMinimums.growth ? (openings-closures)/(openings+closures) : null;
    item.growthPeriod=latest ? {from,to:latest} : null;
    item.periodOpenings=latest && item.records ? openings : null;
    item.periodClosures=latest && item.records ? closures : null;
    item.note='안정성과 성장성은 행정동 전체 업종의 과거 이력 기준이며 현재 성장률이나 선택 업종만의 평가가 아닙니다.';
  }
  return history;
}

// All-industry history is shared by searches; retain one successful snapshot for five minutes.
let areaHistoryCache;

export async function loadAreaContexts(areas) {
  if (!areas.length) return {history:new Map(),markets:new Map(),historyQueryMs:0,changeQueryMs:0};
  const databaseUrl=process.env.DATABASE_URL;
  if (!databaseUrl) throw new RecommendationDbError('DATABASE_URL이 설정되지 않았습니다.');
  const areaKey=areas.map(area=>JSON.stringify([area.district_name,area.dong_name])).sort().join('\n');
  if (areaHistoryCache?.databaseUrl===databaseUrl && areaHistoryCache.areaKey===areaKey) {
    if (areaHistoryCache.value && Date.now()<areaHistoryCache.expiresAt)
      return {...areaHistoryCache.value,historyQueryMs:0};
    if (areaHistoryCache.pending) return areaHistoryCache.pending;
  }
  const entry={databaseUrl,areaKey};
  areaHistoryCache=entry;
  entry.pending=queryAreaContexts(areas,databaseUrl).then(value=>{
    entry.value=value;
    entry.expiresAt=Date.now()+5*60*1000;
    return value;
  }).finally(()=>{
    entry.pending=null;
    if (!entry.value && areaHistoryCache===entry) areaHistoryCache=undefined;
  });
  return entry.pending;
}

async function queryAreaContexts(areas,databaseUrl) {
  const client=new pg.Client({connectionString:databaseUrl,...options});
  let stage='connect';
  try {
    await client.connect();
    stage='transaction';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '14s'");
    const started=performance.now();
    stage='summary';
    const availability=await client.query(historySummaryAvailabilitySql);
    if (availability.rows[0]?.available) {
      const prepared=await client.query(historySummaryReadSql);
      const snapshot=prepared.rows[0];
      if (snapshot) {
        const history=applyAreaHistoryScores(historyFromAggregate(snapshot.history_rows,areas,snapshot.monthly_rows));
        await client.query('ROLLBACK');
        return {history,markets:new Map(),historyQueryMs:Math.round(performance.now()-started),changeQueryMs:0};
      }
    }
    stage='aggregate';
    const historyRows=[],monthlyRows=[];
    for (let offset=0;offset<areas.length;offset+=10) {
      const batch=areas.slice(offset,offset+10);
      const parameters=[batch.map(area=>area.district_name),batch.map(area=>area.dong_name),null];
      const result=await client.query(historyContextSql,parameters);
      historyRows.push(...result.rows[0].history_rows);
      monthlyRows.push(...result.rows[0].monthly_rows);
    }
    const historyQueryMs=Math.round(performance.now()-started);
    await client.query('ROLLBACK');
    return {history:applyAreaHistoryScores(historyFromAggregate(historyRows,areas,monthlyRows)),markets:new Map(),historyQueryMs,changeQueryMs:0};
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    if (error instanceof RecommendationDbError) throw error;
    const timeout=error.code==='57014' || /timeout/i.test(error.message ?? '');
    const code=timeout?'TIMEOUT':/^[A-Z0-9]{5,20}$/.test(error.code ?? '')?error.code:'UNKNOWN';
    console.error(JSON.stringify({event:'history_query_failed',stage,code,areaCount:areas.length}));
    const message=timeout?'점포이력 집계 시간이 초과되었습니다.':
      ['ENOTFOUND','EAI_AGAIN'].includes(code)?'Supabase DB 주소를 찾을 수 없습니다.':
      ['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(code)?'Supabase DB에 연결할 수 없습니다.':
      code==='28P01'?'Supabase DB 인증에 실패했습니다.':
      ['42P01','42703'].includes(code)?'점포이력 테이블 또는 컬럼을 확인해 주세요.':
      'Supabase 점포이력 조회에 실패했습니다.';
    const failure=new RecommendationDbError(`${message} (오류 코드: ${code})`);
    failure.code=code;
    throw failure;
  } finally { await client.end().catch(()=>{}); }
}
