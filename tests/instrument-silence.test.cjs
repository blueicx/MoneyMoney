const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-silence-'));process.env.MONEYMONEY_DATA_DIR=root;
test.after(()=>{require('../dist/storage/sqlite-state').stateStore.close();fs.rmSync(root,{recursive:true,force:true});});
test('instrument silences share persisted state, expire, isolate exact identity and never suppress high priority',()=>{
 const {InstrumentSilenceStore}=require('../dist/features/instrument-silence'),{stateStore}=require('../dist/storage/sqlite-state');let now=Date.now();const first=new InstrumentSilenceStore(stateStore,()=>now),second=new InstrumentSilenceStore(stateStore,()=>now);
 first.update('stocks','stock:us:AAPL',new Date(now+60000).toISOString(),'web');assert.equal(second.suppresses('stock:us:AAPL'),true);assert.equal(second.suppresses('stock:us:AAPL','high'),false);assert.equal(second.suppresses('stock:us:MSFT'),false);assert.equal(second.suppresses('crypto:binance:AAPLUSDT'),false);
 assert.throws(()=>first.update('stocks','crypto:binance:BTCUSDT',new Date(now+60000).toISOString(),'web'));assert.throws(()=>first.update('stocks','AAPL',new Date(now+60000).toISOString(),'web'));assert.throws(()=>first.update('stocks','stock:us:AAPL','invalid','web'));
 now+=60001;assert.equal(second.suppresses('stock:us:AAPL'),false);first.update('stocks','stock:us:AAPL',new Date(now+60000).toISOString(),'telegram');second.update('stocks','stock:us:AAPL',null,'web');assert.equal(first.suppresses('stock:us:AAPL'),false);assert.equal(first.list('stocks').history.length,3);
});
test('shared quiet gate blocks web and Telegram trigger history without consuming cooldown or another instrument',()=>{
 const {UnifiedAlertStore,triggerUnifiedAlerts}=require('../dist/features/unified-alerts');const store=new UnifiedAlertStore({keyPrefix:'test-silence'});for(const symbol of ['AAPL','MSFT'])store.createRule({instrumentId:'stock:us:'+symbol,kind:'price',condition:{direction:'above',value:100}});
 const observations=['AAPL','MSFT'].map(symbol=>({instrumentId:'stock:us:'+symbol,observation:{kind:'price',value:101}}));const entries=triggerUnifiedAlerts(store,observations,new Date(),(_,instrument)=>instrument==='stock:us:AAPL');assert.equal(entries.length,1);assert.equal(entries[0].instrumentId,'stock:us:MSFT');assert.equal(store.listRules().find(row=>row.instrumentId==='stock:us:AAPL').lastTriggeredAt,undefined);
});
test('expired quiet policies cannot permanently exhaust active-policy capacity',()=>{
 const {InstrumentSilenceStore}=require('../dist/features/instrument-silence'),{stateStore}=require('../dist/storage/sqlite-state'),now=Date.now();const entries=Object.fromEntries(Array.from({length:500},(_,i)=>['stock:us:S'+i,{market:'stocks',instrument:'stock:us:S'+i,until:new Date(now-1).toISOString()}]));stateStore.set('notification-instrument-silence:admin',{entries,history:[]});const store=new InstrumentSilenceStore(stateStore,()=>now);assert.doesNotThrow(()=>store.update('stocks','stock:us:AAPL',new Date(now+60000).toISOString(),'web'));
});
test('a scope alert skips a muted candidate and still finds another matching instrument',()=>{
 const {UnifiedAlertStore,triggerUnifiedAlerts}=require('../dist/features/unified-alerts');const store=new UnifiedAlertStore({keyPrefix:'test-silence-scope'});store.createRule({scope:'stocks',kind:'price',condition:{direction:'above',value:100}});const rows=['AAPL','MSFT'].map(symbol=>({instrumentId:'stock:us:'+symbol,observation:{kind:'price',scope:'stocks',value:101}}));const created=triggerUnifiedAlerts(store,rows,new Date(),(_,id)=>id==='stock:us:AAPL');assert.equal(created.length,1);assert.equal(created[0].instrumentId,'stock:us:MSFT');
});
