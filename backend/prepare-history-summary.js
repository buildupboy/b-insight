import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {historySummaryBuildSql} from './recommendation-context-db.js';

export async function prepareHistorySummary(client) {
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query('CREATE SCHEMA IF NOT EXISTS binsight_private');
    await client.query('REVOKE ALL ON SCHEMA binsight_private FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS binsight_private.history_summary (
      id integer PRIMARY KEY CHECK (id=1),schema_version integer NOT NULL,
      history_rows jsonb NOT NULL,monthly_rows jsonb NOT NULL,
      source_rows bigint NOT NULL,refreshed_at timestamptz NOT NULL DEFAULT now())`);
    const {rows:[snapshot]}=await client.query(historySummaryBuildSql);
    const {rows:[source]}=await client.query(`SELECT count(*)::text AS count
      FROM public.commercial_history_by_dong
      WHERE district_name IS NOT NULL AND administrative_dong_name IS NOT NULL`);
    const sourceRows=Number(source.count);
    const represented=snapshot.history_rows.reduce((sum,row)=>sum+row.records+row.duplicate_records,0);
    if (!sourceRows) throw Object.assign(new Error('No source history'),{code:'HISTORY_EMPTY'});
    if (!Number.isSafeInteger(sourceRows) || sourceRows!==represented)
      throw Object.assign(new Error('History count mismatch'),{code:'HISTORY_COUNT_MISMATCH'});
    await client.query(`INSERT INTO binsight_private.history_summary
      (id,schema_version,history_rows,monthly_rows,source_rows,refreshed_at)
      VALUES (1,1,$1::jsonb,$2::jsonb,$3,now())
      ON CONFLICT (id) DO UPDATE SET schema_version=EXCLUDED.schema_version,
        history_rows=EXCLUDED.history_rows,monthly_rows=EXCLUDED.monthly_rows,
        source_rows=EXCLUDED.source_rows,refreshed_at=EXCLUDED.refreshed_at`,
      [JSON.stringify(snapshot.history_rows),JSON.stringify(snapshot.monthly_rows),sourceRows]);
    await client.query('COMMIT');
    return {prepared:true,sourceRows,areas:snapshot.history_rows.length,months:snapshot.monthly_rows.length};
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    if (!process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL missing'),{code:'DATABASE_URL_MISSING'});
    client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000,query_timeout:310000});
    await client.connect();
    console.log(JSON.stringify(await prepareHistorySummary(client)));
  } catch (error) {
    const code=/^[A-Z0-9_]{5,30}$/.test(error.code??'')?error.code:'UNKNOWN';
    console.error(`점포이력 사전 집계를 저장하지 못했습니다. (오류 코드: ${code})`);
    process.exitCode=1;
  } finally {await client?.end().catch(()=>{});}
}
