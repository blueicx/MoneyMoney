const test = require('node:test');
const assert = require('node:assert/strict');
const { StockSignalSchedule, stockExchangeSession } = require('../dist/features/stock-signal-schedule');
const { paginateTelegramStockSignals } = require('../dist/features/telegram-stock-signals');
function store() { const data=new Map(),leases=new Map();return {get:key=>structuredClone(data.get(key) || null),set:(key,value)=>data.set(key,structuredClone(value)),acquireLease:(key,owner)=>{if(leases.has(key))return false;leases.set(key,owner);return true},refreshLease:(key,owner)=>leases.get(key)===owner,releaseLease:(key,owner)=>{if(leases.get(key)===owner)leases.delete(key)}}; }

test('exchange schedule handles DST, weekends and explicit official closures', () => {
  assert.equal(stockExchangeSession('us',Date.parse('2026-10-06T13:30:00Z')).open,true);
  assert.equal(stockExchangeSession('us',Date.parse('2026-12-07T13:30:00Z')).open,false);
  assert.equal(stockExchangeSession('us',Date.parse('2026-12-07T14:30:00Z')).open,true);
  assert.equal(stockExchangeSession('us',Date.parse('2026-10-10T14:00:00Z')).open,false);
  assert.equal(stockExchangeSession('us',Date.parse('2026-10-06T14:00:00Z'),['2026-10-06']).open,false);
});
test('scheduled scans are opt-in, respect pause/scope/interval and only one lease holder runs',async()=>{
  const state=store(),scheduler=new StockSignalSchedule(state);const now=Date.parse('2026-10-06T14:00:00Z');let calls=0;
  assert.equal((await scheduler.run('a',{market:'stocks',paused:false,now},async()=>calls++)).status,'disabled');
  scheduler.configure('a',{enabled:true,intervalMinutes:30});
  assert.equal((await scheduler.run('a',{market:'crypto',paused:false,now},async()=>calls++)).status,'wrong-market');
  assert.equal((await scheduler.run('a',{market:'stocks',paused:true,now},async()=>calls++)).status,'paused');
  let release;const gate=new Promise(resolve=>release=resolve);
  const first=scheduler.run('a',{market:'stocks',paused:false,now},async()=>{calls++;await gate;});
  assert.equal((await new StockSignalSchedule(state).run('a',{market:'stocks',paused:false,now},async()=>calls++)).status,'busy');
  release();assert.equal((await first).status,'completed');assert.equal(calls,1);
  assert.equal((await scheduler.run('a',{market:'stocks',paused:false,now:now+60000},async()=>calls++)).status,'cooldown');
  scheduler.configure('a',{enabled:false});assert.equal(scheduler.history('a').length,1);
});
test('pool/direction/status filters paginate actual rows without changing signal identity',()=>{
  const rows=[['AAPL',['fixed'],'BUY','ready'],['SNDK',['watchlist'],'BUY','ready'],['MU',['mover'],'SELL','ready'],['MISS',['watchlist'],null,'unavailable']].map(([symbol,sources,action,status])=>({candidate:{symbol,sources,instrumentId:'stock:us:'+symbol},status,action:action?{action}:null}));
  const snapshot={candidates:rows};
  const page=paginateTelegramStockSignals(snapshot,1,8,{pool:'watchlist',direction:'BUY',status:'ready'});
  assert.equal(page.totalCount,1);assert.equal(page.items[0].candidate.symbol,'SNDK');assert.equal(page.indices[0],2);
  assert.equal(rows.length,4);assert.throws(()=>paginateTelegramStockSignals(snapshot,1,8,{pool:'crypto'}));
});
test('a disabled configuration changed while acquiring a lease cannot start a late scan',async()=>{
 const state=store(),scheduler=new StockSignalSchedule(state);scheduler.configure('a',{enabled:true});const acquire=state.acquireLease;state.acquireLease=(...args)=>{scheduler.configure('a',{enabled:false});return acquire(...args)};
 assert.equal((await scheduler.run('a',{market:'stocks',paused:false,now:Date.parse('2026-10-06T14:00:00Z')},async()=>assert.fail('late scan'))).status,'disabled');
});
test('manual and scheduled scanner instances share a lease and cannot replace an active scan',async()=>{
 const {TelegramStockSignalScanner}=require('../dist/features/telegram-stock-signals');const state=store(),a=new TelegramStockSignalScanner({store:state}),b=new TelegramStockSignalScanner({store:state});let finish,calls=0;const gate=new Promise(resolve=>finish=resolve);
 const universe={candidates:[{symbol:'AAPL',market:'us',instrumentId:'stock:us:AAPL',sources:['fixed']}],moverStatus:{state:'empty',source:'fixture',updatedAt:null}};
 const input={initialUniverse:universe,loadUniverse:async()=>universe,analyze:async candidate=>{calls++;await gate;return{candidate,status:'ready',dataStatus:'delayed',action:{action:'WAIT'},source:'fixture',updatedAt:new Date().toISOString()}}};
 const first=a.start('owner',input);const second=b.start('owner',input);assert.equal(second.snapshot.id,first.snapshot.id);finish();await Promise.all([first.completion,second.completion]);assert.equal(calls,1);
});
test('automatic quote timestamps roundtrip exchange time across DST without using host timezone',()=>{
 const {stockQuoteObservationTime}=require('../dist/features/stock-signal-schedule');
 assert.equal(stockQuoteObservationTime('10/06/2026 10:00 AM ET'),Date.parse('2026-10-06T14:00:00Z'));
 assert.equal(stockQuoteObservationTime('12/07/2026 10:00 AM'),Date.parse('2026-12-07T15:00:00Z'));
 assert.equal(stockQuoteObservationTime('2026-10-06T14:00:00Z'),Date.parse('2026-10-06T14:00:00Z'));
 assert.equal(stockQuoteObservationTime('02/30/2026 10:00 AM'),null);assert.equal(stockQuoteObservationTime('now'),null);
});
test('a lost scanner lease waits for all in-flight providers and never overwrites a replacement',async()=>{
 const {TelegramStockSignalScanner}=require('../dist/features/telegram-stock-signals');const state=store();let valid=true,released=false;
 const refresh=state.refreshLease;state.refreshLease=(...args)=>valid&&refresh(...args);const release=state.releaseLease;state.releaseLease=(...args)=>{released=true;return release(...args)};
 const scanner=new TelegramStockSignalScanner({store:state,concurrency:2});let finishSlow,finishFast;
 const fast=new Promise(resolve=>finishFast=resolve),slow=new Promise(resolve=>finishSlow=resolve);
 const candidates=['AAPL','MSFT'].map(symbol=>({symbol,market:'us',instrumentId:'stock:us:'+symbol,sources:['fixed']})),universe={candidates,moverStatus:{state:'empty',source:'test',updatedAt:null}};
 const job=scanner.start('owner',{initialUniverse:universe,loadUniverse:async()=>universe,analyze:async candidate=>{await(candidate.symbol==='AAPL'?fast:slow);return{candidate,status:'ready',action:{action:'WAIT'},dataStatus:'delayed',source:'test',updatedAt:new Date().toISOString()}}});
 await new Promise(resolve=>setImmediate(resolve));const saved=state.get(scanner.storageKey('owner'));valid=false;finishFast();await new Promise(resolve=>setImmediate(resolve));assert.equal(released,false,'other providers are still in flight');
 const failed=assert.rejects(job.completion,/租约/);finishSlow();await failed;assert.equal(released,true);assert.deepEqual(state.get(scanner.storageKey('owner')),saved);
});
test('long external fields fit a Telegram page without splitting an HTML entity',()=>{
 const {formatTelegramStockSignalPage}=require('../dist/features/telegram-stock-signals');
 const candidates=Array.from({length:8},(_,i)=>({candidate:{symbol:'AAPL'+i,name:'<&>'.repeat(1000),sources:['watchlist']},status:'unavailable',dataStatus:'unavailable',source:'<&>'.repeat(1000),reason:'<&>'.repeat(1000),updatedAt:null}));
 const snapshot={candidates,scanned:8,status:'complete',moverStatus:{state:'unavailable',source:'<&>'.repeat(1000),updatedAt:null,reason:'<&>'.repeat(1000)},reason:'<&>'.repeat(1000)};
 const text=formatTelegramStockSignalPage(paginateTelegramStockSignals(snapshot,1,8));assert.ok(text.length<=4000);assert.doesNotMatch(text,/<&>/);
});
test('automatic delivery cannot revive a manual scan whose observed quote is stale',()=>{
 const {isStockSignalNotificationFresh}=require('../dist/features/stock-signal-schedule');const now=Date.parse('2026-10-06T14:00:00Z');
 assert.equal(isStockSignalNotificationFresh({updatedAt:'10/06/2026 09:45 AM ET',dataStatus:'delayed'},now),true);
 assert.equal(isStockSignalNotificationFresh({updatedAt:'10/05/2026 04:00 PM ET',dataStatus:'live'},now),false);
 assert.equal(isStockSignalNotificationFresh({updatedAt:new Date(now).toISOString(),dataStatus:'stale'},now),false);
 assert.equal(isStockSignalNotificationFresh({updatedAt:null,dataStatus:'live'},now),false);
});
