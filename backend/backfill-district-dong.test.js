import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseOptions, preparePage, updatePage, runBackfill } from './backfill-district-dong.js';

const row = (id, district = '부산진구', dong = '부전1동') => ({ bizesId: id,
  ctprvnCd: '26', signguCd: '26230', signguNm: district, adongNm: dong });
const page = (rows, total) => ({ rows, total, rawCount: rows.length, invalid: 0 });

test('100-row dry run is default and full update requires explicit save and call budget', () => {
  assert.deepEqual(parseOptions([]), { save: false, limit: 100, apiCallBudget: null });
  assert.throws(() => parseOptions(['--limit=101']));
  assert.throws(() => parseOptions(['--save']));
  assert.equal(parseOptions(['--save', '--api-call-budget=160']).save, true);
});

test('only API district and dong names are mapped; missing names remain null', () => {
  const prepared = preparePage(page([row('A'), row('B', '해운대구', ''),
    row('A'), row('C', '중구', '중앙동')], 4), 1, 100, 4);
  assert.deepEqual(prepared.values, [
    { store_id: 'A', district_dong: '부산진구-부전1동' },
    { store_id: 'B', district_dong: null },
    { store_id: 'C', district_dong: '중구-중앙동' }
  ]);
  assert.equal(prepared.counts.missingNames, 1);
  assert.equal(prepared.counts.duplicates, 1);
});

test('UPDATE matches existing store_id only and rolls back on unmatched ID', async () => {
  const queries = [];
  const client = { async query(sql, values) {
    queries.push(sql);
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, /WHERE s\.store_id = v\.store_id/);
      assert.doesNotMatch(sql, /INSERT|UPSERT/i);
      assert.doesNotMatch(sql, /road_address/i);
      assert.deepEqual(values, ['A', '부산진구-부전1동']);
      return { rowCount: 0 };
    }
    return {};
  } };
  await assert.rejects(updatePage(client, [{ store_id: 'A', district_dong: '부산진구-부전1동' }]));
  assert.deepEqual([queries[0], queries.at(-1)], ['BEGIN', 'ROLLBACK']);
});

test('successful page advances checkpoint and a rerun skips completed pages', async () => {
  const root = await mkdtemp(resolve('.district-dong-test-'));
  try {
    const table = new Map([['A', null], ['B', null]]);
    const client = { async query(sql, values) {
      if (sql.startsWith('UPDATE')) {
        for (let i = 0; i < values.length; i += 2) table.set(values[i], values[i + 1]);
        return { rowCount: values.length / 2 };
      }
      if (sql.startsWith('SELECT count(*) FILTER')) return { rows: [{
        populated: [...table.values()].filter(Boolean).length,
        missing: [...table.values()].filter(value => value === null).length,
        total: table.size }] };
      return {};
    } };
    let calls = 0;
    const fetchPage = async number => {
      calls++;
      return number === 1 ? page([row('A')], 2) : page([row('B', '해운대구', '')], 2);
    };
    const first = await runBackfill(client, fetchPage, 2, 1, root);
    assert.equal(first.complete, true);
    assert.equal(first.dbPopulated, 1);
    assert.equal(first.dbMissing, 1);
    const second = await runBackfill(client, fetchPage, 2, 1, root);
    assert.equal(second.complete, true);
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
