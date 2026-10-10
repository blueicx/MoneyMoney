const test=require('node:test');const assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('an administrator retry during source lookup survives persistence and dispatches once',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results'),values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};
 let now=Date.parse('2026-10-02T14:00:00Z'),retry=false,sends=0,monitor;
 const event={title:'CPI m/m',country:'USD',impact:'high',date:'2026-10-02T13:30:00Z'};
 monitor=new TelegramEventResultMonitor(store,async()=>{if(retry){assert.equal(monitor.update('owner',monitor.history('owner')[0].id,'retry'),true);}return{actual:'0.3%',status:'published'};},()=>now);
 monitor.registerReminder('owner',event,123);
 for(let attempt=0;attempt<7;attempt++){await monitor.run('owner',[],async()=>{throw Error('offline');});now+=3600001;}
 assert.equal(monitor.history('owner')[0].status,'failed');retry=true;
 await monitor.run('owner',[],async()=>{sends++;return 124;});
 assert.equal(sends,1);assert.equal(monitor.history('owner')[0].status,'sent');
 assert.equal(monitor.history('owner')[0].attempts,1);
});
test('a reminder registered during its own result lookup is used by the pending reply',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results'),values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};
 const event={title:'CPI m/m',country:'USD',impact:'high',date:'2026-10-02T13:30:00Z'},sent=[];let monitor;
 monitor=new TelegramEventResultMonitor(store,async()=>{monitor.registerReminder('owner',event,321);return{actual:'0.3%',status:'published',source:'BLS',publishedAt:event.date};},()=>Date.parse('2026-10-02T14:00:00Z'));
 await monitor.run('owner',[event],async(text,reply)=>{sent.push(reply);return 322;});
 assert.deepEqual(sent,[321]);assert.equal(monitor.history('owner')[0].originalMessageId,321);
});
test('losing the monitor lease before dispatch never sends a result under an obsolete owner',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results'),values=new Map();let checks=0,sends=0;
 const store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v)),acquireLease:()=>true,refreshLease:()=>++checks===1,releaseLease:()=>{}};
 const event={title:'CPI m/m',country:'USD',impact:'high',date:'2026-10-02T13:30:00Z'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:'0.3%',status:'published'}),()=>Date.parse('2026-10-02T14:00:00Z'));
 await assert.rejects(monitor.run('owner',[event],async()=>{sends++;return 20;}),/租约/);assert.equal(sends,0);
 assert.equal(monitor.history('owner')[0].status,'pending');
});
test('typed results retain distinct identities, official evidence and stopped terminal states',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results'),values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))},now=Date.parse('2026-10-08T01:00:00Z'),sent=[];
 const monitor=new TelegramEventResultMonitor(store,async event=>event.kind==='research'?{actual:null,status:'stopped',reason:'task cancelled'}:{actual:'0%',status:'published',url:'https://api.gateio.ws/api/v4/futures/usdt/funding_rate',evidenceRefs:['snapshot-hash']},()=>now);
 const base={title:'result',date:'2026-10-08T00:00:00Z'};
 monitor.registerReminder('owner',{...base,kind:'funding',market:'crypto',instrument:'crypto:gateio:BTC_USDT'},11);
 monitor.registerReminder('owner',{...base,kind:'research',market:'stocks',resourceId:'job1'},22);
 await monitor.run('owner',[],async(text,id)=>{sent.push({text,id});return 44;});
 assert.equal(sent.length,2);assert.match(sent.find(row=>row.id===11).text,/官方原文/);assert.doesNotMatch(sent.find(row=>row.id===11).text,/预期值|前值/);assert.doesNotMatch(sent.find(row=>row.id===22).text,/继续通知/);assert.equal(monitor.history('owner').find(row=>row.originalMessageId===22).nextCheckAt,null);assert.ok(monitor.history('owner').find(row=>row.originalMessageId===11).evidenceRefs.includes('snapshot-hash'));
});
test('results and corrections reply to the original reminder and retain message lineage after restart',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};let now=Date.parse('2026-10-02T13:20:00Z'),actual='100000';const sent=[];
 const event={title:'Non-Farm Employment Change',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD'};
 let monitor=new TelegramEventResultMonitor(store,async()=>({actual,status:'published',source:'BLS',publishedAt:event.date}),()=>now);
 monitor.registerReminder('owner',event,77);now+=20*60000;
 monitor=new TelegramEventResultMonitor(store,async()=>({actual,status:'published',source:'BLS',publishedAt:event.date}),()=>now);
 await monitor.run('owner',[],async(text,reply)=>{sent.push({text,reply});return 88;});assert.equal(sent[0].reply,77);assert.equal(monitor.history('owner')[0].messageId,88);assert.equal(monitor.history('owner')[0].originalMessageId,77);
 actual='95000';now+=3600001;await monitor.run('owner',[],async(text,reply)=>{sent.push({text,reply});return 89;});assert.equal(sent[1].reply,77);assert.equal(monitor.history('owner')[1].resultStatus,'revised');
});
test('unverified tracking expires with an explicit terminal notice, not a silent deletion',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};let now=Date.parse('2026-10-02T13:20:00Z');const event={title:'GDP',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD'};
 const messages=[],monitor=new TelegramEventResultMonitor(store,async()=>({actual:null,status:'unsupported',reason:'没有结果来源'}),()=>now);
 monitor.registerReminder('owner',event,77);now+=73*3600000;await monitor.run('owner',[],async(text,reply)=>{messages.push({text,reply});return 90;});
 assert.equal(messages.length,1);assert.match(messages[0].text,/无法核验.*结束|结束.*无法核验/);assert.equal(messages[0].reply,77);assert.equal(monitor.history('owner')[0].resultStatus,'unverifiable');
 await monitor.run('owner',[],async()=>assert.fail('terminal notice repeated'));
});
test('registering another reminder during an in-flight lookup is not overwritten by monitor persistence',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};const now=Date.parse('2026-10-02T14:00:00Z');
 const first={title:'first',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD'},second={title:'second',date:'2026-10-02T13:31:00Z',impact:'high',country:'USD'};let monitor;
 monitor=new TelegramEventResultMonitor(store,async event=>{if(event.title==='first')monitor.registerReminder('owner',second,55);return{actual:'1',status:'published'};},()=>now);
 monitor.registerReminder('owner',first,44);await monitor.run('owner',[],async()=>66);await monitor.run('owner',[],async()=>77);
 assert.equal(monitor.history('owner').find(row=>row.event.title==='second').originalMessageId,55);
});
test('macro calendar actuals from untrusted sources are never published as verified results',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v))};let now=Date.parse('2026-10-02T13:40:00Z');const messages=[];
 const event={id:'jobs',title:'GDP q/q',titleZh:'GDP',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD',actual:'100K',forecast:'90K',previous:'80K',source:'untrusted fixture',retrievedAt:'2026-10-02T13:45:00Z'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:null,status:'unsupported',reason:'no official source'}),()=>now);await monitor.run('owner',[event],async text=>messages.push(text));assert.equal(messages.length,0);
 now+=6*60_000;await monitor.run('owner',[],async text=>messages.push(text));assert.equal(messages.length,1);assert.doesNotMatch(messages[0],/实际值：100K/);assert.match(messages[0],/no official source/);
});
test('ForexFactory macro actuals require an exact source and post-event retrieval time, and disclose that timestamp',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');const values=new Map(),store={get:k=>values.get(k)||null,set:(k,v)=>values.set(k,structuredClone(v))};let now=Date.parse('2026-10-02T13:50:00Z');const messages=[];
 const event={id:'jobs',title:'Non-Farm Employment Change',titleZh:'非农就业',date:'2026-10-02T13:30:00Z',impact:'high',country:'USD',actual:'100K',forecast:'90K',previous:'80K',source:'ForexFactory Public JSON',retrievedAt:'2026-10-02T13:45:00Z'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:null,status:'unsupported',reason:'官方结果来源暂未覆盖此指标'}),()=>now);await monitor.run('owner',[event],async text=>messages.push(text));assert.equal(messages.length,1);assert.match(messages[0],/实际值：100K/);assert.match(messages[0],/ForexFactory Public JSON/);assert.match(messages[0],/抓取时间：2026-10-02T13:45:00.000Z/);
 const invalidValues=new Map(),invalidStore={get:k=>invalidValues.get(k)||null,set:(k,v)=>invalidValues.set(k,structuredClone(v))},invalidMessages=[];
 const staleMonitor=new TelegramEventResultMonitor(invalidStore,async()=>({actual:null,status:'unsupported',reason:'unsupported'}),()=>now);await staleMonitor.run('owner',[{...event,retrievedAt:'2026-10-02T13:20:00Z'}],async text=>invalidMessages.push(text));assert.equal(invalidMessages.length,1);assert.doesNotMatch(invalidMessages[0],/实际值：100K/,'pre-release calendar snapshots cannot supply an actual');
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
test('BEA GDP actuals require the scheduled release date, exact quarter and estimate stage',()=>{
 const {parseBeaGdpResult}=require('../src/features/telegram-event-results');
 const event={title:'GDP q/q',date:'2026-07-30T12:30:00.000Z',country:'USD'};
 const schedule='<tr class="scheduled-releases-type-press"><td class="scheduled-date"><div class="release-date">July 30</div><small>8:30 AM</small></td><td class="release-title">GDP (Advance Estimate), 2nd Quarter 2026</td><td class="views-field-field-scheduled-release-url"><a href="/news/2026/gdp-advance-estimate-2nd-quarter-2026">View</a></td></tr>';
 const release='<h1>GDP (Advance Estimate), 2nd Quarter 2026</h1><p>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Thursday, July 30, 2026</p><p>Real gross domestic product (GDP) increased at an annual rate of 1.5 percent in the second quarter of 2026 (April, May, and June), according to the advance estimate released today by the U.S. Bureau of Economic Analysis (BEA).</p>';
 const result=parseBeaGdpResult(schedule,release,event,'2026-07-30T12:35:00.000Z');
 assert.equal(result.status,'published');assert.equal(result.actual,'Real GDP 1.5% annualized (Advance Estimate)');assert.equal(result.source,'U.S. Bureau of Economic Analysis (BEA)');assert.equal(result.url,'https://www.bea.gov/news/2026/gdp-advance-estimate-2nd-quarter-2026');assert.equal(result.publishedAt,event.date);assert.equal(result.retrievedAt,'2026-07-30T12:35:00.000Z');
 assert.notEqual(parseBeaGdpResult(schedule,release,{...event,date:'2026-07-31T12:30:00.000Z'}).status,'published','a neighboring date cannot borrow the release');
 assert.notEqual(parseBeaGdpResult(schedule,release.replace('second quarter of 2026','third quarter of 2026'),event).status,'published','the reported quarter must match the official scheduled release');
 assert.notEqual(parseBeaGdpResult(schedule,release.replace('advance estimate released today','second estimate released today'),event).status,'published','the reported estimate stage must match the official title');
 assert.notEqual(parseBeaGdpResult(schedule,release,event,'2026-07-30T12:29:59.000Z').status,'published','a result fetched before the release cannot be published');
 assert.notEqual(parseBeaGdpResult(schedule+schedule,release,event).status,'published','ambiguous same-day GDP releases must not be guessed');
 assert.notEqual(parseBeaGdpResult(schedule,release,{...event,country:'EUR'}).status,'published','GDP events from another currency are not matched');
 const winterEvent={...event,date:'2026-01-30T13:30:00.000Z'};
 const winterSchedule=schedule.replace('July 30','January 30').replace('2nd Quarter 2026','4th Quarter 2025');
 const winterRelease=release.replace('2nd Quarter 2026','4th Quarter 2025').replace('Thursday, July 30, 2026','Friday, January 30, 2026').replace('second quarter of 2026','fourth quarter of 2025');
 assert.equal(parseBeaGdpResult(winterSchedule,winterRelease,winterEvent,'2026-01-30T13:35:00.000Z').status,'published','8:30 a.m. ET must account for standard time as well as daylight time');
});
test('BEA PCE results match the exact indicator, report month, official date, and release vintage',()=>{
 const {parseBeaPceResult}=require('../src/features/telegram-event-results');
 const event={title:'Core PCE Price Index m/m',date:'2026-09-30T12:30:00.000Z',country:'USD'};
 const schedule='<tr><td class="scheduled-date"><div class="release-date">September 30</div><small>8:30 AM</small></td><td class="release-title">Personal Income and Outlays, August 2026</td><td><a href="/news/2026/personal-income-and-outlays-august-2026">View</a></td></tr>';
 const release='<h1>Personal Income and Outlays, August 2026</h1><p>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Wednesday, September 30, 2026</p><p>Personal income increased $66.6 billion (0.2 percent at a monthly rate) in August, according to estimates released today by the U.S. Bureau of Economic Analysis (BEA). Disposable personal income increased $68.6 billion (0.3 percent), and personal consumption expenditures (PCE) increased $190.8 billion (0.9 percent).</p><p>From the preceding month, the PCE price index for August increased 0.3 percent. Excluding food and energy, the PCE price index increased 0.2 percent.</p><p>From the same month one year ago, the PCE price index for August increased 3.4 percent. Excluding food and energy, the PCE price index increased 3.0 percent from one year ago.</p>';
 const retrievedAt='2026-09-30T12:35:00.000Z';
 for(const [title,expected] of [['PCE Price Index m/m','0.3%'],['Core PCE Price Index m/m','0.2%'],['PCE Price Index y/y','3.4%'],['Core PCE Price Index y/y','3.0%'],['Personal Income m/m','0.2%'],['Personal Spending m/m','0.9%']]){
  const result=parseBeaPceResult(schedule,release,{...event,title},retrievedAt);
  assert.equal(result.status,'published',title);assert.equal(result.actual,expected,title);assert.equal(result.publishedAt,event.date,title);assert.equal(result.retrievedAt,retrievedAt,title);assert.equal(result.url,'https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026',title);
 }
 assert.notEqual(parseBeaPceResult(schedule,release,{...event,date:'2026-10-01T12:30:00.000Z'},retrievedAt).status,'published','a neighboring event date cannot borrow the result');
 assert.notEqual(parseBeaPceResult(schedule,release,{...event,title:'Core PCE Price Index m/m',country:'EUR'},retrievedAt).status,'published','a non-USD event cannot borrow a US result');
 assert.notEqual(parseBeaPceResult(schedule,release.replace('August 2026','July 2026'),event,retrievedAt).status,'published','a different report month cannot be substituted');
 assert.notEqual(parseBeaPceResult(schedule,release,event,'2026-09-30T12:29:59.000Z').status,'published','a pre-release fetch cannot publish an actual');
 assert.notEqual(parseBeaPceResult(schedule+schedule,release,event,retrievedAt).status,'published','ambiguous schedule entries must fail closed');
 assert.notEqual(parseBeaPceResult(schedule,release.replace('Excluding food and energy, the PCE price index increased 0.2 percent.',''),event,retrievedAt).status,'published','missing core series cannot be replaced with headline PCE');
});
test('BEA PCE resolver fetches only the scheduled official release page',async()=>{
 const {lookupOfficialEventResult}=require('../src/features/telegram-event-results');
 const event={title:'Core PCE Price Index y/y',date:'2025-10-31T12:30:00.000Z',country:'USD'},calls=[];
 const schedule='<tr><td class="scheduled-date"><div class="release-date">October 31</div><small>8:30 AM</small></td><td class="release-title">Personal Income and Outlays, September 2025</td><td><a href="/news/2025/personal-income-and-outlays-september-2025">View</a></td></tr>';
 const release='<h1>Personal Income and Outlays, September 2025</h1><p>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Friday, October 31, 2025</p><p>Personal income increased $10 billion (0.1 percent at a monthly rate) in September, according to estimates released today by the U.S. Bureau of Economic Analysis (BEA). Disposable personal income increased $8 billion (0.1 percent), and personal consumption expenditures (PCE) increased $9 billion (0.1 percent).</p><p>From the same month one year ago, the PCE price index for September increased 2.8 percent. Excluding food and energy, the PCE price index increased 2.9 percent from one year ago.</p>';
 const previousFetch=global.fetch;
 global.fetch=async input=>{const url=String(input);calls.push(url);if(url==='https://www.bea.gov/news/schedule/full?year=2025')return{ok:true,status:200,text:async()=>schedule};if(url==='https://www.bea.gov/news/2025/personal-income-and-outlays-september-2025')return{ok:true,status:200,text:async()=>release};throw new Error('unexpected external request '+url);};
 try{const result=await lookupOfficialEventResult(event);assert.equal(result.status,'published');assert.equal(result.actual,'2.9%');assert.equal(result.source,'U.S. Bureau of Economic Analysis (BEA)');assert.equal(result.url,'https://www.bea.gov/news/2025/personal-income-and-outlays-september-2025');assert.deepEqual(calls,['https://www.bea.gov/news/schedule/full?year=2025','https://www.bea.gov/news/2025/personal-income-and-outlays-september-2025']);assert.ok(Number.isFinite(Date.parse(result.retrievedAt)));}
 finally{global.fetch=previousFetch;}
});
test('BEA GDP resolver fetches the official year schedule and same-day release page',async()=>{
 const {lookupOfficialEventResult}=require('../src/features/telegram-event-results');
 const event={title:'GDP q/q',date:'2026-07-30T12:30:00.000Z',country:'USD'},calls=[];
 const schedule='<tr class="scheduled-releases-type-press"><td class="scheduled-date"><div class="release-date">July 30</div><small>8:30 AM</small></td><td class="release-title">GDP (Advance Estimate), 2nd Quarter 2026</td><td class="views-field-field-scheduled-release-url"><a href="/news/2026/gdp-advance-estimate-2nd-quarter-2026">View</a></td></tr>';
 const release='<h1>GDP (Advance Estimate), 2nd Quarter 2026</h1><p>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Thursday, July 30, 2026</p><p>Real gross domestic product (GDP) increased at an annual rate of 1.5 percent in the second quarter of 2026, according to the advance estimate released today by the U.S. Bureau of Economic Analysis (BEA).</p>';
 const previousFetch=global.fetch;
 global.fetch=async input=>{const url=String(input);calls.push(url);if(url==='https://www.bea.gov/news/schedule/full?year=2026')return{ok:true,status:200,text:async()=>schedule};if(url==='https://www.bea.gov/news/2026/gdp-advance-estimate-2nd-quarter-2026')return{ok:true,status:200,text:async()=>release};throw new Error('unexpected external request '+url);};
 try{const result=await lookupOfficialEventResult(event);assert.equal(result.status,'published');assert.equal(result.actual,'Real GDP 1.5% annualized (Advance Estimate)');assert.equal(result.source,'U.S. Bureau of Economic Analysis (BEA)');assert.equal(calls.length,2);assert.ok(Number.isFinite(Date.parse(result.retrievedAt)));}
 finally{global.fetch=previousFetch;}
});
test('BEA GDP result detail retains the official release link for Telegram follow-up',async()=>{
 const {TelegramEventResultMonitor,formatEventResultDetail,parseBeaGdpResult}=require('../src/features/telegram-event-results');
 const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};
 const event={title:'GDP q/q',date:'2026-07-30T12:30:00.000Z',country:'USD',impact:'high'};
 const schedule='<tr><td><div class="release-date">July 30</div><small>8:30 AM</small></td><td class="release-title">GDP (Advance Estimate), 2nd Quarter 2026</td><td><a href="/news/2026/gdp-advance-estimate-2nd-quarter-2026">View</a></td></tr>';
 const release='<h1>GDP (Advance Estimate), 2nd Quarter 2026</h1><p>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Thursday, July 30, 2026</p><p>Real gross domestic product (GDP) increased at an annual rate of 1.5 percent in the second quarter of 2026, according to the advance estimate released today by the U.S. Bureau of Economic Analysis (BEA).</p>';
 const actual=parseBeaGdpResult(schedule,release,event,'2026-07-30T12:35:00.000Z'),monitor=new TelegramEventResultMonitor(store,async()=>actual,()=>Date.parse('2026-07-30T12:40:00.000Z'));
 await monitor.run('owner',[event],async()=>77);
 const row=monitor.history('owner')[0],detail=monitor.detail('owner',row.id);
 assert.equal(detail.resultUrl,'https://www.bea.gov/news/2026/gdp-advance-estimate-2nd-quarter-2026');
 assert.match(formatEventResultDetail(detail),/Real GDP 1\.5% annualized/);
 assert.match(formatEventResultDetail(detail),/www\.bea\.gov\/news\/2026\/gdp-advance-estimate-2nd-quarter-2026/);
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

test('typed actuals without an explicit valid publication time remain pending with a truthful reason',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results'),values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))},messages=[];
 const event={kind:'funding',market:'crypto',instrument:'crypto:gateio:BTC_USDT',title:'funding result',date:'2026-10-02T13:30:00Z'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:'0%',status:'published',source:'Gate official',url:'https://api.gateio.ws/api/v4/futures/usdt/funding_rate'}),()=>Date.parse('2026-10-02T14:00:00Z'));
 monitor.registerReminder('owner',event,77);await monitor.run('owner',[],async(text,reply)=>{messages.push({text,reply});return 88;});
 assert.equal(messages.length,1);assert.equal(messages[0].reply,77);assert.match(messages[0].text,/暂不可用/);assert.match(messages[0].text,/发布时间/);assert.doesNotMatch(messages[0].text,/实际值：0%/);
 const row=monitor.history('owner')[0];assert.equal(row.resultStatus,'pending');assert.equal(row.actual,undefined);assert.equal(row.nextCheckAt,Date.parse('2026-10-02T14:00:00Z')+300000);
});

