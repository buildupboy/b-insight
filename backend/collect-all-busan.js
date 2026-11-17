import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { request } from './data.js';

const base = process.env.SEMAS_API_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const route = '/storeListInDong';
const checkpointDir = resolve('.store-collection');
const pause = ms => new Promise(done => setTimeout(done, ms));
const safeCode = error => /^[A-Z0-9]{2,8}$/.test(String(error?.code || '')) ? error.code : null;

export function parseAllOptions(args) {
  const options = { save: false, allBusan: false, preflight: false, dbLimitMb: null, apiCallBudget: null };
  for (const arg of args) {
    if (arg === '--all-busan' && !options.allBusan) options.allBusan = true;
    else if (arg === '--save' && !options.save) options.save = true;
    else if (arg === '--preflight' && !options.preflight) options.preflight = true;
    else if (/^--db-limit-mb=\d+$/.test(arg) && options.dbLimitMb === null)
      options.dbLimitMb = Number(arg.slice('--db-limit-mb='.length));
    else if (/^--api-call-budget=\d+$/.test(arg) && options.apiCallBudget === null)
      options.apiCallBudget = Number(arg.slice('--api-call-budget='.length));
    else throw new Error('전체 모드 옵션: --all-busan [--preflight] [--save --db-limit-mb=N --api-call-budget=N]');
  }
  if (!options.allBusan || (options.preflight && options.save) ||
      (options.save && (!Number.isSafeInteger(options.dbLimitMb) || options.dbLimitMb < 1 ||
        !Number.isSafeInteger(options.apiCallBudget) || options.apiCallBudget < 3)))
    throw new Error('전체 저장에는 --all-busan --save --db-limit-mb=N --api-call-budget=N이 필요합니다.');
  return options;
}

export function retryable(error) {
  const status = error?.diagnostic?.status;
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  if (status !== null && status !== undefined) return false;
  return error?.name === 'DataApiError' && error?.diagnostic?.format === 'unknown';
}

export function createFetcher(fetchPage = request, sleep = pause, gapMs = 1100, budget = Infinity) {
  let lastStart = 0;
  let calls = 0;
  return async (pageNo, pageSize) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (calls >= budget) throw new Error('설정한 API 호출 예산을 모두 사용했습니다.');
      const wait = lastStart + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      calls++;
      try {
        const page = await fetchPage(base, route,
          { divId: 'ctprvnCd', key: '26', pageNo, numOfRows: pageSize, type: 'json' }, 'servicekey');
        if (page.diagnostic?.status !== 200 || page.diagnostic?.format !== 'json' ||
            !['00', '0'].includes(String(page.diagnostic?.code))) throw new Error('API 응답 검증 실패');
        return page;
      } catch (error) {
        if (attempt === 3 || !retryable(error)) throw error;
        await sleep(error?.diagnostic?.status === 429 ? 5000 * attempt : 1000 * attempt);
      }
    }
  };
}

export async function preflight(fetchPage) {
  for (const size of [1000, 500, 100]) {
    const first = await fetchPage(1, size);
    if (!Number.isSafeInteger(first.total) || first.total < 1 || first.rawCount < 1 ||
        first.rawCount > size || first.invalid || first.rows.length !== first.rawCount)
      throw new Error('첫 페이지의 총건수 또는 행 구조가 유효하지 않습니다.');
    if (first.rawCount !== Math.min(size, first.total)) continue;
    const second = first.total > size ? await fetchPage(2, size) : null;
    if (second && (second.total !== first.total || second.rawCount !== Math.min(size, first.total - size) ||
        second.invalid || second.rows.length !== second.rawCount))
      throw new Error('두 번째 페이지의 총건수 또는 크기가 일치하지 않습니다.');
    const ids1 = new Set(first.rows.map(row => String(row.bizesId || '')));
    if (second && second.rows.some(row => ids1.has(String(row.bizesId || ''))))
      throw new Error('첫 두 페이지에 중복 상가 ID가 있습니다.');
    const plan = { total: first.total, pageSize: size };
    const checkedFirst = preparePage(first, 1, plan, new Set());
    const checkedSecond = second ? preparePage(second, 2, plan, new Set(checkedFirst.ids)) : null;
    if ([checkedFirst, checkedSecond].filter(Boolean).some(sample => sample.counts.valid !== sample.counts.received))
      throw new Error('표본 페이지에 중복, 누락 또는 부산 외 상가가 있습니다.');
    return { total: first.total, pageSize: size, pages: Math.ceil(first.total / size),
      sampledPages: second ? 2 : 1, sampledRows: first.rawCount + (second?.rawCount || 0),
      sampledValid: checkedFirst.counts.valid + (checkedSecond?.counts.valid || 0) };
  }
  throw new Error('API가 100건 페이지를 완전히 반환하지 않아 전체 수집을 중단합니다.');
}

