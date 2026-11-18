import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { changes } from './data.js';
import { saveChangesToPostgres, saveRawChangePages } from './change-postgres.js';
import { dbPath } from './history-store.js';

const columns = [
  ['type_nm', '상권 구분', 'TEXT'],
  ['comm_nm', '상권명', 'TEXT'],
  ['change_indicator_nm', '변화 상태', 'TEXT'],
  ['average_open_months', '평균 생존개월', 'NUMERIC'],
  ['average_close_months', '평균 폐업개월', 'NUMERIC'],
  ['busan_average_open_months', '부산 평균 생존개월', 'NUMERIC'],
  ['busan_average_close_months', '부산 평균 폐업개월', 'NUMERIC'],
];
const names = columns.map(([name]) => name);

function save(rows) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS commercial_change (
        ${columns.map(([name, , type]) => `${name} ${type}`).join(',\n')}
      ); DELETE FROM commercial_change`);
      const insert = db.prepare(`INSERT INTO commercial_change (${names.join(', ')})
        VALUES (${names.map(() => '?').join(', ')})`);
      for (const row of rows) insert.run(...names.map(name => row[name] ?? null));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

function show(keyword) {
  const noData = '저장된 변화지표가 없습니다. npm run data:changes로 먼저 가져오세요.';
  if (!existsSync(dbPath)) throw new Error(noData);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'commercial_change'").get()) {
      throw new Error(noData);
    }
    const where = 'WHERE (? = \'\' OR instr(comm_nm, ?) > 0)';
    const total = db.prepare('SELECT COUNT(*) AS count FROM commercial_change').get().count;
    const matching = db.prepare(`SELECT COUNT(*) AS count FROM commercial_change ${where}`).get(keyword, keyword).count;
    const labels = columns.map(([name, label]) => `${name} AS "${label}"`).join(', ');
    const rows = db.prepare(`SELECT ${labels} FROM commercial_change ${where}
      ORDER BY comm_nm, type_nm, rowid LIMIT 15`).all(keyword, keyword);
    console.log(`DB ${dbPath} · commercial_change`);
    console.log(`전체 ${total}행 · ${keyword ? `‘${keyword}’ 검색 ${matching}행 · ` : ''}표시 ${rows.length}행`);
    if (rows.length) console.table(rows);
    const summary = db.prepare(`SELECT change_indicator_nm AS "변화 상태", COUNT(*) AS "행 수"
      FROM commercial_change ${where} GROUP BY change_indicator_nm ORDER BY 2 DESC, 1`).all(keyword, keyword);
    if (summary.length) console.table(summary);
  } finally {
    db.close();
  }
}

try {
  const [mode, keyword = '', ...extra] = process.argv.slice(2);
  const raw = mode === '--supabase-raw';
  const supabase = raw || mode === '--supabase';
  if (extra.length || (mode !== undefined && mode !== '--view' && (!supabase || keyword))) {
    throw new Error('사용법: npm run data:changes [-- --view [상권명] | -- --supabase | -- --supabase-raw]');
  }
  if (mode === '--view') {
    show(keyword.trim());
  } else {
    if (supabase && !process.env.SUPABASE_DB_URL) {
      throw new Error('.env에 SUPABASE_DB_URL을 설정하세요.');
    }
    const result = await changes({ preserveBody:raw });
    if (result.truncated || result.total === null || result.rows.length !== result.total) {
      throw new Error(`전체 응답을 확인하지 못했습니다 (${result.rows.length}/${result.total ?? '전체 건수 미확인'}행).`);
    }
    if (raw) {
      saveRawChangePages(result.rawPages, result.total);
    } else if (supabase) {
      saveChangesToPostgres(result.rows, columns);
    } else {
      save(result.rows);
      console.log('부산 상권 변화지표를 저장했습니다.');
      show('');
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
