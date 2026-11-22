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

export async function loadIndustryLocations({district, dong}, industryCodes) {
  if (!process.env.DATABASE_URL) throw new RecommendationDbError('DATABASE_URL이 설정되지 않았습니다.');
  const client = new pg.Client({connectionString:process.env.DATABASE_URL,...queryOptions});
  try {
    await client.connect();
    const {rows} = await client.query(`SELECT store_id AS id, store_name AS name, road_address AS address,
        latitude::float8 AS latitude, longitude::float8 AS longitude
      FROM public.stores
      WHERE district_name = $1 AND dong_name = $2 AND industry_code = ANY($3::text[])
        AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180`, [district,dong,industryCodes]);
    return rows;
  } catch {
    throw new RecommendationDbError('선택한 동의 점포 위치를 조회할 수 없습니다.');
  } finally {
    await client.end().catch(() => {});
  }
}

// 선택한 동의 점포 범위에 반경만큼 여유를 둔 사각형 안의 모든 점포를 읽는다.
// 옆 동의 경쟁 점포도 거리 계산에 들어가도록 동 경계 밖까지 조회한다.
export async function loadSpotStores({district, dong}, industryCodes, margin) {
  if (!process.env.DATABASE_URL) throw new RecommendationDbError('DATABASE_URL이 설정되지 않았습니다.');
  const client = new pg.Client({connectionString:process.env.DATABASE_URL,...queryOptions});
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const {rows} = await client.query(`WITH bounds AS (
        SELECT min(latitude) AS south, max(latitude) AS north, min(longitude) AS west, max(longitude) AS east
        FROM public.stores
        WHERE district_name = $1 AND dong_name = $2
          AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
      SELECT s.latitude::float8 AS latitude, s.longitude::float8 AS longitude, s.road_address AS address,
        (s.district_name = $1 AND s.dong_name = $2) AS "inDong",
        COALESCE(s.industry_code = ANY($3::text[]), false) AS "sameIndustry"
      FROM public.stores s, bounds b
      WHERE s.latitude BETWEEN b.south - $4 AND b.north + $4
        AND s.longitude BETWEEN b.west - $5 AND b.east + $5`, [district,dong,industryCodes,margin.lat,margin.lng]);
    await client.query('ROLLBACK');
    return rows;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw new RecommendationDbError('경쟁이 적은 지점을 계산할 점포 위치를 조회할 수 없습니다.');
  } finally {
    await client.end().catch(() => {});
  }
}