test('typed actuals remain pending when the tracked event time itself cannot be verified',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results'),values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))},messages=[];
 const event={kind:'funding',market:'crypto',instrument:'crypto:gateio:BTC_USDT',title:'funding result',date:'not-a-date'};
 let lookups=0;const monitor=new TelegramEventResultMonitor(store,async()=>{lookups++;return{actual:'0%',status:'published',source:'Gate official',publishedAt:'2026-10-02T13:45:00Z'};},()=>Date.parse('2026-10-02T14:00:00Z'));
 monitor.registerReminder('owner',{...event,date:'2026-10-02T13:30:00Z'},77);const state=values.get('telegram-event-results:owner'),id=Object.keys(state.events)[0];state.events[id]=event;values.set('telegram-event-results:owner',state);await monitor.run('owner',[],async(text,reply)=>{messages.push({text,reply});return 88;});
 assert.equal(messages.length,1);assert.equal(messages[0].reply,77);assert.match(messages[0].text,/事件时间/);assert.doesNotMatch(messages[0].text,/实际值：0%/);
 assert.equal(lookups,0);assert.equal(monitor.history('owner')[0].resultStatus,'unverifiable');
});

test('SEC earnings published on the event date are accepted despite an approximate calendar clock',async()=>{
 const {TelegramEventResultMonitor}=require('../src/features/telegram-event-results');
 const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))},messages=[];
 const event={id:'earnings-2026-08-01-AAPL',kind:'earnings',market:'stocks',instrument:'stock:us:AAPL',resourceId:'earnings-2026-08-01-AAPL',symbol:'AAPL',reportPeriodEnd:'2026-06-30',title:'AAPL Earnings',date:'2026-08-01T20:00:00.000Z',impact:'high',forecast:'1.20',source:'Nasdaq Public Calendar'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:'SEC GAAP EPS $1.23 · Revenue $85,000,000,000',status:'published',source:'SEC EDGAR 10-Q',url:'https://www.sec.gov/Archives/edgar/data/320193/000032019326000081/aapl-20260630.htm',publishedAt:'2026-08-01T17:30:00.000Z',reason:'SEC XBRL 为 GAAP 口径；Nasdaq 预期可能采用调整后口径，不直接计算超预期'}),()=>Date.parse('2026-08-01T21:00:00.000Z'));
 await monitor.run('owner',[event],async text=>messages.push(text));
 assert.equal(messages.length,1);assert.match(messages[0],/事件结果已发布/);assert.match(messages[0],/SEC GAAP EPS/);assert.match(messages[0],/GAAP 口径/);assert.match(messages[0],/SEC EDGAR 10-Q/);assert.match(messages[0],/<a href="https:\/\/www\.sec\.gov\/Archives\//);
});

