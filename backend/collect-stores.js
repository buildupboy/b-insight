import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request, deduplicate } from './data.js';

const base = process.env.SEMAS_API_BASE_URL || 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const route = '/storeListInDong';
const pageSize = 100;
const columns = ['bizesId', 'bizesNm', 'indsSclsNm', 'indsSclsCd', 'rdnmAdr', 'lat', 'lon'];

function successful(result, operation) {
  if (result.diagnostic.status !== 200 || result.diagnostic.format !== 'json' ||
      !['00', '0'].includes(String(result.diagnostic.code))) {
    throw new Error(`${operation}: HTTP 200, JSON, resultCode=00 확인에 실패했습니다.`);
  }
  return result;
}

export async function chooseBusanDong() {
  const zones = successful(await request(base, '/storeZoneInAdmi',
    { divId: 'ctprvnCd', key: '26', type: 'json' }), 'storeZoneInAdmi');
  const fromZones = zones.rows.find(row => String(row.ctprvnCd) === '26' &&
    /^26\d{6}(?:\d{2})?$/.test(String(row.adongCd)));
  if (fromZones) return String(fromZones.adongCd);

  // Some zone responses omit adongCd; discover a real code from a Busan district.
  const discovered = successful(await request(base, route,
    { divId: 'signguCd', key: '26230', pageNo: 1, numOfRows: pageSize, type: 'json' }), route);
  const fromStores = discovered.rows.find(row => /^26\d{6}(?:\d{2})?$/.test(String(row.adongCd)) &&
    String(row.signguCd) === '26230');
  if (!fromStores) throw new Error('API 응답에서 유효한 부산 행정동 코드를 확인하지 못했습니다.');
  return String(fromStores.adongCd);
}

const optionalText = value => value === undefined || value === null || String(value).trim() === ''
  ? null : String(value).trim();

function coordinate(value, limit) {
  if (value === undefined || value === null || String(value).trim() === '') return { value: null, valid: true };
  const number = Number(value);
  return { value: number, valid: Number.isFinite(number) && Math.abs(number) <= limit };
}

export function prepareStores(rows, code, scope = 'dong') {
  const distinct = deduplicate(rows, 'storeListInDong');
  const stores = [];
  let invalidCoordinates = 0, wrongDong = 0, missingFields = 0;
  for (const row of distinct.rows) {
    const inRegion = scope === 'district'
      ? String(row.ctprvnCd) === '26' && String(row.signguCd) === code
      : String(row.adongCd) === code;
    if (!inRegion) { wrongDong++; continue; }
    if (columns.some(field => row[field] === undefined || row[field] === null || String(row[field]).trim() === '')) missingFields++;
    const latitude = coordinate(row.lat, 90);
    const longitude = coordinate(row.lon, 180);
    if (!latitude.valid || !longitude.valid) { invalidCoordinates++; continue; }
    stores.push({
      store_id: String(row.bizesId), store_name: optionalText(row.bizesNm),
      industry_name: optionalText(row.indsSclsNm), industry_code: optionalText(row.indsSclsCd),
      road_address: optionalText(row.rdnmAdr), latitude: latitude.value, longitude: longitude.value
    });
  }
  return { stores, duplicates: distinct.duplicates, missingIds: distinct.missingIds,
    invalidCoordinates, wrongDong, missingFields };
}

export async function collectStores(dongCode) {
  if (!/^26\d{6}(?:\d{2})?$/.test(String(dongCode))) throw new Error('부산 행정동 코드가 유효하지 않습니다.');
  const result = successful(await request(base, route,
    { divId: 'adongCd', key: dongCode, pageNo: 1, numOfRows: pageSize, type: 'json' }), route);
  if (result.rawCount > pageSize || result.rawCount === 0) throw new Error('API 수신 건수가 1~100건 범위를 벗어났습니다.');
  return { result, prepared: prepareStores(result.rows, dongCode) };
}