export function preparePage(page, pageNo, plan, seen) {
  const expected = Math.min(plan.pageSize, plan.total - (pageNo - 1) * plan.pageSize);
  if (page.total !== plan.total || page.rawCount !== expected || page.rows.length !== expected || page.invalid)
    throw new Error('페이지 총건수 또는 수신 건수가 사전 점검 결과와 일치하지 않습니다.');
  const stores = [], ids = [], districts = {};
  const counts = { received: page.rawCount, valid: 0, duplicates: 0, missingIds: 0,
    invalidCoordinates: 0, wrongRegion: 0, missingFields: 0 };
  const current = new Set();
  for (const row of page.rows) {
    const id = String(row.bizesId || '').trim();
    if (!id) { counts.missingIds++; continue; }
    if (seen.has(id) || current.has(id)) { counts.duplicates++; continue; }
    current.add(id);
    const district = String(row.signguCd || '');
    const address = String(row.rdnmAdr || '').trim();
    if (String(row.ctprvnCd) !== '26' || !/^26\d{3}$/.test(district) ||
        (address && !address.startsWith('부산'))) { counts.wrongRegion++; continue; }
    const lat = row.lat == null || row.lat === '' ? null : Number(row.lat);
    const lon = row.lon == null || row.lon === '' ? null : Number(row.lon);
    if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
        (lon !== null && (!Number.isFinite(lon) || Math.abs(lon) > 180))) {
      counts.invalidCoordinates++; continue;
    }
    const value = field => row[field] == null || String(row[field]).trim() === '' ? null : String(row[field]).trim();
    if (['bizesNm', 'indsSclsNm', 'indsSclsCd', 'rdnmAdr', 'lat', 'lon']
      .some(field => value(field) === null)) counts.missingFields++;
    stores.push({ store_id: id, store_name: value('bizesNm'), industry_name: value('indsSclsNm'),
      industry_code: value('indsSclsCd'), road_address: value('rdnmAdr'), latitude: lat, longitude: lon });
    ids.push(id);
    districts[district] = (districts[district] || 0) + 1;
  }
  counts.valid = stores.length;
  return { stores, ids, counts, districts };
}

const upsertSql = size => `INSERT INTO public.stores
  (store_id, store_name, industry_name, industry_code, road_address, latitude, longitude)
  VALUES ${Array.from({ length: size }, (_, i) => `(${Array.from({ length: 7 }, (_, j) => `$${i * 7 + j + 1}`).join(',')})`).join(',')}
  ON CONFLICT (store_id) DO UPDATE SET store_name=EXCLUDED.store_name,
    industry_name=EXCLUDED.industry_name, industry_code=EXCLUDED.industry_code,
    road_address=EXCLUDED.road_address, latitude=EXCLUDED.latitude,
    longitude=EXCLUDED.longitude RETURNING store_id`;

