import { closeSync, openSync, readFileSync, writeSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './history-store.js';
import { runPostgres } from './change-postgres.js';

const sourceColumns = ['fingerprint', 'bplcnm', 'majornm', 'minornm', 'upjongnm',
  'trdstatenm', 'geom', 'rdnwhladdr', 'apvpermymd', 'dcbymd'];
const locationColumns = ['district_name', 'administrative_dong_name'];
const columns = [...sourceColumns, ...locationColumns];
const definitions = `fingerprint TEXT PRIMARY KEY, ${columns.slice(1).map(name => `${name} TEXT`).join(', ')}`;
const table = 'commercial_history_by_dong';
const point = /^POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$/i;

function bounds(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function loadBoundaries(path) {
  const { features } = JSON.parse(readFileSync(path, 'utf8'));
  const districts = features.filter(({ properties }) => /^26\d{8}$/.test(properties.adm_cd2));
  if (!districts.length || new Set(districts.map(f => f.properties.adm_cd2)).size !== districts.length) {
    throw new Error('부산 행정동 경계를 확인할 수 없습니다.');
  }
  return districts.flatMap(({ geometry, properties }) => {
    if (!['Polygon', 'MultiPolygon'].includes(geometry.type) || !properties.sggnm || !properties.adm_nm) {
      throw new Error('부산 행정동 경계 파일 형식이 올바르지 않습니다.');
    }
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map(([outer, ...holes]) => ({ outer, holes, box: bounds(outer),
      district: properties.sggnm, dong: properties.adm_nm.trim().split(/\s+/).at(-1) }));
  });
}

// Returns 1 for the interior, 0 for an edge, and -1 for the exterior.
function locateInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, last = ring.length - 1; i < ring.length; last = i++) {
    const [ax, ay] = ring[last], [bx, by] = ring[i];
    if (ax === bx && ay === by) continue;
    if (x >= Math.min(ax, bx) && x <= Math.max(ax, bx) &&
        y >= Math.min(ay, by) && y <= Math.max(ay, by) &&
        Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) <= 1e-14) return 0;
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside ? 1 : -1;
}

function locate(geom, boundaries) {
  const match = point.exec(geom ?? '');
  if (!match) return { status: 'invalid' };
  const x = Number(match[1]), y = Number(match[2]);
  let interior, edge, sharedEdge = false;
  for (const boundary of boundaries) {
    const [minX, minY, maxX, maxY] = boundary.box;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    const outer = locateInRing(x, y, boundary.outer);
    if (outer < 0) continue;
    const holes = boundary.holes.map(ring => locateInRing(x, y, ring));
    if (holes.includes(1)) continue;
    if (outer === 0 || holes.includes(0)) {
      if (edge && (edge.district !== boundary.district || edge.dong !== boundary.dong)) sharedEdge = true;
      edge = boundary;
    } else {
      if (interior && (interior.district !== boundary.district || interior.dong !== boundary.dong)) {
        return { status: 'ambiguous' };
      }
      interior = boundary;
    }
  }
  const area = interior ?? edge;
  if (!area) return { status: 'outside' };
  if (!interior && sharedEdge) return { status: 'ambiguous' };
  return { status: 'matched', district: area.district, dong: area.dong };
}

function mapSnapshot(db, boundaries) {
  const meta = db.prepare('SELECT total, raw_count, invalid FROM history_snapshot_meta WHERE id = 1').get();
  if (!meta || meta.total < 1 || meta.total !== meta.raw_count || meta.invalid !== 0) {
    throw new Error('완전한 점포이력 캐시를 찾을 수 없습니다.');
  }
  const counts = { apiRows: meta.total, stored: 0, matched: 0, invalid: 0, outside: 0, ambiguous: 0 };
  const locations = new Map();
  db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${definitions}); DELETE FROM ${table}`);
    const select = db.prepare(`SELECT ${sourceColumns.join(', ')} FROM history_records`);
    const insert = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
    for (const row of select.iterate()) {
      if (!locations.has(row.geom)) locations.set(row.geom, locate(row.geom, boundaries));
      const { status, district, dong } = locations.get(row.geom);
      insert.run(...sourceColumns.map(name => row[name]), district ?? null, dong ?? null);
      counts[status]++;
      counts.stored++;
    }
    if (counts.stored === 0 || counts.matched === 0 || counts.stored > counts.apiRows) {
      throw new Error('점포이력 건수 또는 행정동 매핑 결과가 올바르지 않습니다.');
    }
    db.exec(`CREATE INDEX IF NOT EXISTS ${table}_area_idx ON ${table} (${locationColumns.join(', ')}); COMMIT`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return counts;
}

function saveToSupabase(db, expected) {
  const directory = mkdtempSync(join(tmpdir(), 'binsight-history-'));
  const path = join(directory, 'history.csv');
  const fd = openSync(path, 'wx');
  try {
    try {
      const rows = db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).iterate();
      let lines = [];
      for (const row of rows) {
        lines.push(columns.map(name => row[name] === null ? '' : `"${String(row[name]).replaceAll('"', '""')}"`).join(',') + '\n');
        if (lines.length === 1000) {
          writeSync(fd, lines.join(''));
          lines = [];
        }
      }
      writeSync(fd, lines.join(''));
    } finally {
      closeSync(fd);
    }
    const file = path.replaceAll('\\', '/').replaceAll("'", "''");
    runPostgres(`
      BEGIN;
      SET LOCAL statement_timeout = '8min';
      CREATE TABLE IF NOT EXISTS public.${table} (${definitions});
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE TEMP TABLE history_import (LIKE public.${table} INCLUDING CONSTRAINTS) ON COMMIT DROP;
\\copy history_import (${columns.join(', ')}) FROM '${file}' WITH (FORMAT csv)
      DO $$ BEGIN
        IF (SELECT count(*) FROM history_import) <> ${expected} THEN
          RAISE EXCEPTION 'Store history import count mismatch';
        END IF;
      END $$;
      INSERT INTO public.${table} AS stored (${columns.join(', ')})
        SELECT ${columns.join(', ')} FROM history_import
        ON CONFLICT (fingerprint) DO UPDATE SET
          district_name = excluded.district_name,
          administrative_dong_name = excluded.administrative_dong_name
        WHERE (stored.district_name, stored.administrative_dong_name)
          IS DISTINCT FROM (excluded.district_name, excluded.administrative_dong_name);
      CREATE INDEX IF NOT EXISTS ${table}_area_idx
        ON public.${table} (${locationColumns.join(', ')});
      COMMIT;
      SELECT count(*) AS total, count(administrative_dong_name) AS mapped FROM public.${table};
    `, { timeoutMs: 600000 });
  } finally {
    unlinkSync(path);
    rmdirSync(directory);
  }
}

const [boundaryPath, mode, ...extra] = process.argv.slice(2);
try {
  if (!boundaryPath || (mode && mode !== '--supabase') || extra.length) {
    throw new Error('사용법: node --env-file=.env backend/history-db.js <행정동 GeoJSON 경로> [--supabase]');
  }
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    const counts = mapSnapshot(db, loadBoundaries(boundaryPath));
    console.log(JSON.stringify(counts));
    if (mode === '--supabase') saveToSupabase(db, counts.stored);
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
