import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request } from './data.js';
import { retryable } from './collect-all-busan.js';

const base = process.env.SEMAS_API_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const route = '/storeListInDong';
const directory = resolve('.district-dong-backfill');
const sleep = ms => new Promise(done => setTimeout(done, ms));

export function parseOptions(args) {
  const options = { save: false, limit: 100, apiCallBudget: null };
  for (const arg of args) {
    if (arg === '--save' && !options.save) options.save = true;
    else if (/^--limit=\d+$/.test(arg) && options.limit === 100)
      options.limit = Number(arg.slice(8));
    else if (/^--api-call-budget=\d+$/.test(arg) && options.apiCallBudget === null)
      options.apiCallBudget = Number(arg.slice('--api-call-budget='.length));
    else throw new Error('옵션: [--limit=100] 또는 --save --api-call-budget=N');
  }
  if (options.save && (!Number.isSafeInteger(options.apiCallBudget) || options.apiCallBudget < 1 || options.limit !== 100))
    throw new Error('전체 UPDATE에는 --save --api-call-budget=N이 필요합니다.');
  if (!options.save && options.limit !== 100)
    throw new Error('Dry Run은 100건으로 제한됩니다.');
  return options;
}

export function createFetcher(fetchPage = request, delay = sleep, budget = Infinity) {
  let calls = 0, lastStart = 0;
  return async (pageNo, size) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (calls >= budget) throw new Error('설정한 API 호출 예산을 모두 사용했습니다.');
      const wait = lastStart + 1100 - Date.now();
      if (wait > 0) await delay(wait);
      lastStart = Date.now();
      calls++;
      try {
        const result = await fetchPage(base, route,
          { divId: 'ctprvnCd', key: '26', pageNo, numOfRows: size, type: 'json' }, 'servicekey');
        if (result.diagnostic?.status !== 200 || result.diagnostic?.format !== 'json' ||
            !['00', '0'].includes(String(result.diagnostic?.code))) throw new Error('API 응답 검증 실패');
        return result;
      } catch (error) {
        if (attempt === 3 || !retryable(error)) throw error;
        await delay(error?.diagnostic?.status === 429 ? 5000 * attempt : 1000 * attempt);
      }
    }
  };
}

export function preparePage(page, pageNo, size, total, seen = new Set()) {
  const expected = Math.min(size, total - (pageNo - 1) * size);
  if (page.total !== total || page.rawCount !== expected || page.rows?.length !== expected || page.invalid)
    throw new Error('API 페이지 총건수 또는 수신 행 수가 일치하지 않습니다.');
  const values = [], ids = [];
  const counts = { received: page.rawCount, named: 0, missingNames: 0,
    missingIds: 0, duplicates: 0, wrongRegion: 0 };
  const local = new Set();
  for (const row of page.rows) {
    const id = String(row.bizesId ?? '').trim();
    if (!id) { counts.missingIds++; continue; }
    if (local.has(id) || seen.has(id)) { counts.duplicates++; continue; }
    local.add(id);
    if (String(row.ctprvnCd) !== '26' || !/^26\d{3}$/.test(String(row.signguCd ?? ''))) {
      counts.wrongRegion++; continue;
    }
    const district = String(row.signguNm ?? '').trim();
    const dong = String(row.adongNm ?? '').trim();
    const name = district && dong ? `${district}-${dong}` : null;
    if (name) counts.named++; else counts.missingNames++;
    values.push({ store_id: id, district_dong: name });
    ids.push(id);
  }
  return { values, ids, counts };
}

const sql = size => `UPDATE public.stores AS s SET district_dong = v.district_dong
  FROM (VALUES ${Array.from({ length: size }, (_, i) => `($${i * 2 + 1}::text,$${i * 2 + 2}::text)`).join(',')})
  AS v(store_id,district_dong) WHERE s.store_id = v.store_id RETURNING s.store_id`;

