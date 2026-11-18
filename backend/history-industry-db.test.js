import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {historyAggregateSql,historyMonthlySql,historyContextSql,industryHistoryFromAggregate} from './recommendation-context-db.js';

test('PostgreSQL exact taxonomy, deduplication, invalid dates and monthly totals', {skip:!process.env.BINSIGHT_TEST_DATABASE_URL}, async()=>{
  const client=new pg.Client({connectionString:process.env.BINSIGHT_TEST_DATABASE_URL,connectionTimeoutMillis:5000});
  try {
    await client.connect();
    await client.query(`CREATE TEMP TABLE commercial_history_by_dong (
      district_name text,administrative_dong_name text,bplcnm text,rdnwhladdr text,
      majornm text,minornm text,upjongnm text,trdstatenm text,apvpermymd text,dcbymd text)`);
    const target={district_name:'해운대구',dong_name:'우2동'};
    const categories=[{majornm:'서비스',minornm:'미용실',upjongnm:'미용실'}];
    const records=[];
    for(let i=0;i<10;i++) records.push(['해운대구','우2동',`점포${i}`,'주소','서비스',' 미용실 ','미용실','폐업',`2020-01-${String(i+1).padStart(2,'0')}`,'2023-05-15']);
    records.push(records[0]);
    records.push(['해운대구','우2동','다른업종','주소','서비스','네일숍','기타 미용업','폐업','2023-01-01','2023-05-15']);
    records.push(['해운대구','우2동','잘못된날짜','주소','서비스','미용실','미용실','폐업','2023-02-30','2023-04-31']);
    records.push(['해운대구','우2동','영업중폐업일','주소','서비스','미용실','미용실','영업/정상','2023-03-01','2023-05-20']);
    for(const values of records) await client.query(`INSERT INTO commercial_history_by_dong VALUES (${values.map((_,i)=>`$${i+1}`).join(',')})`,values);
    const args=[['해운대구'],['우2동'],JSON.stringify(categories)];
    const query=sql=>client.query(sql.replaceAll('public.commercial_history_by_dong','pg_temp.commercial_history_by_dong'),args);
    const summary=(await query(historyAggregateSql)).rows;
    const monthly=(await query(historyMonthlySql)).rows;
    const combined=(await query(historyContextSql)).rows[0];
    assert.deepEqual(combined.history_rows,summary);
    assert.deepEqual(combined.monthly_rows,monthly);
    assert.equal(summary[0].records,12);
    assert.equal(summary[0].duplicate_records,1);
    assert.equal(summary[0].valid_sample,10);
    assert.equal(summary[0].permit_records,11);
    assert.equal(summary[0].closure_records,10);
    assert.equal(summary[0].invalid_permit,1);
    assert.equal(summary[0].invalid_closure,1);
    assert.equal(monthly.reduce((sum,r)=>sum+r.openings,0),11);
    assert.equal(monthly.reduce((sum,r)=>sum+r.closures,0),10);
    const history=[...industryHistoryFromAggregate(summary,monthly,[target],{codes:['S20701'],categories}).values()][0];
    assert.equal(history.permitRecords,11);
    assert.equal(history.closureRecords,10);
    assert.equal(history.growth,-9/11);
    assert.equal(history.eventTrend.length,12);
    assert.equal(history.eventTrend.reduce((sum,r)=>sum+r.openings,0),history.periodOpenings);
    assert.equal(history.eventTrend.reduce((sum,r)=>sum+r.closures,0),history.periodClosures);
  } finally { await client.end().catch(()=>{}); }
});