export async function savePage(client, stores) {
  await client.query('BEGIN');
  try {
    for (let start = 0; start < stores.length; start += 250) {
      const batch = stores.slice(start, start + 250);
      const values = batch.flatMap(s => [s.store_id, s.store_name, s.industry_name,
        s.industry_code, s.road_address, s.latitude, s.longitude]);
      const saved = await client.query(upsertSql(batch.length), values);
      if (saved.rowCount !== batch.length) throw new Error('UPSERT 건수가 배치 건수와 다릅니다.');
    }
    if (stores.length) {
      const result = await client.query(`SELECT store_id, store_name, industry_name, industry_code,
        road_address, latitude, longitude FROM public.stores WHERE store_id = ANY($1::text[])`,
      [stores.map(s => s.store_id)]);
      const actual = new Map(result.rows.map(row => [row.store_id, row]));
      if (actual.size !== stores.length || stores.some(store => {
        const row = actual.get(store.store_id);
        return !row || ['store_name', 'industry_name', 'industry_code', 'road_address', 'latitude', 'longitude']
          .some(key => (key === 'latitude' || key === 'longitude')
            ? (row[key] == null ? null : Number(row[key])) !== store[key]
            : row[key] !== store[key]);
      })) throw new Error('저장 후 상가 값 검증에 실패했습니다.');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export function capacityEstimate(dbBytes, tableBytes, rows, total, limitMb) {
  const perStore = Math.max(2048, rows ? Math.ceil(tableBytes / rows) * 2 : 0);
  const growthBytes = total * perStore;
  const limitBytes = limitMb * 1024 * 1024;
  return { dbBytes, tableBytes, rows, estimatedGrowthBytes: growthBytes,
    limitBytes, reserveBytes: Math.ceil(limitBytes * 0.2),
    safe: dbBytes + growthBytes <= Math.floor(limitBytes * 0.8) };
}

async function inspectDatabase(client, total, limitMb) {
  const result = await client.query(`SELECT count(*)::bigint AS rows,
    pg_database_size(current_database())::bigint AS db_bytes,
    pg_total_relation_size('public.stores')::bigint AS table_bytes FROM public.stores`);
  const row = result.rows[0];
  return capacityEstimate(Number(row.db_bytes), Number(row.table_bytes), Number(row.rows), total, limitMb);
}

async function atomicJson(path, value) {
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}

async function loadCheckpoint(plan, directory) {
  let state;
  try { state = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state && (state.total !== plan.total || state.pageSize !== plan.pageSize ||
      !Number.isSafeInteger(state.lastPage) || state.lastPage < 0 || state.lastPage > plan.pages))
    throw new Error('체크포인트와 현재 API 총건수 또는 페이지 크기가 다릅니다.');
  return state || { total: plan.total, pageSize: plan.pageSize, lastPage: 0,
    counts: { received: 0, valid: 0, duplicates: 0, missingIds: 0,
      invalidCoordinates: 0, wrongRegion: 0, missingFields: 0 }, districts: {}, failedPages: [] };
}

async function seenFromCheckpoint(state, directory) {
  const seen = new Set();
  for (let pageNo = 1; pageNo <= state.lastPage; pageNo++) {
    const ids = JSON.parse(await readFile(join(directory, `page-${pageNo}.json`), 'utf8'));
    for (const id of ids) seen.add(id);
  }
  if (seen.size !== state.counts.valid) throw new Error('체크포인트 ID 수가 저장된 유효 건수와 다릅니다.');
  return seen;
}

export async function runCollection(plan, fetchPage, client, directory = checkpointDir) {
  await mkdir(directory, { recursive: true });
  const lock = await open(join(directory, 'collection.lock'), 'wx');
  try {
    let state = await loadCheckpoint(plan, directory);
    const seen = await seenFromCheckpoint(state, directory);
    for (let pageNo = state.lastPage + 1; pageNo <= plan.pages; pageNo++) {
      let stage = 'api';
      try {
        const page = await fetchPage(pageNo, plan.pageSize);
        stage = 'validation';
        const prepared = preparePage(page, pageNo, plan, seen);
        stage = 'upsert-or-verification';
        await savePage(client, prepared.stores);
        stage = 'checkpoint';
        await atomicJson(join(directory, `page-${pageNo}.json`), prepared.ids);
        const next = structuredClone(state);
        for (const [key, value] of Object.entries(prepared.counts)) next.counts[key] += value;
        for (const [code, count] of Object.entries(prepared.districts))
          next.districts[code] = (next.districts[code] || 0) + count;
        next.lastPage = pageNo;
        next.failedPages = next.failedPages.filter(page => page.pageNo !== pageNo);
        await atomicJson(join(directory, 'checkpoint.json'), next);
        state = next;
        for (const id of prepared.ids) seen.add(id);
        console.log(JSON.stringify({ pageNo, pages: plan.pages, received: state.counts.received,
          valid: state.counts.valid }));
      } catch (error) {
        const failure = { pageNo, stage, code: safeCode(error),
          httpStatus: error?.diagnostic?.status ?? null,
          reason: { api: 'API 요청 실패', validation: '페이지 총건수 또는 데이터 검증 실패',
            'upsert-or-verification': 'DB 저장 또는 저장값 검증 실패',
            checkpoint: '체크포인트 파일 기록 실패' }[stage] };
        state.failedPages.push(failure);
        await atomicJson(join(directory, 'checkpoint.json'), state);
        console.error(JSON.stringify({ failedPage: failure }));
        break;
      }
    }
    let dbMissingIds = 0;
    for (let pageNo = 1; pageNo <= state.lastPage; pageNo++) {
      const ids = JSON.parse(await readFile(join(directory, `page-${pageNo}.json`), 'utf8'));
      const present = await client.query('SELECT count(*)::int AS count FROM public.stores WHERE store_id = ANY($1::text[])', [ids]);
      dbMissingIds += ids.length - Number(present.rows[0].count);
    }
    const result = await client.query(`SELECT count(*)::bigint AS count,
      count(*) FILTER (WHERE road_address IS NOT NULL AND road_address <> ''
        AND road_address NOT LIKE $1)::bigint AS non_busan_address FROM public.stores`, ['부산%']);
    return { apiTotal: plan.total, received: state.counts.received, valid: state.counts.valid,
      duplicates: state.counts.duplicates, missingIds: state.counts.missingIds,
      missingPagesOrRows: plan.total - state.counts.received, invalidCoordinates: state.counts.invalidCoordinates,
      wrongRegion: state.counts.wrongRegion, missingFields: state.counts.missingFields,
      dbUniqueStores: Number(result.rows[0].count), dbMissingIds,
      dbNonBusanAddress: Number(result.rows[0].non_busan_address), districts: state.districts,
      failedPages: state.failedPages, lastPage: state.lastPage,
      complete: state.lastPage === plan.pages && state.counts.received === plan.total &&
        state.counts.valid === plan.total && dbMissingIds === 0 &&
        Number(result.rows[0].non_busan_address) === 0 && state.failedPages.length === 0 };
  } finally {
    await lock.close();
    await rm(join(directory, 'collection.lock'), { force: true });
  }
}

export async function runAllBusan(options) {
  const fetchPage = createFetcher(request, pause, 1100, options.apiCallBudget ?? Infinity);
  const plan = await preflight(fetchPage);
  console.log(JSON.stringify({ mode: options.save ? 'save' : 'preflight', ...plan,
    expectedApiRequests: plan.pages + plan.sampledPages, requestGapMs: 1100 }));
  if (!options.save) return;
  const checkpoint = await loadCheckpoint(plan, checkpointDir);
  const minimumCalls = plan.sampledPages + plan.pages - checkpoint.lastPage;
  if (options.apiCallBudget < minimumCalls)
    throw new Error(`남은 페이지와 사전 점검에 API 요청 ${minimumCalls}회가 필요합니다. 호출 예산을 확인하세요.`);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 설정이 필요합니다.');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const capacity = await inspectDatabase(client, plan.total, options.dbLimitMb);
    console.log(JSON.stringify({ capacity }));
    if (!capacity.safe) throw new Error('추정 저장량과 20% 여유를 감안하면 DB 용량이 부족합니다.');
    const result = await runCollection(plan, fetchPage, client);
    console.log(JSON.stringify({ summary: result }));
    if (!result.complete) process.exitCode = 1;
  } finally { await client.end().catch(() => {}); }
}
