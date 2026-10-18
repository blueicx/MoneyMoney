const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {TelegramEventResultMonitor,summarizeTelegramResultCoverage}=require('../src/features/telegram-event-results');
const event={title:'CPI m/m',country:'USD',impact:'high',date:'2026-10-01T10:00:00Z'};
const memory=()=>{const data=new Map();return {get:k=>structuredClone(data.get(k)||null),set:(k,v)=>data.set(k,structuredClone(v))};};
test('published result supersedes only the same-chat same-event waiting record and exposes observed latency',()=>{
 const now=Date.parse('2026-10-02T12:00:00Z'),waiting={id:'wait',chatId:'a',event,status:'sent',kind:'waiting',resultStatus:'pending',nextCheckAt:now-3*3600000};
 const result={id:'result',chatId:'a',event,status:'sent',kind:'result',resultStatus:'published',actual:'0',publishedAt:'2026-10-01T10:02:00Z',retrievedAt:'2026-10-01T10:05:00Z',sentAt:'2026-10-01T10:06:00Z'};
 const out=summarizeTelegramResultCoverage([waiting,result,{...waiting,chatId:'b'}],now);
 assert.equal(out.waiting,1);assert.equal(out.supersededWaiting,1);assert.equal(out.stuckCountdowns.length,1);assert.equal(out.stuckCountdowns[0].chatId,'b');
 assert.equal(out.slo.publicationToRetrievalMs.p95,180000);assert.equal(out.slo.retrievalToDeliveryMs.p95,60000);assert.equal(out.slo.sampleCount,1);
});
test('queued stale waiting message is not delivered once actual arrives, and A-B-A revisions are each delivered exactly once',async()=>{
 const store=memory();let now=Date.parse('2026-10-01T10:30:00Z'),actual=null;const sent=[];
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual,status:actual===null?'pending':'published',publishedAt:event.date,retrievedAt:new Date(now).toISOString(),source:'BLS'}),()=>now);
 monitor.registerReminder('owner',event,10);await monitor.run('owner',[],async()=>assert.fail('delivery disabled'),false);
 actual='A';now+=300001;await monitor.run('owner',[],async(text,reply)=>{sent.push({text,reply});return 20;});assert.equal(sent.length,1);assert.match(sent[0].text,/实际值：A/);
 actual='B';now+=3600001;await monitor.run('owner',[],async(text,reply)=>{sent.push({text,reply});return 21;});
 actual='A';now+=3600001;await monitor.run('owner',[],async(text,reply)=>{sent.push({text,reply});return 22;});
 now+=3600001;await monitor.run('owner',[],async()=>assert.fail('same result repeated'));
 assert.equal(sent.length,3);assert.match(sent[2].text,/此前通知值：B/);assert.ok(sent.every(row=>row.reply===10));
 const results=monitor.history('owner').filter(row=>row.kind==='result'||row.kind==='revision');assert.equal(results.length,3);assert.ok(results.every(row=>row.sentAt));
});
test('legacy sent waiting detail never pretends publication and invalid timestamps cannot create SLO samples',()=>{
 const store=memory();store.set('telegram-event-results:owner',{events:{},deliveries:[{id:'legacy',event,text:'waiting',kind:'waiting',status:'sent',attempts:1,nextAttempt:0}]});
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:null,status:'pending'}));assert.notEqual(monitor.detail('owner','legacy').resultStatus,'published');
 const out=summarizeTelegramResultCoverage([{id:'x',event,status:'sent',actual:'0',resultStatus:'published',publishedAt:'bad',retrievedAt:'2026-10-01T10:00:00Z',sentAt:'2026-09-01T00:00:00Z'}],Date.parse('2026-10-02T00:00:00Z'));
 assert.equal(out.slo.sampleCount,0);assert.equal(out.slo.publicationToRetrievalMs.p95,null);
});
test('failed or pending delivery with an obsolete sent timestamp is not a successful delivery latency sample',()=>{
 const row={id:'x',event,status:'failed',actual:'0',resultStatus:'published',publishedAt:event.date,retrievedAt:'2026-10-01T10:02:00Z',sentAt:'2026-10-01T10:03:00Z'};
 const out=summarizeTelegramResultCoverage([row,{...row,id:'p',status:'pending'},{...row,id:'ack',status:'acknowledged'}],Date.parse('2026-10-02T00:00:00Z'));assert.equal(out.slo.sampleCount,1);assert.equal(out.failedDeliveries,1);
});
