const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { SQLiteStateStore }=require('../dist/storage/sqlite-state');
const { MarketHistoryCaptureScheduler }=require('../dist/features/market-history-scheduler');
function fixture(t,batch=3){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-history-scheduler-'));const db=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});return {db,scheduler:new MarketHistoryCaptureScheduler(db,batch)};}
const now=Date.parse('2026-10-01T00:00:00Z');
test('scheduler accepts only canonical supported market identities and honors per-market cadence',async t=>{
 const {db,scheduler}=fixture(t,10), ids=['crypto:binance:BTCUSDT','crypto:unknown:BTCUSDT','crypto:binance:XYZUSDT','stock:us:AAPL','prediction:kalshi:event-1','option:unknown:AAPL','option:deribit:XYZ','option:cboe:AAPL'];
 let calls=[];let first=await scheduler.runOnce(ids,async row=>{calls.push(row.instrument);return {status:'cached'};},now);
 assert.equal(first.attempted,3);assert.deepEqual(new Set(calls),new Set([ids[0],ids[4],ids[7]]));
 calls=[];let sameWindow=await new MarketHistoryCaptureScheduler(db,10).runOnce(ids,async row=>{calls.push(row.instrument);return {status:'cached'};},now+30*60_000);
 assert.equal(sameWindow.attempted,0);assert.deepEqual(calls,[]);
 const nextDay=await scheduler.runOnce(ids,async row=>({status:'cached'}),now+25*60*60_000);assert.equal(nextDay.attempted,3);
});
test('failed capture is persisted with reason and does not monopolize round robin',async t=>{
 const {scheduler}=fixture(t,1),ids=['crypto:binance:BTCUSDT','prediction:kalshi:event-1'];
 const failed=await scheduler.runOnce(ids,async()=>{throw new Error('provider timeout');},now);assert.equal(failed.results[0].reason,'provider timeout');
 const again=await scheduler.runOnce(ids,async()=>({status:'cached'}),now+61*60_000);assert.equal(again.results[0].instrument,'prediction:kalshi:event-1');
 assert.equal(scheduler.state().lastAttempt['crypto:binance:BTCUSDT'].reason,'provider timeout');
});
test('a second process cannot run the same history collection lease',async t=>{
 const {db,scheduler}=fixture(t);const other=new MarketHistoryCaptureScheduler(db);let release;const pending=scheduler.runOnce(['crypto:binance:BTCUSDT'],()=>new Promise(resolve=>{release=()=>resolve({status:'cached'});}),now);
 await new Promise(resolve=>setImmediate(resolve));assert.equal((await other.runOnce(['crypto:binance:BTCUSDT'],async()=>({status:'cached'}),now)).acquired,false);release();await pending;
});
