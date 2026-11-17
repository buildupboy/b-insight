import pg from 'pg';
import { RecommendationDbError } from './recommendation-db.js';

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
export const historyAggregateSql = `WITH target AS (
    SELECT * FROM unnest($1::text[], $2::text[]) AS t(district_name,dong_name)
  ), dedup AS (
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
        THEN to_date(permit_text,'YYYYMMDD') END AS parsed_permit,
      CASE WHEN dcbymd ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{8})$'
        AND closure_text ~ '^[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
        AND left(closure_text,4)<>'0000'
        THEN to_date(closure_text,'YYYYMMDD') END AS parsed_closure
    FROM normalized
  ), valid AS (
    SELECT *,
      CASE WHEN to_char(parsed_permit,'YYYYMMDD')=permit_text THEN parsed_permit END AS permit_date,
      CASE WHEN to_char(parsed_closure,'YYYYMMDD')=closure_text THEN parsed_closure END AS closure_date
    FROM parsed
  ) SELECT district_name, administrative_dong_name,
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

export function historyFromAggregate(rows, targets) {
  const found = new Map(rows.map(row => [key(row.district_name,row.administrative_dong_name),row]));
  return new Map(targets.map(area => {
    const row = found.get(key(area.district_name,area.dong_name));
    const records = row?.records ?? 0;
    return [key(area.district_name,area.dong_name), {
      scope:'행정동 전체 업종', source:'public.commercial_history_by_dong',
      records, duplicateRecords:row?.duplicate_records ?? 0,
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

export async function loadAreaContexts(areas) {
  if (!areas.length) return {history:new Map(),markets:new Map(),historyQueryMs:0,changeQueryMs:0};
  if (!process.env.DATABASE_URL) throw new RecommendationDbError('DATABASE_URL이 설정되지 않았습니다.');
  const districts = areas.map(area => area.district_name);
  const dongs = areas.map(area => area.dong_name);
  const client = new pg.Client({connectionString:process.env.DATABASE_URL,...options});
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    let started = performance.now();
    const historyRows = await client.query(historyAggregateSql,[districts,dongs]);
    const historyQueryMs = Math.round(performance.now()-started);
    started = performance.now();
    const marketRows = await client.query(`SELECT c.district_name, c.administrative_dong_name,
        c.market_id, c.type_nm, c.comm_nm, c.change_indicator_nm,
        c.average_open_months, c.average_close_months, c.overlap_pct,
        c.is_primary, c.source_dataset, c.boundary_reference_date::text AS boundary_reference_date
      FROM public.commercial_change_by_dong c
      JOIN unnest($1::text[], $2::text[]) AS target(district_name,dong_name)
        ON c.district_name = target.district_name AND c.administrative_dong_name = target.dong_name
      ORDER BY c.is_primary DESC, c.overlap_pct DESC NULLS LAST, c.market_id`,
      [districts,dongs]);
    const changeQueryMs = Math.round(performance.now()-started);
    await client.query('ROLLBACK');
    const markets = new Map(areas.map(area => [key(area.district_name,area.dong_name),[]]));
    for (const row of marketRows.rows) markets.get(key(row.district_name,row.administrative_dong_name))?.push({
      marketId:row.market_id, name:row.comm_nm, type:row.type_nm,
      indicator:row.change_indicator_nm, averageOpenMonths:row.average_open_months == null ? null : Number(row.average_open_months),
      averageCloseMonths:row.average_close_months == null ? null : Number(row.average_close_months),
      overlapPct:row.overlap_pct == null ? null : Number(row.overlap_pct),
      isPrimary:row.is_primary, boundaryReferenceDate:row.boundary_reference_date,
      sourceDataset:row.source_dataset, scope:'상권 단위 · 전체 업종'
    });
    return {history:historyFromAggregate(historyRows.rows,areas),markets,historyQueryMs,changeQueryMs};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof RecommendationDbError) throw error;
    throw new RecommendationDbError('Supabase 이력·상권 변화 데이터를 조회할 수 없습니다.');
  } finally {
    await client.end().catch(() => {});
  }
}