export function parseOptions(args) {
  let save = false, limit = 100, limitProvided = false;
  for (const arg of args) {
    if (arg === '--save' && !save) save = true;
    else if (/^--limit=\d+$/.test(arg) && !limitProvided) {
      limit = Number(arg.slice(8));
      limitProvided = true;
    }
    else throw new Error('지원하는 옵션은 --save와 --limit=1..3000뿐입니다.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3000) throw new Error('--limit은 1~3000 범위여야 합니다.');
  return { save, limit };
}

export async function collectBusanStores(limit, fetchPage = request) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3000) throw new Error('수집 상한은 1~3000건입니다.');
  const zones = successful(await fetchPage(base, '/storeZoneInAdmi',
    { divId: 'ctprvnCd', key: '26', type: 'json' }, 'servicekey'), 'storeZoneInAdmi');
  const districtMap = new Map();
  for (const row of zones.rows) if (String(row.ctprvnCd) === '26' && /^26\d{3}$/.test(String(row.signguCd)))
    districtMap.set(String(row.signguCd), String(row.signguNm || row.signguCd));
  if (districtMap.size < 2) throw new Error('부산 시군구 코드를 두 곳 이상 확인하지 못했습니다.');
  const districts = [...districtMap].sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) =>
    ({ code, name, pageNo: 1, received: 0, valid: 0, total: null, done: false }));
  const stores = [], seen = new Set();
  const counts = { received: 0, valid: 0, duplicates: 0, missingIds: 0,
    missingFields: 0, invalidCoordinates: 0, wrongRegion: 0, pages: 0 };
  // Round-robin pages across districts. The cap prevents an accidental full-city scan.
  while (stores.length < limit && districts.some(district => !district.done)) {
    for (const district of districts) {
      if (district.done || stores.length >= limit) continue;
      if (district.pageNo > 10) { district.done = true; continue; }
      const page = successful(await fetchPage(base, route,
        { divId: 'signguCd', key: district.code, pageNo: district.pageNo,
          numOfRows: pageSize, type: 'json' }, 'servicekey'), route);
      if (page.rawCount > pageSize) throw new Error('API가 요청한 페이지 크기보다 많은 행을 반환했습니다.');
      district.received += page.rawCount;
      district.total = page.total;
      counts.received += page.rawCount;
      counts.pages++;
      const prepared = prepareStores(page.rows, district.code, 'district');
      counts.duplicates += prepared.duplicates;
      counts.missingIds += prepared.missingIds;
      counts.missingFields += prepared.missingFields;
      counts.invalidCoordinates += prepared.invalidCoordinates;
      counts.wrongRegion += prepared.wrongDong;
      for (const store of prepared.stores) {
        if (seen.has(store.store_id)) { counts.duplicates++; continue; }
        seen.add(store.store_id);
        if (stores.length < limit) { stores.push(store); district.valid++; }
      }
      district.pageNo++;
      if (page.rawCount === 0 || (page.total !== null && district.received >= page.total) ||
          (page.total === null && page.rawCount < pageSize)) district.done = true;
    }
  }
  counts.valid = stores.length;
  return { stores, counts, districts: districts.map(({ code, name, received, valid, total }) =>
    ({ code, name, received, valid, total })), target: limit, targetReached: stores.length === limit };
}

const upsertSql = size => `INSERT INTO public.stores
  (store_id, store_name, industry_name, industry_code, road_address, latitude, longitude)
  VALUES ${Array.from({ length: size }, (_, row) =>
    `(${Array.from({ length: 7 }, (_, column) => `$${row * 7 + column + 1}`).join(', ')})`).join(', ')}
  ON CONFLICT (store_id) DO UPDATE SET
    store_name = EXCLUDED.store_name,
    industry_name = EXCLUDED.industry_name,
    industry_code = EXCLUDED.industry_code,
    road_address = EXCLUDED.road_address,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude
  RETURNING store_id`;

const databaseReasons = {
  '22P02': '전달한 값의 형식이 컬럼 타입과 맞지 않습니다.',
  '22003': '숫자 값이 컬럼 범위를 벗어났습니다.',
  '23502': '필수 컬럼에 NULL 값이 전달됐습니다.',
  '23505': '고유 제약 조건 위반이 발생했습니다.',
  '42501': '테이블 권한 또는 RLS 정책이 INSERT/UPDATE를 허용하지 않습니다.',
  '42P01': '대상 테이블을 찾을 수 없습니다.',
  '42703': '쿼리의 컬럼이 테이블에 없습니다.',
  '42804': '전달한 값의 데이터 타입이 컬럼과 맞지 않습니다.',
  '42601': 'SQL 문법 오류가 발생했습니다.',
  'SELF_SIGNED_CERT_IN_CHAIN': '서버 인증서 체인을 검증할 수 없습니다.',
  'ECONNREFUSED': 'DB 연결이 거부됐습니다.',
  'ETIMEDOUT': 'DB 연결 시간이 초과됐습니다.',
  'ENOTFOUND': 'DB 호스트를 찾을 수 없습니다.'
};

export function databaseFailure(phase, error) {
  const rawCode = typeof error?.code === 'string' ? error.code : '';
  const code = /^[0-9A-Z]{5}$/.test(rawCode) || Object.hasOwn(databaseReasons, rawCode) ? rawCode : null;
  return { phase, code, reason: databaseReasons[code] || 'DB 서버가 오류를 반환했습니다. 오류 코드를 확인하세요.' };
}