test('result detail keeps the actual-result source, safe official URL, retry state, and escaped content',async()=>{
 const {TelegramEventResultMonitor,formatEventResultDetail}=require('../src/features/telegram-event-results');
 const values=new Map(),store={get:k=>structuredClone(values.get(k)||null),set:(k,v)=>values.set(k,structuredClone(v))};
 const event={id:'earnings-2026-08-01-AAPL',kind:'earnings',market:'stocks',instrument:'stock:us:AAPL',resourceId:'earnings-2026-08-01-AAPL',symbol:'AAPL',reportPeriodEnd:'2026-06-30',title:'<AAPL>',date:'2026-08-01T20:00:00.000Z',impact:'high',source:'Nasdaq Public Calendar'};
 const monitor=new TelegramEventResultMonitor(store,async()=>({actual:'SEC GAAP EPS $1.23',status:'published',source:'SEC EDGAR 10-Q',url:'https://www.sec.gov/Archives/edgar/data/320193/filing.htm',publishedAt:'2026-08-01T17:30:00.000Z',retrievedAt:'2026-08-01T17:35:00.000Z',reason:'GAAP'}),()=>Date.parse('2026-08-01T21:00:00.000Z'));
 await monitor.run('owner',[event],async()=>77);
 const row=monitor.history('owner')[0],detail=monitor.detail('owner',row.id);
 assert.equal(detail.source,'SEC EDGAR 10-Q');
 assert.equal(detail.resultUrl,'https://www.sec.gov/Archives/edgar/data/320193/filing.htm');
 assert.equal(detail.actual,'SEC GAAP EPS $1.23');
 assert.equal(detail.retrievedAt,'2026-08-01T17:35:00.000Z');
 assert.match(formatEventResultDetail(detail),/SEC EDGAR 10-Q/);
 assert.match(formatEventResultDetail(detail),/SEC GAAP EPS \$1\.23/);
 assert.match(formatEventResultDetail(detail),/来源抓取时间：2026-08-01T17:35:00.000Z/);
 assert.match(formatEventResultDetail(detail),/&lt;AAPL&gt;/);
 assert.doesNotMatch(formatEventResultDetail(detail),/<AAPL>/);
 assert.equal(monitor.detail('another-chat',row.id),null);
});
