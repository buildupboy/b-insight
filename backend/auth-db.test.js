import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import pg from 'pg';
import {createAuthHandler} from './auth.js';

// Run explicitly with npm run test:auth:db after migration. All writes roll back.
test('real DB: signup, cookies, reload, deduplication, account isolation, deletion and logout', {skip:!process.env.DATABASE_URL},async()=>{
  const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});
  await client.connect();
  try{
    await client.query('BEGIN');
    const handler=createAuthHandler({pool:client});
    async function call(path,method='GET',input,cookie){
      const req=Readable.from(input?[Buffer.from(JSON.stringify(input))]:[]);
      req.method=method;req.headers={host:'localhost',cookie};req.socket={remoteAddress:'127.0.0.1'};
      const result={};const res={setHeader(k,v){if(k==='Set-Cookie')result.cookie=v.split(';')[0];},writeHead(status){result.status=status;},end(value){result.data=JSON.parse(value);}};
      await handler(req,res,path);return result;
    }
    const suffix=randomBytes(8).toString('hex'),password=randomBytes(12).toString('hex');
    const username=`verify${suffix}`;
    const first=await call('/api/auth/signup','POST',{username,password,passwordConfirm:password});
    assert.equal(first.status,201,first.data.error);assert.equal(first.data.user.username,username);
    const second=await call('/api/auth/signup','POST',{username:`other${suffix}`,password,passwordConfirm:password});
    assert.equal(second.status,201,second.data.error);
    assert.equal((await call('/api/auth/me','GET',null,first.cookie)).data.user.id,first.data.user.id);
    const stored=await client.query('SELECT password_hash FROM public.binsight_users WHERE id=$1',[first.data.user.id]);
    assert.ok(!stored.rows[0].password_hash.includes(password));
    const reference=await client.query('SELECT district_name,dong_name,industry_name FROM public.stores WHERE district_name IS NOT NULL AND dong_name IS NOT NULL LIMIT 1');
    assert.ok(reference.rows.length,'Existing stores are required');
    const row=reference.rows[0],areaId=Buffer.from(`${row.district_name}|${row.dong_name}`).toString('base64url');
    for(let i=0;i<2;i++)assert.equal((await call('/api/saved-areas','POST',{areaId,industry:row.industry_name},first.cookie)).status,200);
    assert.equal((await call('/api/saved-areas','GET',null,first.cookie)).data.areas.length,1);
    assert.equal((await call('/api/saved-areas','GET',null,second.cookie)).data.areas.length,0);
    await call(`/api/saved-areas/${areaId}`,'DELETE',null,second.cookie);
    assert.equal((await call('/api/saved-areas','GET',null,first.cookie)).data.areas.length,1);
    const login=await call('/api/auth/login','POST',{username:username.toUpperCase(),password});
    assert.equal(login.status,200);assert.equal((await call('/api/saved-areas','GET',null,login.cookie)).data.areas.length,1);
    await call(`/api/saved-areas/${areaId}`,'DELETE',null,login.cookie);
    assert.equal((await call('/api/saved-areas','GET',null,first.cookie)).data.areas.length,0);
    await call('/api/auth/logout','POST',null,login.cookie);
    assert.equal((await call('/api/auth/me','GET',null,login.cookie)).data.user,null);
    assert.equal((await call('/api/saved-areas','POST',{areaId},login.cookie)).status,401);
  }finally{await client.query('ROLLBACK');await client.end();}
});
