import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory=mkdtempSync(path.join(os.tmpdir(),'binsight-history-'));
const databasePath=path.join(directory,'cache.sqlite');
process.env.BINSIGHT_SQLITE_PATH=databasePath;
const store=await import('./history-store.js');

test('history snapshots persist selected fields and reject incomplete data',t=>{
  t.after(()=>{
    store.closeHistoryStore();
    rmSync(directory,{recursive:true,force:true});
  });
  const rows=[{bplcnm:'Shop',rdnwhladdr:'Busan district street 1',upjongnm:'Cafe',apvpermymd:'2026-01-02',dcbymd:null}];
  assert.equal(store.saveHistorySnapshot({rows,total:1,rawCount:1}),true);
  assert.equal(store.saveHistorySnapshot({rows,total:2,rawCount:1}),false);
  const loaded=store.loadHistorySnapshot(60000);
  assert.equal(loaded.total,1);
  assert.equal(loaded.rows.length,1);
  assert.equal(loaded.rows[0].upjongnm,'Cafe');
  assert.equal(loaded.rows[0].rdnwhladdr,'Busan district street 1');
});
