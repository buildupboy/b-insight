import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_GO_KR_SERVICE_KEY = 'fixture-key';
const { collectStores, collectBusanStores, prepareStores, parseOptions, saveStores, databaseFailure } = await import('./collect-stores.js');
const wrap = (items, code = '00') => new Response(JSON.stringify({
  response: { header: { resultCode: code }, body: { items: { item: items }, totalCount: items.length } }
}), { status: 200, headers: { 'content-type': 'application/json' } });

test('one dong page requests JSON and at most 100 rows, preserving store fields', async () => {
  globalThis.fetch = async url => {
    assert.equal(url.pathname.endsWith('/storeListInDong'), true);
    assert.equal(url.searchParams.get('pageNo'), '1');
    assert.equal(url.searchParams.get('numOfRows'), '100');
    assert.equal(url.searchParams.get('type'), 'json');
    assert.equal(url.searchParams.get('key'), '2623010000');
    return wrap([{ bizesId: 'A', bizesNm: 'Store', adongCd: '2623010000',
      indsSclsNm: 'Cafe', indsSclsCd: 'I21201', rdnmAdr: 'Road', lat: '35.1', lon: '129.1' }]);
  };
  const { result, prepared } = await collectStores('2623010000');
  assert.equal(result.diagnostic.status, 200);
  assert.equal(result.diagnostic.format, 'json');
  assert.equal(result.diagnostic.code, '00');
  assert.equal(prepared.stores.length, 1);
  assert.deepEqual(prepared.stores[0], { store_id: 'A', store_name: 'Store',
    industry_name: 'Cafe', industry_code: 'I21201', road_address: 'Road',
    latitude: 35.1, longitude: 129.1 });
});

test('missing ID, duplicate ID, wrong dong and invalid coordinates are counted', () => {
  const row = { bizesId: 'A', adongCd: '2623010000', lat: '35', lon: '129' };
  const result = prepareStores([row, row, { adongCd: '2623010000' },
    { bizesId: 'B', adongCd: '2623010000', lat: '999' },
    { bizesId: 'C', adongCd: '2623020000' }], '2623010000');
  assert.equal(result.stores.length, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.missingIds, 1);
  assert.equal(result.invalidCoordinates, 1);
  assert.equal(result.wrongDong, 1);
  assert.equal(result.stores[0].store_name, null);
});

test('upsert uses bindings, verifies stored IDs and industry search, and remains idempotent', async () => {
  const table = new Map();
  const client = { async query(sql, values) {
    if (sql.startsWith('INSERT')) {
      assert.match(sql, /ON CONFLICT \(store_id\) DO UPDATE/);
      assert.match(sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\)/);
      for (let i = 0; i < values.length; i += 7) table.set(values[i], values.slice(i, i + 7));
      return { rowCount: 1, rows: [{ store_id: values[0] }] };
    }
    if (sql.includes('ANY($1::text[])')) return { rows: values[0].filter(id => table.has(id)).map(id => {
      const row = table.get(id);
      return { store_id: id, store_name: row[1], industry_name: row[2],
        industry_code: row[3], road_address: row[4], latitude: row[5], longitude: row[6] };
    }) };
    if (sql.includes('industry_code = $1')) return { rows: [{ count: [...table.values()].filter(row => row[3] === values[0]).length }] };
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: table.size }] };
    throw new Error('unexpected query');
  } };
  const stores = [{ store_id: 'A', store_name: 'Store', industry_name: 'Cafe',
    industry_code: 'I21201', road_address: 'Road', latitude: 35, longitude: 129 }];
  const first = await saveStores(client, stores);
  stores[0].store_name = 'Updated';
  const second = await saveStores(client, stores);
  assert.deepEqual(first, { attempted: 1, upserted: 1, verified: 1, industryMatches: 1,
    beforeCount: 0, afterCount: 1, failed: false });
  assert.equal(second.verified, 1);
  assert.equal(table.size, 1);
  assert.equal(table.get('A')[1], 'Updated');
});

test('a failed upsert reports a safe PostgreSQL code and verifies earlier writes', async () => {
  let inserted = 0;
  const client = { async query(sql, values) {
    if (sql.startsWith('INSERT')) {
      inserted++;
      if (inserted === 1) { assert.equal(values.length, 700); assert.match(sql, /\$700/); }
      if (inserted === 2) throw Object.assign(new Error('DATABASE_URL=secret password=secret'),
        { code: '42501', detail: 'secret' });
      return { rowCount: 100 };
    }
    if (sql.includes('ANY($1::text[])')) return { rows: Array.from({ length: 100 }, (_, i) => ({
      store_id: `S${i}`, store_name: null, industry_name: null,
      industry_code: 'I21201', road_address: null, latitude: null, longitude: null })) };
    if (sql.includes('industry_code = $1')) return { rows: [{ count: 100 }] };
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: inserted ? 100 : 0 }] };
    throw new Error('unexpected query');
  } };
  const stores = Array.from({ length: 101 }, (_, i) => `S${i}`).map(store_id => ({ store_id, store_name: null,
    industry_name: null, industry_code: 'I21201', road_address: null,
    latitude: null, longitude: null }));
  const saved = await saveStores(client, stores);
  assert.equal(saved.attempted, 101);
  assert.equal(saved.upserted, 100);
  assert.equal(saved.verified, 100);
  assert.deepEqual(saved.failure, { phase: 'upsert', code: '42501',
    reason: '테이블 권한 또는 RLS 정책이 INSERT/UPDATE를 허용하지 않습니다.' });
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.deepEqual(databaseFailure('connection', { code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'password=secret' }),
    { phase: 'connection', code: 'SELF_SIGNED_CERT_IN_CHAIN', reason: '서버 인증서 체인을 검증할 수 없습니다.' });
});

test('district pages rotate, validate province and deduplicate across pages', async () => {
  const calls = [];
  const fakeRequest = async (_base, operation, params) => {
    const diagnostic = { status: 200, format: 'json', code: '00' };
    if (operation === '/storeZoneInAdmi') return { diagnostic, rows: [
      { ctprvnCd: '26', signguCd: '26110', signguNm: '중구' },
      { ctprvnCd: '26', signguCd: '26140', signguNm: '서구' } ] };
    calls.push(`${params.key}:${params.pageNo}`);
    const rows = Array.from({ length: 100 }, (_, i) => ({
      bizesId: `${params.key}-${params.pageNo}-${i}`, ctprvnCd: '26',
      signguCd: params.key, lat: '35', lon: '129' }));
    if (params.pageNo === 2 && params.key === '26110') rows[0].bizesId = '26110-1-0';
    if (params.pageNo === 2 && params.key === '26110') rows[1].ctprvnCd = '11';
    return { diagnostic, rows, rawCount: 100, total: 1000 };
  };
  const result = await collectBusanStores(300, fakeRequest);
  assert.deepEqual(calls, ['26110:1', '26140:1', '26110:2', '26140:2']);
  assert.equal(result.stores.length, 300);
  assert.equal(result.counts.duplicates, 1);
  assert.equal(result.counts.wrongRegion, 1);
  assert.equal(result.districts.reduce((sum, district) => sum + district.valid, 0), 300);
  assert.throws(() => parseOptions(['--limit=3001']));
  assert.deepEqual(parseOptions(['--limit=3000']), { save: false, limit: 3000 });
});
