import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {loadAreaContexts,historyContextSql} from './recommendation-context-db.js';

test('history queries use bounded batches and retain one global growth period',async t=>{
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgresql://fixture';
  const areas=Array.from({length:23},(_,i)=>({district_name:'부산진구',dong_name:`동${i}`}));
  const batches=[],commands=[];
  let connected=0,ended=0;
  t.mock.method(pg,'Client',function(){return {
    async connect(){connected++;},async end(){ended++;},
    async query(sql,args){
      if(sql!==historyContextSql){commands.push(sql);return {rows:[]};}
      batches.push(args);
      return {rows:[{
        history_rows:args[1].map(dong=>({district_name:'부산진구',administrative_dong_name:dong,records:30,
          valid_sample:5,average_operating_months:80,permit_records:300,closure_records:100})),
        monthly_rows:args[1].map(dong=>({district_name:'부산진구',administrative_dong_name:dong,
          month:dong==='동22'?'2023-05':'2023-04',openings:8,closures:2})),
      }]};
    },
  };});
  try {
    const result=await loadAreaContexts(areas);
    assert.deepEqual(batches.map(args=>args[1].length),[10,10,3]);
    assert(batches.every(args=>args[2]===null));
    assert.deepEqual(batches.flatMap(args=>args[1]),areas.map(a=>a.dong_name));
    assert.equal(result.history.size,23);
    for(const item of result.history.values()){
      assert.deepEqual(item.growthPeriod,{from:'2022-06',to:'2023-05'});
      assert.equal(item.growth,.6);
      assert.equal(item.stability,80);
      assert.equal(item.permitRecords,300);
      assert.equal(item.closureRecords,100);
    }
    assert.equal(connected,1);
    assert.equal(ended,1);
    assert.equal(commands[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert(commands.includes("SET LOCAL statement_timeout = '14s'"));
    assert.equal(commands.at(-1),'ROLLBACK');
  } finally {if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});

test('history failures return safe error codes, rollback and close without exposing credentials',async t=>{
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgresql://fixture';
  const logs=[];
  t.mock.method(console,'error',line=>logs.push(line));
  let failureCode='57014',rolledBack=0,ended=0;
  t.mock.method(pg,'Client',function(){return {
    async connect(){if(failureCode==='ENOTFOUND')throw Object.assign(new Error('postgresql://user:SECRET@host'),{code:failureCode});},
    async query(sql){
      if(sql==='ROLLBACK'){rolledBack++;return;}
      if(sql===historyContextSql)throw Object.assign(new Error('postgresql://user:SECRET@host'),{code:failureCode});
      return {rows:[]};
    },async end(){ended++;},
  };});
  try {
    for(const code of ['57014','ENOTFOUND','42P01']){
      failureCode=code;
      await assert.rejects(()=>loadAreaContexts([{district_name:'부산진구',dong_name:'부전2동'}]),error=>{
        assert.equal(error.code,code==='57014'?'TIMEOUT':code);
        assert(!error.message.includes('SECRET'));
        return true;
      });
    }
    assert.equal(rolledBack,3);
    assert.equal(ended,3);
    assert(logs.every(line=>!line.includes('SECRET')&&!line.includes('postgresql://')));
  } finally {if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});

test('history cache shares concurrent searches, expires after five minutes and invalidates for DB/area changes',async t=>{
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgresql://fixture-cache';
  let clock=1000000,connections=0,release;
  t.mock.method(Date,'now',()=>clock);
  const gate=new Promise(resolve=>{release=resolve;});
  const areas=[{district_name:'해운대구',dong_name:'우1동'},{district_name:'해운대구',dong_name:'우2동'}];
  t.mock.method(pg,'Client',function(){return {
    async connect(){connections++;await gate;},async end(){},
    async query(sql,args){
      if(sql!==historyContextSql)return {rows:[]};
      return {rows:[{
        history_rows:args[1].map(dong=>({district_name:'해운대구',administrative_dong_name:dong,records:50,
          valid_sample:10,average_operating_months:80,permit_records:300,closure_records:100})),
        monthly_rows:args[1].map(dong=>({district_name:'해운대구',administrative_dong_name:dong,month:'2023-05',openings:8,closures:2})),
      }]};
    },
  };});
  try {
    const first=loadAreaContexts(areas);
    const parallel=loadAreaContexts([...areas].reverse());
    assert.equal(connections,1);
    release();
    const [a,b]=await Promise.all([first,parallel]);
    assert.deepEqual(a.history,b.history);
    const cached=await loadAreaContexts(areas);
    assert.equal(connections,1);
    assert.equal(cached.historyQueryMs,0);
    assert.deepEqual(cached.history,a.history);
    clock+=5*60*1000;
    const refreshed=await loadAreaContexts(areas);
    assert.equal(connections,2);
    assert.deepEqual(refreshed.history,a.history);
    await loadAreaContexts(areas.slice(0,1));
    assert.equal(connections,3);
    process.env.DATABASE_URL='postgresql://fixture-other-db';
    await loadAreaContexts(areas.slice(0,1));
    assert.equal(connections,4);
  } finally {release();if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});

test('a failed history refresh is retried instead of caching the error',async t=>{
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgresql://fixture-retry-cache';
  t.mock.method(console,'error',()=>{});
  let connections=0;
  t.mock.method(pg,'Client',function(){return {
    async connect(){connections++;if(connections===1)throw Object.assign(new Error('connect'),{code:'ECONNRESET'});},
    async end(){},async query(sql){return {rows:sql===historyContextSql?[{history_rows:[],monthly_rows:[]}]:[]};},
  };});
  try {
    const areas=[{district_name:'해운대구',dong_name:'우2동'}];
    await assert.rejects(()=>loadAreaContexts(areas),error=>error.code==='ECONNRESET');
    await loadAreaContexts(areas);
    assert.equal(connections,2);
  } finally {if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});
