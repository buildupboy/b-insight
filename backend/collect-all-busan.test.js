import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preflight, preparePage, parseAllOptions, retryable, capacityEstimate, createFetcher,
  runCollection } from './collect-all-busan.js';

const diagnostic = { status: 200, format: 'json', code: '00' };
const row = (id, district = '26110') => ({ bizesId: id, bizesNm: '상가', ctprvnCd: '26',
  signguCd: district, indsSclsNm: '음식', indsSclsCd: 'I21201',
  rdnmAdr: '부산광역시 중구 중앙대로', lat: '35', lon: '129' });
const page = (rows, total) => ({ rows, total, rawCount: rows.length, invalid: 0, diagnostic });

function fakeDb() {
  const table = new Map();
  let failOnce = false;
  return { table, setFailure() { failOnce = true; }, async query(sql, values) {
    if (sql.startsWith('INSERT')) {
      if (failOnce) { failOnce = false; throw Object.assign(new Error('secret password'), { code: '42501' }); }
      for (let i = 0; i < values.length; i += 7) table.set(values[i], values.slice(i, i + 7));
      return { rowCount: values.length / 7 };
    }
    if (sql.startsWith('SELECT count(*)') && sql.includes('WHERE store_id = ANY'))
      return { rows: [{ count: values[0].filter(id => table.has(id)).length }] };
    if (sql.includes('WHERE store_id = ANY')) return { rows: values[0].filter(id => table.has(id)).map(id => {
      const values = table.get(id);
      return { store_id: id, store_name: values[1], industry_name: values[2],
        industry_code: values[3], road_address: values[4], latitude: values[5], longitude: values[6] };
    }) };
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: table.size, non_busan_address: 0 }] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw new Error('unexpected SQL');
  } };
}

test('explicit full mode and capacity reserve', () => {
  assert.deepEqual(parseAllOptions(['--all-busan']),
    { save: false, allBusan: true, preflight: false, dbLimitMb: null, apiCallBudget: null });
  assert.throws(() => parseAllOptions(['--all-busan', '--save']));
  assert.equal(parseAllOptions(['--all-busan', '--save', '--db-limit-mb=500', '--api-call-budget=200']).save, true);
  assert.equal(capacityEstimate(100e6, 10e6, 10000, 150000, 500).safe, true);
  assert.equal(capacityEstimate(400e6, 10e6, 10000, 150000, 500).safe, false);
  assert.equal(retryable({ diagnostic: { status: 401 } }), false);
  assert.equal(retryable({ diagnostic: { status: 503 } }), true);
});

test('preflight checks page size, total and overlap with only two pages', async () => {
  const calls = [];
  const plan = await preflight(async (number, size) => {
    calls.push([number, size]);
    return page(Array.from({ length: number === 1 ? 1000 : 3 }, (_, i) =>
      row(`S${(number - 1) * size + i}`)), 1003);
  });
  assert.deepEqual(calls, [[1, 1000], [2, 1000]]);
  assert.equal(plan.pages, 2);
  assert.equal(plan.total, 1003);
  assert.equal(plan.sampledRows, 1003);
});

test('transient API errors retry at most three times; authentication errors stop', async () => {
  let calls = 0;
  const fetcher = createFetcher(async () => {
    calls++;
    if (calls < 3) throw { name: 'DataApiError', diagnostic: { status: 503 } };
    return page([row('A')], 1);
  }, async () => {}, 0);
  assert.equal((await fetcher(1, 100)).rawCount, 1);
  assert.equal(calls, 3);
  const unauthorized = createFetcher(async () => {
    calls++;
    throw { name: 'DataApiError', diagnostic: { status: 401 } };
  }, async () => {}, 0);
  await assert.rejects(unauthorized(1, 100));
  assert.equal(calls, 4);
  const limited = createFetcher(async () => page([row('A')], 1), async () => {}, 0, 1);
  await limited(1, 100);
  await assert.rejects(limited(2, 100), /호출 예산/);
});

test('page validation counts duplicate, missing and non-Busan rows', () => {
  const result = preparePage(page([row('A'), row('A'), row(''), row('B', '11110')], 4),
    1, { total: 4, pageSize: 100 }, new Set());
  assert.equal(result.stores.length, 1);
  assert.equal(result.counts.duplicates, 1);
  assert.equal(result.counts.missingIds, 1);
  assert.equal(result.counts.wrongRegion, 1);
});

test('failed page resumes once and checkpoint follows verified commit', async () => {
  const dir = await mkdtemp(resolve('.store-test-'));
  try {
    const db = fakeDb();
    const plan = { total: 3, pageSize: 2, pages: 2 };
    const fetchPage = async number => number === 1 ? page([row('A'), row('B')], 3) : page([row('C')], 3);
    db.setFailure();
    const failed = await runCollection(plan, fetchPage, db, dir);
    assert.equal(failed.complete, false);
    assert.deepEqual(failed.failedPages.map(f => f.pageNo), [1]);
    assert.equal(failed.lastPage, 0);
    const complete = await runCollection(plan, fetchPage, db, dir);
    assert.equal(complete.complete, true);
    assert.equal(complete.dbUniqueStores, 3);
    assert.equal(complete.received, 3);
    assert.deepEqual(complete.failedPages, []);
    const repeated = await runCollection(plan, fetchPage, db, dir);
    assert.equal(repeated.dbUniqueStores, 3);
    assert.equal(repeated.received, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