export async function updatePage(client, values) {
  await client.query('BEGIN');
  try {
    let updated = 0;
    for (let start = 0; start < values.length; start += 250) {
      const batch = values.slice(start, start + 250);
      const result = await client.query(sql(batch.length),
        batch.flatMap(row => [row.store_id, row.district_dong]));
      updated += result.rowCount;
      if (result.rowCount !== batch.length)
        throw new Error(`기존 DB에서 일치하지 않는 store_id ${batch.length - result.rowCount}건`);
    }
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function atomicJson(path, value) {
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}

async function readState(total, size, root = directory) {
  let state;
  try { state = JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state && (state.total !== total || state.size !== size ||
      !Number.isSafeInteger(state.lastPage) || state.lastPage < 0 || state.lastPage > Math.ceil(total / size)))
    throw new Error('체크포인트와 현재 API 결과가 다릅니다.');
  return state || { total, size, lastPage: 0, counts: { received: 0, named: 0,
    missingNames: 0, missingIds: 0, duplicates: 0, wrongRegion: 0 }, failedPages: [] };
}

export async function runBackfill(client, fetchPage, total, size = 1000, root = directory) {
  await mkdir(root, { recursive: true });
  const lock = await open(join(root, 'backfill.lock'), 'wx');
  try {
    let state = await readState(total, size, root);
    const seen = new Set();
    for (let number = 1; number <= state.lastPage; number++) {
      const ids = JSON.parse(await readFile(join(root, `page-${number}.json`), 'utf8'));
      for (const id of ids) seen.add(id);
    }
    if (seen.size !== state.counts.named + state.counts.missingNames)
      throw new Error('체크포인트 ID 수가 처리 건수와 다릅니다.');
    const pages = Math.ceil(total / size);
    for (let pageNo = state.lastPage + 1; pageNo <= pages; pageNo++) {
      let stage = 'api';
      try {
        const page = await fetchPage(pageNo, size);
        stage = 'validation';
        const prepared = preparePage(page, pageNo, size, total, seen);
        stage = 'update';
        await updatePage(client, prepared.values);
        stage = 'checkpoint';
        await atomicJson(join(root, `page-${pageNo}.json`), prepared.ids);
        const next = structuredClone(state);
        for (const [key, count] of Object.entries(prepared.counts)) next.counts[key] += count;
        next.lastPage = pageNo;
        next.failedPages = next.failedPages.filter(item => item.pageNo !== pageNo);
        await atomicJson(join(root, 'checkpoint.json'), next);
        state = next;
        for (const id of prepared.ids) seen.add(id);
        console.log(JSON.stringify({ pageNo, pages, received: state.counts.received,
          named: state.counts.named, missingNames: state.counts.missingNames }));
      } catch (error) {
        const failure = { pageNo, stage,
          code: /^[A-Z0-9]{2,8}$/.test(String(error?.code || '')) ? error.code : null,
          httpStatus: error?.diagnostic?.status ?? null,
          reason: stage === 'update' ? 'DB UPDATE 또는 기존 ID 일치 검증 실패' :
            stage === 'validation' ? 'API 페이지 검증 실패' :
              stage === 'checkpoint' ? '체크포인트 기록 실패' : 'API 요청 실패' };
        state.failedPages.push(failure);
        await atomicJson(join(root, 'checkpoint.json'), state);
        console.error(JSON.stringify({ failedPage: failure }));
        break;
      }
    }
    const result = await client.query(`SELECT count(*) FILTER (WHERE district_dong IS NOT NULL)::bigint AS populated,
      count(*) FILTER (WHERE district_dong IS NULL)::bigint AS missing,
      count(*)::bigint AS total FROM public.stores`);
    return { apiTotal: total, ...state.counts, dbPopulated: Number(result.rows[0].populated),
      dbMissing: Number(result.rows[0].missing), dbTotal: Number(result.rows[0].total),
      failedPages: state.failedPages, lastPage: state.lastPage,
      complete: state.lastPage === pages && state.counts.received === total &&
        state.counts.missingIds === 0 && state.counts.duplicates === 0 &&
        state.counts.wrongRegion === 0 && state.failedPages.length === 0 &&
        Number(result.rows[0].populated) === state.counts.named &&
        Number(result.rows[0].missing) === state.counts.missingNames &&
        Number(result.rows[0].populated) + Number(result.rows[0].missing) === total };
  } finally {
    await lock.close();
    await rm(join(root, 'backfill.lock'), { force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const fetchPage = createFetcher(request, sleep, options.apiCallBudget ?? Infinity);
  if (!options.save) {
    const page = await fetchPage(1, 100);
    if (!Number.isSafeInteger(page.total) || page.total < 100) throw new Error('API 전체 건수가 유효하지 않습니다.');
    const prepared = preparePage(page, 1, 100, page.total);
    console.log(JSON.stringify({ mode: 'dry-run', apiTotal: page.total, ...prepared.counts,
      examples: prepared.values.map(row => row.district_dong).filter(Boolean).slice(0, 5) }));
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 설정이 필요합니다.');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const columns = await client.query(`SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema='public' AND table_name='stores' AND column_name='district_dong'`);
    if (columns.rows[0].count !== 1) throw new Error('먼저 docs/district-dong.sql의 ALTER TABLE을 실행해야 합니다.');
    const first = await fetchPage(1, 1000);
    if (!Number.isSafeInteger(first.total) || first.total < 1 || first.rawCount !== Math.min(1000, first.total))
      throw new Error('API 총건수 또는 1,000건 페이지 응답이 유효하지 않습니다.');
    const count = await client.query('SELECT count(*)::bigint AS count FROM public.stores');
    if (Number(count.rows[0].count) !== first.total)
      throw new Error('기존 DB 행 수와 API 총건수가 달라 업데이트를 중단합니다.');
    const state = await readState(first.total, 1000);
    const remaining = Math.ceil(first.total / 1000) - state.lastPage;
    const minimumCalls = remaining + (state.lastPage > 0 ? 1 : 0);
    if (options.apiCallBudget < minimumCalls)
      throw new Error(`남은 페이지에 최소 ${minimumCalls}회의 API 호출이 필요합니다.`);
    let firstPending = state.lastPage === 0;
    const result = await runBackfill(client, async (pageNo, size) => {
      if (firstPending && pageNo === 1) { firstPending = false; return first; }
      return fetchPage(pageNo, size);
    }, first.total);
    console.log(JSON.stringify({ mode: 'save', result }));
    if (!result.complete) process.exitCode = 1;
  } finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    console.error(JSON.stringify({ error: '행정동 백필 작업이 중단되었습니다.',
      code: /^[A-Z0-9]{2,8}$/.test(String(error?.code || '')) ? error.code : null }));
    process.exitCode = 1;
  });
