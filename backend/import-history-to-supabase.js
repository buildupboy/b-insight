const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DATA_GO_KR_SERVICE_KEY'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const apiKey = process.env.DATA_GO_KR_SERVICE_KEY;
const apiBase = process.env.BUSAN_STORE_HISTORY_API_BASE_URL || 'https://apis.data.go.kr/6260000/BusanCommercialHistoryService';
const route = process.env.BUSAN_STORE_HISTORY_API_PATH || '/getCommercialHistoryList';
const target = Number(process.env.HISTORY_IMPORT_LIMIT || 1000);
const pageSize = Math.min(1000, target);
const table = process.env.SUPABASE_HISTORY_TABLE || 'store_history';
function geomCoords(value) {
  if (!value) return { longitude: null, latitude: null };
  const nums = String(value).match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (nums.length < 2) return { longitude: null, latitude: null };
  // API geom is preserved verbatim. Coordinates are populated only when values look like WGS84 lon/lat.
  const [a, b] = nums;
  if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return { longitude: a, latitude: b };
  if (Math.abs(b) <= 180 && Math.abs(a) <= 90) return { longitude: b, latitude: a };
  return { longitude: null, latitude: null };
}
function toDate(value) {
  if (!value) return null;
  const s = String(value).trim().replace(/[./]/g, '-');
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(d)) ? null : d;
}
async function loadPage(pageNo) {
  const url = new URL(apiBase.replace(/\/$/, '') + route);
  let decodedKey = apiKey;
  try { decodedKey = decodeURIComponent(apiKey); } catch {}
  url.searchParams.set('serviceKey', decodedKey);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(pageSize));
  url.searchParams.set('resultType', 'json');
  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) throw new Error(`History API HTTP ${response.status}`);
  let json;
  try { json = JSON.parse(bodyText); } catch { throw new Error('History API returned non-JSON response'); }
  const responseBody = json?.response?.body ?? json?.body ?? json;
  const header = json?.response?.header ?? json?.header ?? {};
  const code = String(header.resultCode ?? header.resultCd ?? '00');
  if (!['00','0'].includes(code)) throw new Error(`History API error code ${code}`);
  const raw = responseBody?.items?.item ?? responseBody?.items ?? responseBody?.item ?? [];
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return { rows, total: Number(responseBody?.totalCount ?? responseBody?.totalCnt ?? 0) };
}
function mapRow(row) {
  const geom = geomCoords(row.geom);
  return {
    store_name: row.bplcnm ?? null,
    industry_name: row.upjongnm ?? row.minornm ?? row.majornm ?? null,
    address: row.rdnwhladdr ?? null,
    opened_at: toDate(row.apvpermymd),
    closed_at: toDate(row.dcbymd),
    longitude: geom.longitude,
    latitude: geom.latitude,
    raw_data: row
  };
}
async function insertBatch(records) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(records)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase insert failed (${response.status}): ${text.slice(0, 700)}`);
  }
}
let inserted = 0;
for (let pageNo = 1; inserted < target; pageNo++) {
  const page = await loadPage(pageNo);
  if (!page.rows.length) break;
  const batch = page.rows.slice(0, target - inserted).map(mapRow);
  await insertBatch(batch);
  inserted += batch.length;
  console.log(`Processed ${inserted}/${target} rows (API total reported: ${page.total || 'unknown'})`);
  if (page.rows.length < pageSize) break;
}
console.log(`Finished limited import. Processed ${inserted} rows into ${table}.`);
