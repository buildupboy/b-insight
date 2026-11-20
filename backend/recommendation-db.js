import pg from 'pg';

export class RecommendationDbError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecommendationDbError';
  }
}

const queryOptions = { connectionTimeoutMillis: 8000, query_timeout: 15000 };

export async function loadRecommendationData() {
  if (!process.env.DATABASE_URL) throw new RecommendationDbError('DATABASE_URL이 설정되지 않았습니다.');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ...queryOptions });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const coverage = await client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE district_name IS NULL OR dong_name IS NULL)::int AS unmapped
        FROM public.stores`);
    const industries = await client.query(`SELECT industry_code, industry_name FROM public.stores
        WHERE industry_code IS NOT NULL AND industry_name IS NOT NULL
        GROUP BY industry_code, industry_name ORDER BY industry_code, industry_name`);
    const areas = await client.query(`SELECT district_name, dong_name, count(*)::int AS total
        FROM public.stores WHERE district_name IS NOT NULL AND dong_name IS NOT NULL
        GROUP BY district_name, dong_name ORDER BY district_name, dong_name`);
    await client.query('ROLLBACK');
    if (coverage.rows[0].unmapped) throw new RecommendationDbError('구·행정동이 없는 점포가 있어 지역별 점포 수를 완전하게 계산할 수 없습니다.');
    return { coverage:coverage.rows[0], industries:industries.rows, areas:areas.rows };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof RecommendationDbError) throw error;
    throw new RecommendationDbError('Supabase 점포 데이터를 조회할 수 없습니다. DB 연결과 public.stores 스키마를 확인해 주세요.');
  } finally {
    await client.end().catch(() => {});
  }
}

export async function loadIndustryCounts(industryCodes, areas) {
  if (!Array.isArray(industryCodes) || !industryCodes.length || industryCodes.some(code => !/^[A-Za-z][0-9]{5}$/.test(code))) throw new RecommendationDbError('업종 코드가 올바르지 않습니다.');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ...queryOptions });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`SELECT district_name, dong_name, count(*)::int AS selected
      FROM public.stores WHERE industry_code = ANY($1::text[])
      GROUP BY district_name, dong_name`, [industryCodes]);
    await client.query('ROLLBACK');
    const counts = new Map(result.rows.map(row => [`${row.district_name}\0${row.dong_name}`, row.selected]));
    return areas.map(area => ({ ...area, selected:counts.get(`${area.district_name}\0${area.dong_name}`) ?? 0 }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof RecommendationDbError) throw error;
    throw new RecommendationDbError('Supabase 업종별 점포 수를 조회할 수 없습니다.');
  } finally {
    await client.end().catch(() => {});
  }
}
