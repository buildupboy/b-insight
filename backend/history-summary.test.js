import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {prepareHistorySummary} from './prepare-history-summary.js';
import {loadAreaContexts,historyContextSql,historySummaryAvailabilitySql,historySummaryReadSql,historySummaryBuildSql} from './recommendation-context-db.js';

const snapshot={history_rows:[{district_name:'해운대구',administrative_dong_name:'우2동',records:2,duplicate_records:1,
  valid_sample:5,average_operating_months:80,permit_records:20,closure_records:10}],
  monthly_rows:[{district_name:'해운대구',administrative_dong_name:'우2동',month:'2023-05',openings:8,closures:2}]};

test('a fresh process reads prepared history without scanning or aggregating source rows',async t=>{
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgresql://prepared-fixture';
  const commands=[];
  t.mock.method(pg,'Client',function(){return {async connect(){},async end(){},async query(sql){
    commands.push(sql);
    if(sql===historySummaryAvailabilitySql)return {rows:[{available:true}]};
    if(sql===historySummaryReadSql)return {rows:[structuredClone(snapshot)]};
    if(sql===historyContextSql)assert.fail('First search must not aggregate raw history');
    return {rows:[]};
  }};});
  try {
    const result=await loadAreaContexts([{district_name:'해운대구',dong_name:'우2동'}]);
    const history=[...result.history.values()][0];
    assert.equal(history.stability,80);
    assert.equal(history.growth,.6);
    assert.equal(history.permitRecords,20);
    assert.equal(history.closureRecords,10);
    assert(commands.includes(historySummaryReadSql));
    assert.equal(commands.at(-1),'ROLLBACK');
  } finally {if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});

test('history preparation validates source coverage and commits an atomic snapshot',async()=>{
  const commands=[];
  const client={async query(sql,args){
    commands.push({sql,args});
    if(sql===historySummaryBuildSql)return {rows:[structuredClone(snapshot)]};
    if(sql.startsWith('SELECT count(*)'))return {rows:[{count:'3'}]};
    return {rows:[]};
  }};
  assert(!/\$[123]/.test(historySummaryBuildSql));
  const result=await prepareHistorySummary(client);
  assert.deepEqual(result,{prepared:true,sourceRows:3,areas:1,months:1});
  const write=commands.find(c=>c.sql.startsWith('INSERT INTO'));
  assert.deepEqual(JSON.parse(write.args[0]),snapshot.history_rows);
  assert.deepEqual(JSON.parse(write.args[1]),snapshot.monthly_rows);
  assert.equal(write.args[2],3);
  assert.equal(commands.at(-1).sql,'COMMIT');
  assert(commands.some(c=>c.sql==='REVOKE ALL ON SCHEMA binsight_private FROM PUBLIC'));
});

test('incomplete preparation rolls back and never overwrites an existing summary',async()=>{
  const commands=[];
  const client={async query(sql){
    commands.push(sql);
    if(sql===historySummaryBuildSql)return {rows:[structuredClone(snapshot)]};
    if(sql.startsWith('SELECT count(*)'))return {rows:[{count:'4'}]};
    return {rows:[]};
  }};
  await assert.rejects(()=>prepareHistorySummary(client),error=>error.code==='HISTORY_COUNT_MISMATCH');
  assert.equal(commands.at(-1),'ROLLBACK');
  assert(!commands.some(sql=>sql.startsWith('INSERT INTO')));
});
