import {randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCallback);
const cookieName = 'binsight_session';
const sessionSeconds = 60 * 60 * 24 * 7;
const hashToken = value => createHash('sha256').update(value).digest('hex');
export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function databaseErrorMessage(error) {
  if (error.code === '42P01') return '로그인 테이블이 아직 생성되지 않았습니다. 서버 터미널에서 npm run migrate:auth를 실행해주세요.';
  if (['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','ECONNRESET'].includes(error.code))
    return 'DB에 연결할 수 없습니다. 서버의 네트워크 연결과 DATABASE_URL 설정을 확인해주세요.';
  if (error.code === '28P01') return 'DB 인증에 실패했습니다. 서버의 DATABASE_URL 설정을 확인해주세요.';
  if (error.code === '42501') return 'DB 접근 권한이 없습니다. 서버의 DB 계정과 테이블 권한을 확인해주세요.';
  return '요청을 처리하지 못했습니다. DB 연결과 로그인 테이블 설정을 확인해주세요.';
}
export function credentials(input, signup = false) {
  const username = typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9]{1,40}$/.test(username)) throw new AuthError(422, '아이디는 영문 또는 숫자 1~40자로 입력해주세요.');
  const password = input?.password;
  if (typeof password !== 'string' || [...password].length < 4) throw new AuthError(422, '비밀번호는 4자리 이상 입력해주세요.');
  if (Buffer.byteLength(password, 'utf8') > 72) throw new AuthError(422, '비밀번호는 UTF-8 기준 72바이트 이내로 입력해주세요.');
  if (signup && password !== input.passwordConfirm) throw new AuthError(422, '비밀번호가 일치하지 않습니다.');
  return {username, password};
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [algorithm, salt, value] = hash.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{128}$/.test(value || '')) return false;
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(value, 'hex'));
}
export function decodeAreaId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,240}$/.test(id)) throw new AuthError(422, '상권 식별자가 올바르지 않습니다.');
  const decoded = Buffer.from(id, 'base64url').toString('utf8');
  const parts = decoded.split('|');
  if (parts.length !== 2 || parts.some(value => !value || value.length > 80) || Buffer.from(decoded).toString('base64url') !== id)
    throw new AuthError(422, '상권 식별자가 올바르지 않습니다.');
  return {district:parts[0], dong:parts[1]};
}
function tokenFrom(request) {
  const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
function sessionCookie(response, token, secure) {
  response.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? sessionSeconds : 0}${secure ? '; Secure' : ''}`);
}
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new AuthError(413, '입력 크기를 줄여주세요.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AuthError(422, '입력 내용을 확인해주세요.'); }
}
export function createAuthHandler({pool, secure = process.env.NODE_ENV === 'production', origin = process.env.APP_ORIGIN, now = Date.now} = {}) {
  // Construct lazily so unrelated analysis tests do not open DB connections.
  let database = pool;
  const query = (...args) => {
    if (!database) {
      if (!process.env.DATABASE_URL) throw new AuthError(503, 'DB 연결 설정을 확인해주세요.');
      database = new pg.Pool({connectionString:process.env.DATABASE_URL, max:5, connectionTimeoutMillis:8000, query_timeout:15000, allowExitOnIdle:true});
    }
    return database.query(...args);
  };
  const attempts = new Map();
  function limit(key) {
    const time = now();
    for (const [ip, item] of attempts) if (time >= item.until) attempts.delete(ip);
    const item = attempts.get(key) || {count:0, until:time + 15 * 60 * 1000};
    if (++item.count > 20) throw new AuthError(429, '요청이 많습니다. 잠시 후 다시 시도해주세요.');
    attempts.set(key, item);
  }
  async function currentUser(request) {
    const token = tokenFrom(request);
    if (!token) return null;
    const result = await query(`SELECT u.id, u.username FROM public.binsight_sessions s
      JOIN public.binsight_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hashToken(token)]);
    return result.rows[0] || null;
  }
  async function createSession(user, request, response) {
    const token = randomBytes(32).toString('hex');
    // Rotate a previous session and periodically clean up expired rows.
    const previous = tokenFrom(request);
    await query('DELETE FROM public.binsight_sessions WHERE expires_at<=now() OR token_hash=$1', [previous ? hashToken(previous) : '']);
    await query('INSERT INTO public.binsight_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [hashToken(token), user.id, new Date(now() + sessionSeconds * 1000)]);
    sessionCookie(response, token, secure);
  }
  const send = (response, status, value) => {
    response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
    response.end(JSON.stringify(value));
  };
  return async (request, response, pathname) => {
    if (!pathname.startsWith('/api/auth/') && pathname !== '/api/saved-areas' && !pathname.startsWith('/api/saved-areas/')) return false;
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.method !== 'GET') {
        const expected = origin ? new URL(origin).origin : `${secure ? 'https' : 'http'}://${request.headers.host}`;
        if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== expected))
          throw new AuthError(403, '허용되지 않은 요청입니다.');
      }
      const auth = pathname.match(/^\/api\/auth\/(signup|login|logout|me)$/)?.[1];
      if (auth) {
        if (request.method !== (auth === 'me' ? 'GET' : 'POST')) throw new AuthError(405, '지원하지 않는 요청입니다.');
        if (auth === 'me') { send(response, 200, {user:await currentUser(request)}); return true; }
        if (auth === 'logout') {
          const token = tokenFrom(request);
          if (token) await query('DELETE FROM public.binsight_sessions WHERE token_hash=$1', [hashToken(token)]);
          sessionCookie(response, '', secure); send(response, 200, {ok:true}); return true;
        }
        limit(request.socket.remoteAddress || 'unknown');
        const {username, password} = credentials(await body(request), auth === 'signup');
        let user;
        if (auth === 'signup') {
          const passwordHash = await hashPassword(password);
          try {
            const result = await query('INSERT INTO public.binsight_users(username,password_hash) VALUES($1,$2) RETURNING id,username', [username,passwordHash]);
            user = result.rows[0];
          } catch (error) {
            if (error.code === '23505') throw new AuthError(409, '이미 사용 중인 아이디입니다.');
            throw error;
          }
        } else {
          const result = await query('SELECT id,username,password_hash FROM public.binsight_users WHERE username=$1', [username]);
          const found = result.rows[0];
          // Do equivalent password work even for an unknown username.
          const dummy = `scrypt$00000000000000000000000000000000$${'0'.repeat(128)}`;
          const valid = await verifyPassword(password, found?.password_hash || dummy);
          if (!found || !valid) throw new AuthError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
          user = {id:found.id, username:found.username};
        }
        await createSession(user, request, response);
        send(response, auth === 'signup' ? 201 : 200, {user}); return true;
      }
      if (pathname.startsWith('/api/auth/')) throw new AuthError(404, 'API 경로를 찾을 수 없습니다.');
      const user = await currentUser(request);
      if (!user) throw new AuthError(401, '로그인이 필요합니다.');
      if (pathname === '/api/saved-areas' && request.method === 'GET') {
        const result = await query(`SELECT area_id AS id, area_name AS name, district_name AS region,
          industry_name AS industry, created_at AS "createdAt" FROM public.saved_commercial_areas WHERE user_id=$1 ORDER BY created_at DESC, id DESC`, [user.id]);
        send(response, 200, {areas:result.rows}); return true;
      }
      if (pathname === '/api/saved-areas' && request.method === 'POST') {
        const input = await body(request);
        const {district,dong} = decodeAreaId(input.areaId);
        if (input.industry != null && (typeof input.industry !== 'string' || input.industry.length > 100)) throw new AuthError(422, '업종 정보를 확인해주세요.');
        // Validate the reference and derive display names from existing data, not browser input.
        const area = await query('SELECT district_name,dong_name FROM public.stores WHERE district_name=$1 AND dong_name=$2 LIMIT 1', [district,dong]);
        if (!area.rows.length) throw new AuthError(404, '해당 상권을 찾을 수 없습니다.');
        const result = await query(`INSERT INTO public.saved_commercial_areas(user_id,area_id,area_name,district_name,industry_name)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,area_id) DO UPDATE SET area_id=EXCLUDED.area_id
          RETURNING area_id AS id,area_name AS name,district_name AS region,industry_name AS industry,created_at AS "createdAt"`,
        [user.id,input.areaId,`${district} ${dong}`,district,input.industry?.trim() || null]);
        send(response, 200, {area:result.rows[0]}); return true;
      }
      if (pathname.startsWith('/api/saved-areas/') && request.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/saved-areas/'.length));
        decodeAreaId(id);
        await query('DELETE FROM public.saved_commercial_areas WHERE user_id=$1 AND area_id=$2', [user.id,id]);
        send(response, 200, {ok:true}); return true;
      }
      throw new AuthError(405, '지원하지 않는 요청입니다.');
    } catch (error) {
      if (!(error instanceof AuthError)) console.error('auth_database_error', error.code || error.name);
      send(response, error.status || 503, {error:error instanceof AuthError ? error.message : databaseErrorMessage(error)});
      return true;
    }
  };
}
