import { spawnSync } from 'node:child_process';

export function runPostgres(sql, { timeoutMs = 60000 } = {}) {
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error('.env에 SUPABASE_DB_URL을 설정하세요.');
  }
  const connection = new URL(process.env.SUPABASE_DB_URL);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.password) {
    throw new Error('SUPABASE_DB_URL에 비밀번호가 포함된 PostgreSQL 연결 문자열을 설정하세요.');
  }
  const password = decodeURIComponent(connection.password);
  connection.password = '';
  if (!connection.searchParams.has('sslmode')) connection.searchParams.set('sslmode', 'require');
  if (!connection.searchParams.has('connect_timeout')) connection.searchParams.set('connect_timeout', '10');

  const result = spawnSync(process.env.PSQL_PATH || 'psql', [
    '-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', `--dbname=${connection}`, '--file=-',
  ], {
    input: sql,
    env: { ...process.env, SUPABASE_DB_URL: '', PGPASSWORD: password, PGCLIENTENCODING: 'UTF8' },
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error?.code === 'ENOENT') throw new Error('psql을 찾지 못했습니다. PATH에 추가하거나 .env의 PSQL_PATH에 실행 파일 경로를 설정하세요.');
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`Supabase 적재가 ${timeoutMs / 1000}초를 초과했습니다 (ETIMEDOUT).`);
  }
  if (result.error || result.status !== 0) {
    const stderr = result.stderr?.trim().split(/\r?\n/).filter(line => !line.includes('NOTICE:')) ?? [];
    const detail = [result.error?.code, result.signal, ...stderr].filter(Boolean).join('\n')
      || `psql 종료 코드 ${result.status}`;
    throw new Error(`Supabase 적재 오류 (${detail})`);
  }
  console.log(result.stdout.trim());
}

function jsonPayload(data) {
  // Base64 keeps API values out of the SQL syntax and preserves UTF-8 across terminals.
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  return `convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb`;
}

export function saveChangesToPostgres(rows, columns) {
  const definitions = columns.map(([name, , type]) => `${name} ${type}`).join(', ');
  const fields = columns.map(([name]) => name).join(', ');
  const data = rows.map(row => Object.fromEntries(columns.map(([name, , type]) => [
    name, type === 'NUMERIC' && typeof row[name] === 'string' && !row[name].trim() ? null : row[name] ?? null,
  ])));
  runPostgres(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS public.commercial_change (${definitions});
    ALTER TABLE public.commercial_change ENABLE ROW LEVEL SECURITY;
    TRUNCATE public.commercial_change;
    INSERT INTO public.commercial_change (${fields})
      SELECT ${fields} FROM jsonb_to_recordset(${jsonPayload(data)}) AS api_row(${definitions});
    COMMIT;
    SELECT COUNT(*) AS stored_rows FROM public.commercial_change;
    SELECT ${fields} FROM public.commercial_change ORDER BY comm_nm, type_nm LIMIT 5;
  `);
}

export function saveRawChangePages(rawPages, total) {
  runPostgres(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS public.commercial_change_raw_pages (
      page_no integer PRIMARY KEY,
      response_body text NOT NULL
    );
    ALTER TABLE public.commercial_change_raw_pages ENABLE ROW LEVEL SECURITY;
    TRUNCATE public.commercial_change_raw_pages;
    INSERT INTO public.commercial_change_raw_pages (page_no, response_body)
      SELECT page_no, response_body FROM jsonb_to_recordset(${jsonPayload(rawPages)})
        AS api_page(page_no integer, response_body text);

    CREATE OR REPLACE VIEW public.commercial_change_raw
      WITH (security_invoker = true) AS
      WITH pages AS (
        SELECT page_no, response_body::jsonb AS payload FROM public.commercial_change_raw_pages
      ), bodies AS (
        SELECT page_no, COALESCE(NULLIF(payload #> '{response,body}', 'null'::jsonb),
          NULLIF(payload -> 'body', 'null'::jsonb), payload) AS body FROM pages
      ), items AS (
        SELECT page_no, COALESCE(NULLIF(body #> '{items,item}', 'null'::jsonb),
          NULLIF(body -> 'items', 'null'::jsonb), NULLIF(body -> 'item', 'null'::jsonb), body -> 'data') AS rows
          FROM bodies
      )
      SELECT page_no, row_no, raw_data
        FROM items CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(items.rows)
          WHEN 'array' THEN items.rows
          WHEN 'object' THEN jsonb_build_array(items.rows)
          ELSE '[]'::jsonb END) WITH ORDINALITY AS entry(raw_data, row_no);

    DO $$ BEGIN
      IF (SELECT COUNT(*) FROM public.commercial_change_raw) <> ${total} THEN
        RAISE EXCEPTION 'Raw row count does not match the API total';
      END IF;
    END; $$;
    COMMIT;
    SELECT COUNT(*) AS stored_pages FROM public.commercial_change_raw_pages;
    SELECT COUNT(*) AS stored_rows FROM public.commercial_change_raw;
  `);
}
