import pg from 'pg';
import {readFile} from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL을 설정해주세요.');
const client = new pg.Client({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:8000});
try {
  await client.connect();
  await client.query(await readFile(new URL('../docs/auth-saved-areas.sql', import.meta.url), 'utf8'));
  console.log('로그인·관심 상권 테이블 마이그레이션 완료');
} finally { await client.end(); }