export async function saveStores(client, stores) {
  const savedIds = [];
  let failure = null;
  let beforeCount = null, afterCount = null;
  try {
    beforeCount = (await client.query('SELECT count(*)::int AS count FROM public.stores')).rows[0].count;
  } catch (error) { failure = databaseFailure('before-count', error); }
  for (let offset = 0; !failure && offset < stores.length; offset += 100) {
    const batch = stores.slice(offset, offset + 100);
    try {
      const values = batch.flatMap(store => [store.store_id, store.store_name, store.industry_name,
        store.industry_code, store.road_address, store.latitude, store.longitude]);
      const response = await client.query(upsertSql(batch.length), values);
      if (response.rowCount !== batch.length) {
        failure = { phase: 'upsert', code: null, reason: 'UPSERT 처리 건수가 배치 크기와 다릅니다.' };
        break;
      }
      savedIds.push(...batch.map(store => store.store_id));
    } catch (error) { failure = databaseFailure('upsert', error); break; }
  }
  let verified = 0, industryMatches = null;
  try {
    if (savedIds.length) {
      const check = await client.query('SELECT store_id, store_name, industry_name, industry_code, road_address, latitude, longitude FROM public.stores WHERE store_id = ANY($1::text[])', [savedIds]);
      const actual = new Map(check.rows.map(row => [row.store_id, row]));
      const expected = new Map(stores.map(store => [store.store_id, store]));
      verified = savedIds.filter(id => {
        const row = actual.get(id), store = expected.get(id);
        return row && store && ['store_name', 'industry_name', 'industry_code', 'road_address', 'latitude', 'longitude']
          .every(field => row[field] === store[field]);
      }).length;
      const industry = stores.find(store => savedIds.includes(store.store_id) && store.industry_code)?.industry_code;
      if (industry) {
        const search = await client.query('SELECT count(*)::int AS count FROM public.stores WHERE industry_code = $1', [industry]);
        industryMatches = search.rows[0].count;
      }
    }
  } catch (error) { failure ??= databaseFailure('verification', error); }
  try { afterCount = (await client.query('SELECT count(*)::int AS count FROM public.stores')).rows[0].count; }
  catch (error) { failure ??= databaseFailure('after-count', error); }
  return { attempted: stores.length, upserted: savedIds.length, verified, industryMatches,
    beforeCount, afterCount, failed: failure !== null, ...(failure ? { failure } : {}) };
}

async function main() {
  if (process.argv.includes('--all-busan')) {
    const { runAllBusan, parseAllOptions } = await import('./collect-all-busan.js');
    await runAllBusan(parseAllOptions(process.argv.slice(2)));
    return;
  }
  const { save, limit } = parseOptions(process.argv.slice(2));
  let stores;
  if (limit === 100) {
    const dongCode = await chooseBusanDong();
    const { result, prepared } = await collectStores(dongCode);
    stores = prepared.stores;
    console.log(JSON.stringify({ mode: save ? 'save' : 'dry-run', dongCode,
      api: { status: result.diagnostic.status, format: result.diagnostic.format,
        resultCode: result.diagnostic.code, received: result.rawCount, total: result.total,
        sourceFields: result.sourceFields },
      validation: { valid: stores.length, missingFields: prepared.missingFields,
        missingIds: prepared.missingIds, duplicates: prepared.duplicates,
        invalidCoordinates: prepared.invalidCoordinates, wrongDong: prepared.wrongDong } }));
  } else {
    const collected = await collectBusanStores(limit);
    stores = collected.stores;
    console.log(JSON.stringify({ mode: save ? 'save' : 'dry-run', target: limit,
      targetReached: collected.targetReached, validation: collected.counts,
      districts: collected.districts }));
  }
  if (!save) return;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 설정되지 않았습니다.');
  const { Client } = await import('pg');
  let client;
  let phase = 'connection';
  try {
    // Let pg apply DATABASE_URL SSL settings, including a future sslrootcert.
    client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
    await client.connect();
    phase = 'save';
    const saved = await saveStores(client, stores);
    console.log(JSON.stringify({ database: saved }));
    if (saved.failed || saved.verified !== saved.upserted) {
      if (!saved.failed) console.error(JSON.stringify({ databaseError: { phase: 'verification', code: null,
        reason: '저장 처리 건수와 실제 조회 건수가 다릅니다.' } }));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ databaseError: databaseFailure(phase, error) }));
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
