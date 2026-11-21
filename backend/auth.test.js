import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuthHandler,credentials,decodeAreaId,hashPassword,verifyPassword,databaseErrorMessage} from './auth.js';

test('DB failures distinguish missing migration from connection errors without exposing secrets',()=>{
  assert.match(databaseErrorMessage({code:'42P01'}),/npm run migrate:auth/);
  assert.match(databaseErrorMessage({code:'ENOTFOUND'}),/DB에 연결할 수 없습니다/);
  const secret='postgresql://private:password@host/db';
  assert.ok(!databaseErrorMessage({message:secret}).includes(secret));
});

export async function request(handler,path,{method='GET',input,cookie,headers={}}={}) {
  const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);
  req.method=method;req.headers={host:'localhost',...headers,...(cookie?{cookie}:{})};req.socket={remoteAddress:'127.0.0.1'};
  const result={headers:{}};
  const res={setHeader(key,value){result.headers[key]=value;},writeHead(status,values){result.status=status;Object.assign(result.headers,values);},end(value){result.data=JSON.parse(value);}};
  result.handled=await handler(req,res,path);return result;
}
const areaId=Buffer.from('부산진구|부전1동').toString('base64url');

test('credentials normalize usernames and enforce password confirmation and byte limits',()=>{
  assert.deepEqual(credentials({username:' Banana123 ',password:'1234'}),{username:'banana123',password:'1234'});
  for(const username of ['', 'a@b.com',"a' OR 1=1",'a'.repeat(41)])assert.throws(()=>credentials({username,password:'1234'}),{status:422});
  assert.throws(()=>credentials({username:'a',password:'123'}),/4자리/);
  assert.throws(()=>credentials({username:'a',password:'한'.repeat(25)}),/72바이트/);
  assert.throws(()=>credentials({username:'a',password:'1234',passwordConfirm:'1235'},true),/일치/);
  assert.equal(credentials({username:'1',password:'한'.repeat(24)}).username,'1');
});
test('salted scrypt hashes never contain plaintext and reject incorrect passwords',async()=>{
  const first=await hashPassword('example1234'),second=await hashPassword('example1234');
  assert.notEqual(first,second);assert.ok(!first.includes('example1234'));
  assert.equal(await verifyPassword('example1234',first),true);
  assert.equal(await verifyPassword('incorrect',first),false);
});
test('area identity preserves district and dong and rejects malformed IDs',()=>{
  assert.deepEqual(decodeAreaId(areaId),{district:'부산진구',dong:'부전1동'});
  assert.notEqual(areaId,Buffer.from('다른구|부전1동').toString('base64url'));
  for(const id of ['../foo','a',Buffer.from('동이름').toString('base64url'),Buffer.from('a|b|c').toString('base64url')])assert.throws(()=>decodeAreaId(id),{status:422});
});
test('anonymous read/save/delete are unauthorized and me is anonymous',async()=>{
  const handler=createAuthHandler({pool:{query(){throw Error('must not reach DB');}}});
  assert.equal((await request(handler,'/api/auth/me')).data.user,null);
  for(const [path,method] of [['/api/saved-areas','GET'],['/api/saved-areas','POST'],[`/api/saved-areas/${areaId}`,'DELETE']]){
    assert.equal((await request(handler,path,{method,input:{areaId}})).status,401);
  }
});
test('cross-site writes are blocked and unknown methods are rejected',async()=>{
  const handler=createAuthHandler();
  assert.equal((await request(handler,'/api/auth/login',{method:'POST',headers:{origin:'https://attacker.example'},input:{}})).status,403);
  assert.equal((await request(handler,'/api/auth/logout',{method:'POST',headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await request(handler,'/api/auth/login')).status,405);
});
test('login and signup have an IP rate limit with expiry',async()=>{
  let time=0;const handler=createAuthHandler({now:()=>time});
  for(let i=0;i<20;i++)assert.equal((await request(handler,'/api/auth/login',{method:'POST',input:{}})).status,422);
  assert.equal((await request(handler,'/api/auth/signup',{method:'POST',input:{}})).status,429);
  time=16*60*1000;
  assert.equal((await request(handler,'/api/auth/login',{method:'POST',input:{}})).status,422);
});
test('signup returns only public user data with an opaque Secure HttpOnly cookie',async()=>{
  const calls=[];
  const handler=createAuthHandler({secure:true,pool:{async query(sql,params){
    calls.push({sql,params});
    if(sql.startsWith('INSERT INTO public.binsight_users'))return {rows:[{id:'user-id',username:params[0]}]};
    return {rows:[]};
  }}});
  const result=await request(handler,'/api/auth/signup',{method:'POST',input:{username:'Banana',password:'1234',passwordConfirm:'1234'}});
  assert.equal(result.status,201);assert.deepEqual(result.data,{user:{id:'user-id',username:'banana'}});
  assert.match(result.headers['Set-Cookie'],/^binsight_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
  const token=result.headers['Set-Cookie'].split(';')[0].split('=')[1];
  const stored=calls.find(call=>call.sql.startsWith('INSERT INTO public.binsight_sessions')).params[0];
  assert.notEqual(stored,token);assert.equal(stored.length,64);
  assert.match(calls[0].params[1],/^scrypt\$/);
});
test('duplicate username returns a Korean conflict error',async()=>{
  const handler=createAuthHandler({pool:{async query(){throw Object.assign(new Error(),{code:'23505'});}}});
  const result=await request(handler,'/api/auth/signup',{method:'POST',input:{username:'a',password:'1234',passwordConfirm:'1234'}});
  assert.equal(result.status,409);assert.equal(result.data.error,'이미 사용 중인 아이디입니다.');
});
test('saved-area queries are scoped to the authenticated session and validate DB references',async()=>{
  const calls=[];const handler=createAuthHandler({pool:{async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('JOIN public.binsight_users'))return {rows:[{id:'owner-id',username:'owner'}]};
    if(sql.includes('FROM public.stores'))return {rows:[{district_name:'부산진구',dong_name:'부전1동'}]};
    if(sql.startsWith('INSERT INTO public.saved_commercial_areas'))return {rows:[{id:areaId}]};
    return {rows:[]};
  }}});
  const cookie=`binsight_session=${'a'.repeat(64)}`;
  assert.equal((await request(handler,'/api/saved-areas',{cookie})).status,200);
  assert.equal((await request(handler,'/api/saved-areas',{method:'POST',cookie,input:{areaId,userId:'attacker',area_name:'forged',industry:'카페'}})).status,200);
  assert.equal((await request(handler,`/api/saved-areas/${areaId}`,{method:'DELETE',cookie})).status,200);
  const savedCalls=calls.filter(call=>call.sql.includes('public.saved_commercial_areas'));
  assert.equal(savedCalls.length,3);for(const call of savedCalls)assert.equal(call.params[0],'owner-id');
  assert.match(savedCalls[0].sql,/WHERE user_id=\$1 ORDER BY created_at DESC/);
  assert.match(savedCalls[1].sql,/ON CONFLICT\(user_id,area_id\)/);assert.equal(savedCalls[1].params[2],'부산진구 부전1동');
  assert.match(savedCalls[2].sql,/WHERE user_id=\$1 AND area_id=\$2/);
});
test('nonexistent areas are not stored and expired or invalid sessions cannot read saved data',async()=>{
  let valid=true;
  const handler=createAuthHandler({pool:{async query(sql){return {rows:sql.includes('JOIN public.binsight_users')&&valid?[{id:'id',username:'a'}]:[]};}}});
  const cookie=`binsight_session=${'b'.repeat(64)}`;
  assert.equal((await request(handler,'/api/saved-areas',{method:'POST',cookie,input:{areaId}})).status,404);
  valid=false;assert.equal((await request(handler,'/api/saved-areas',{cookie})).status,401);
});
