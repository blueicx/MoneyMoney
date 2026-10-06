const test=require('node:test');const assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('an event with a result on first observation is delivered, persisted and deduplicated after restart',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v))};let now=Date.parse('2026-10-02T13:40:00Z');const messages=[];
 const event={id:'jobs',title:'Non-Farm Employment Change',titleZh:'非农就业',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD',actual:'100K',forecast:'90K',previous:'80K',source:'fixture'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:null,status:'unsupported',reason:'no source'}),()=>now);await monitor.run('owner',[event],async text=>messages.push(text));assert.equal(messages.length,1);assert.match(messages[0],/100K/);
 await new TelegramEventResultMonitor(store,async()=>({actual:null,status:'unsupported',reason:'no source'}),()=>now).run('owner',[event],async text=>messages.push(text));assert.equal(messages.length,1);
});
test('a reminded event survives disappearing from the next calendar; result lookup and failed delivery retry',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v))};let now=Date.parse('2026-10-02T23:55:00Z'),attempts=0;
 const event={id:'overnight',title:'CPI m/m',date:'2026-10-03T00:00:00Z',impact:'high',country:'USD',actual:null,forecast:'0.2%',previous:null,source:'calendar'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:'0.3%',status:'published',source:'BLS',url:'https://www.bls.gov/news.release/cpi.nr0.htm',publishedAt:'2026-10-03T00:00:00Z'}),()=>now);
 await monitor.run('owner',[event],async()=>attempts++);assert.equal(attempts,0);now+=10*60000;await monitor.run('owner',[],async()=>{attempts++;throw Error('network down');});assert.equal(attempts,1);assert.equal(monitor.history('owner')[0].status,'pending');now+=2*60000;await monitor.run('owner',[],async()=>attempts++);assert.equal(attempts,2);assert.equal(monitor.history('owner')[0].status,'sent');
});
test('missing actual values produce an explicit follow-up, not an invented result; zero is a valid result',async()=>{
 const {TelegramEventResultMonitor,hasEventActual}=require('../src/features/telegram-event-results');assert.equal(hasEventActual('0'),true);assert.equal(hasEventActual('N/A'),false);
 const values=new Map(),store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v))},messages=[];const now=Date.parse('2026-10-02T14:00:00Z');const event={id:'unsupported',title:'GDP',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD',actual:null,forecast:null,source:'calendar'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:null,status:'unsupported',reason:'日历不提供实际值'}),()=>now);await monitor.run('owner',[event],async text=>messages.push(text));assert.match(messages[0],/日历不提供实际值/);assert.match(messages[0],/未编造/);await monitor.run('owner',[event],async text=>messages.push(text));assert.equal(messages.length,1);
});
test('official results require matching release date, country, exact series and units',()=>{
 const {parseBlsResult}=require('../src/features/telegram-event-results');const html='<pre>Transmission of material is embargoed until 8:30 a.m. (ET) Friday, October 2, 2026. Total nonfarm payroll employment increased by 100,000 in September. The unemployment rate was unchanged at 4.0 percent.</pre>';
 const event={title:'Non-Farm Employment Change',date:'2026-10-02T12:30:00Z',country:'USD'};assert.equal(parseBlsResult(html,event).actual,'100000');assert.equal(parseBlsResult(html,{...event,date:'2026-11-02T12:30:00Z'}).actual,null);assert.equal(parseBlsResult(html,{...event,country:'EUR'}).actual,null);
});
test('paused notifications retain pending results without exhausting retries; lease uses current time and TTL',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map();let now=Date.parse('2026-10-02T14:00:00Z'),leaseArgs;
 const store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v)),acquireLease:(...args)=>{leaseArgs=args;return true},releaseLease:()=>{}};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:'0',status:'published'}),()=>now);
 await monitor.run('owner',[{title:'test',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD'}],async()=>assert.fail('paused send'),false);
 assert.equal(leaseArgs[2],now);assert.equal(leaseArgs[3],120000);assert.equal(monitor.history('owner')[0].attempts,0);
 let sent=0;await monitor.run('owner',[],async()=>sent++);assert.equal(sent,1);
});
test('calendar result older than six hours is not replayed to a new subscriber',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v))};
 await new TelegramEventResultMonitor(store,async()=>({actual:'1',status:'published'}),()=>Date.parse('2026-10-02T14:00:00Z')).run('owner',[{title:'old',date:'2026-10-01T14:00:00Z',impact:'high',actual:'1'}],async()=>assert.fail('old release spam'));
});
test('result inbox acknowledgement is terminal and retry requeues only pending or failed deliveries',()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v))};const key='telegram-event-results:owner',now=Date.parse('2026-10-02T14:00:00Z');
 store.set(key,{events:{},deliveries:[{id:'pending',event:{title:'A',date:'2026-10-02T13:00:00Z'},text:'',status:'pending',attempts:2,nextAttempt:now+1000},{id:'sent',event:{title:'B',date:'2026-10-02T13:00:00Z'},text:'',status:'sent',attempts:1,nextAttempt:now},{id:'failed',event:{title:'C',date:'2026-10-02T13:00:00Z'},text:'',status:'failed',attempts:7,nextAttempt:now,error:'failed'}]});
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:null,status:'unavailable'}),()=>now);assert.equal(monitor.update('owner','pending','ack'),false);assert.equal(monitor.update('owner','sent','ack'),true);assert.equal(monitor.history('owner').find(x=>x.id==='sent').status,'acknowledged');assert.equal(monitor.update('owner','sent','retry'),false);assert.equal(monitor.update('owner','failed','retry'),true);const retried=monitor.history('owner').find(x=>x.id==='failed');assert.equal(retried.status,'pending');assert.equal(retried.attempts,0);assert.equal(retried.nextAttempt,now);assert.equal(retried.error,undefined);
});

test('official corrections are notified once and keep the original result and acknowledgement',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};let now=Date.parse('2026-10-02T14:00:00Z'),actual='100000';const messages=[];
 const event={title:'Non-Farm Employment Change',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD',previous:'80000',forecast:'90000'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual,status:'published',source:'BLS',publishedAt:event.date}),()=>now);
 await monitor.run('owner',[event],async text=>messages.push(text));const original=monitor.history('owner')[0];monitor.update('owner',original.id,'ack');
 actual='95000';now+=3600001;await monitor.run('owner',[],async text=>messages.push(text));await monitor.run('owner',[],async text=>messages.push(text));
 assert.equal(messages.length,2);assert.match(messages[1],/修订/);assert.match(messages[1],/100000/);assert.match(messages[1],/95000/);assert.match(messages[1],/80000/);assert.equal(monitor.history('owner')[0].status,'acknowledged');
});
test('malformed publication dates and unavailable results never become published actuals',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');for(const result of [{actual:'1',status:'published',publishedAt:'invalid'},{actual:'1',status:'unavailable'}]){
 const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))},messages=[];const monitor=new TelegramEventResultMonitor(store,async()=>result,()=>Date.parse('2026-10-02T14:00:00Z'));
 await monitor.run('owner',[{title:'GDP',date:'2026-10-02T13:30:00Z',impact:'high'}],async text=>messages.push(text));assert.match(messages[0],/暂不可用/);assert.doesNotMatch(messages[0],/实际值：1/);
 }
});
