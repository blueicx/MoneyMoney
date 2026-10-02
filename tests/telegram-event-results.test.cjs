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
