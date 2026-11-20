import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const dbPath=process.env.BINSIGHT_SQLITE_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','.cache','binsight.sqlite');
const fields=['bplcnm','majornm','minornm','upjongnm','trdstatenm','geom','rdnwhladdr','apvpermymd','dcbymd'];
let db;
function database() {
  if(db) return db;
  mkdirSync(path.dirname(dbPath),{recursive:true});
  db=new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS history_snapshot_meta (
      id INTEGER PRIMARY KEY CHECK(id=1), total INTEGER NOT NULL, raw_count INTEGER NOT NULL,
      invalid INTEGER NOT NULL, cached_at INTEGER NOT NULL, schema_version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history_records (
      fingerprint TEXT PRIMARY KEY, bplcnm TEXT, majornm TEXT, minornm TEXT, upjongnm TEXT,
      trdstatenm TEXT, geom TEXT, rdnwhladdr TEXT, apvpermymd TEXT, dcbymd TEXT
    ) WITHOUT ROWID;
  `);
  return db;
}

export function loadHistorySnapshot(maxAgeMs=86400000) {
  const store=database();
  const meta=store.prepare('SELECT total, raw_count, invalid, cached_at, schema_version FROM history_snapshot_meta WHERE id=1').get();
  if(!meta || meta.schema_version!==1 || meta.raw_count<meta.total || Date.now()-meta.cached_at>maxAgeMs) return null;
  const rows=store.prepare(`SELECT ${fields.join(',')} FROM history_records`).all();
  return {rows,total:meta.total,rawCount:meta.raw_count,invalid:meta.invalid,truncated:false,cachedAt:meta.cached_at};
}

export function saveHistorySnapshot({rows,total,rawCount,invalid=0}) {
  if(!Number.isSafeInteger(total)||total<0||rawCount<total||invalid>0) return false;
  const store=database();
  const insert=store.prepare(`INSERT OR IGNORE INTO history_records (fingerprint,${fields.join(',')}) VALUES (${new Array(fields.length+1).fill('?').join(',')})`);
  const meta=store.prepare(`INSERT INTO history_snapshot_meta (id,total,raw_count,invalid,cached_at,schema_version)
    VALUES (1,?,?,?, ?,1) ON CONFLICT(id) DO UPDATE SET total=excluded.total,raw_count=excluded.raw_count,
    invalid=excluded.invalid,cached_at=excluded.cached_at,schema_version=excluded.schema_version`);
  store.exec('BEGIN IMMEDIATE');
  try {
    store.exec('DELETE FROM history_records');
    for(const row of rows) {
      const values=fields.map(field=>row[field]===undefined||row[field]===null?null:String(row[field]));
      const fingerprint=createHash('sha256').update(JSON.stringify(values)).digest('hex');
      insert.run(fingerprint,...values);
    }
    meta.run(total,rawCount,invalid,Date.now());
    store.exec('COMMIT');
    return true;
  } catch(error) {
    store.exec('ROLLBACK');
    throw error;
  }
}

export function closeHistoryStore() {
  if(db) { db.close(); db=undefined; }
}
