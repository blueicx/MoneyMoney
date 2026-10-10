const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
function moduleUnderTest(){assert.ok(fs.existsSync('src/features/telegram-result-adapters.ts'),'result adapters missing');return require('../src/features/telegram-result-adapters');}

test('explicit tracking refuses disabled event notifications without starting an invisible monitor',()=>{
 const {resultTrackingDisabledReason}=moduleUnderTest();
 assert.match(resultTrackingDisabledReason(false),/未启动.*事件通知/);
 assert.equal(resultTrackingDisabledReason(true),null);
 const server=fs.readFileSync('src/web/server.ts','utf8'),command=server.slice(server.indexOf('trackresult: async'),server.indexOf('contracts: async',server.indexOf('trackresult: async')));
 assert.match(command,/resultTrackingDisabledReason/);
 assert.ok(command.indexOf('resultTrackingDisabledReason')<command.indexOf('sendToChat'),'guard must run before promising results');
});
test('research result resolves the explicit job and market, never treating failed jobs as completed',async()=>{
 const {lookupTrackedResult}=moduleUnderTest(),event={kind:'research',market:'stocks',resourceId:'j1',title:'Research',date:'2026-10-08T00:00:00Z'};
 let job={id:'j1',market:'stocks',status:'succeeded',updatedAt:'2026-10-08T01:00:00Z',artifactHash:'hash'};
 const ports={job:()=>job};assert.equal((await lookupTrackedResult(event,ports)).actual,'研究任务已完成');
 job={...job,status:'failed',errorReason:'snapshot missing'};const failed=await lookupTrackedResult(event,ports);assert.equal(failed.actual,null);assert.equal(failed.status,'stopped');assert.match(failed.reason,/snapshot/);
 job={...job,market:'crypto',status:'succeeded'};assert.equal((await lookupTrackedResult(event,ports)).status,'unsupported');
});
test('funding results require the same contract and exact settlement time, not current rate',async()=>{
 const {lookupTrackedResult}=moduleUnderTest(),event={kind:'funding',market:'crypto',instrument:'crypto:gateio:BTC_USDT',title:'funding',date:'2026-10-08T00:00:00Z'};
 const ports={contract:async()=>({instrument:event.instrument,quote:{fundingRatePct:99},funding:[{at:'2026-10-07T16:00:00Z',ratePct:1}],sections:{funding:{dataStatus:'delayed',source:'https://api.gateio.ws/api/v4/futures/usdt/funding_rate'}}})};
 assert.equal((await lookupTrackedResult(event,ports)).actual,null);
 ports.contract=async()=>({instrument:event.instrument,funding:[{at:event.date,ratePct:0}],sections:{funding:{dataStatus:'delayed',source:'https://api.gateio.ws/api/v4/futures/usdt/funding_rate'}}});
 const result=await lookupTrackedResult(event,ports);assert.equal(result.actual,'0%');assert.equal(result.publishedAt,event.date);
});
test('prediction requires explicit official settled evidence, never a probability near one',async()=>{
 const {lookupTrackedResult}=moduleUnderTest(),event={kind:'prediction',market:'prediction',instrument:'prediction:kalshi:KXTEST',platform:'Kalshi',resourceId:'KXTEST',title:'settlement',date:'2026-10-08T00:00:00Z'};
 let evidence={instrument:event.instrument,marketId:event.resourceId,platform:'Kalshi',status:'closed',result:null,probability:1,sourceUrl:'https://api.elections.kalshi.com/trade-api/v2/markets/KXTEST',evidenceHash:'h'};
 const ports={settlement:async()=>evidence};assert.equal((await lookupTrackedResult(event,ports)).actual,null);
 evidence={...evidence,status:'settled',result:'YES',settlementAt:'2026-10-08T01:00:00Z'};assert.equal((await lookupTrackedResult(event,ports)).actual,'YES');
 evidence={...evidence,instrument:'prediction:kalshi:OTHER'};assert.equal((await lookupTrackedResult(event,ports)).actual,null);
});

test('prediction settlement is not published without an official determination or settlement timestamp',async()=>{
 const {lookupTrackedResult}=moduleUnderTest(),event={kind:'prediction',market:'prediction',instrument:'prediction:kalshi:KXTEST',platform:'Kalshi',resourceId:'KXTEST',title:'settlement',date:'2026-10-08T00:00:00Z'};
 const evidence={instrument:event.instrument,marketId:event.resourceId,platform:'Kalshi',status:'settled',result:'YES',sourceUrl:'https://api.elections.kalshi.com/trade-api/v2/markets/KXTEST',evidenceHash:'verified-hash',settlementAt:null,determinationAt:null};
 const result=await lookupTrackedResult(event,{settlement:async()=>evidence});assert.equal(result.actual,null);assert.equal(result.status,'pending');assert.match(result.reason,/时间/);assert.deepEqual(result.evidenceRefs,['verified-hash']);
});

test('prediction result uses a valid determination time when settlement time predates the tracked event',async()=>{
 const {lookupTrackedResult}=moduleUnderTest(),event={kind:'prediction',market:'prediction',instrument:'prediction:kalshi:KXTEST',platform:'Kalshi',resourceId:'KXTEST',title:'settlement',date:'2026-10-08T00:00:00Z'};
 const evidence={instrument:event.instrument,marketId:event.resourceId,platform:'Kalshi',status:'settled',result:'YES',sourceUrl:'https://api.elections.kalshi.com/trade-api/v2/markets/KXTEST',evidenceHash:'verified-hash',settlementAt:'2026-10-07T23:00:00Z',determinationAt:'2026-10-08T01:00:00Z'};
 const result=await lookupTrackedResult(event,{settlement:async()=>evidence});assert.equal(result.actual,'YES');assert.equal(result.publishedAt,'2026-10-08T01:00:00Z');
});

test('earnings events preserve stock identity and report-period evidence when mapped for result tracking',async()=>{
 const {toTrackedCalendarEvent,lookupTrackedResult}=moduleUnderTest();
 const tracked=toTrackedCalendarEvent({id:'earnings-2026-07-29-AAPL',title:'AAPL 财报',category:'earnings',date:'2026-07-29T20:00:00.000Z',country:'US',forecast:'1.20',previous:'1.10',actual:null,source:'Nasdaq Public Calendar',symbol:'AAPL',reportPeriodEnd:'2026-06-30'});
 assert.equal(tracked.kind,'earnings');assert.equal(tracked.market,'stocks');assert.equal(tracked.instrument,'stock:us:AAPL');assert.equal(tracked.reportPeriodEnd,'2026-06-30');
 const ports={secEarnings:async(symbol,periodEnd,eventDate)=>({symbol,reportPeriodEnd:periodEnd,acceptedAt:'2026-08-01T17:30:00.000Z',form:'10-Q',accessionNumber:'0000320193-26-000081',epsUsdPerShare:1.234,revenueUsd:85000000000,sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019326000081/aapl-20260630.htm'})};
 const result=await lookupTrackedResult(tracked,ports);assert.equal(result.status,'published');assert.equal(result.publishedAt,'2026-08-01T17:30:00.000Z');assert.match(result.actual,/GAAP EPS/);assert.match(result.actual,/85,000,000,000/);assert.match(result.reason,/口径/);
 ports.secEarnings=async()=>({symbol:'MSFT',reportPeriodEnd:'2026-06-30',acceptedAt:'2026-08-01T17:30:00.000Z',form:'10-Q',accessionNumber:'x',epsUsdPerShare:1,revenueUsd:2,sourceUrl:'https://www.sec.gov/'});
 assert.equal((await lookupTrackedResult(tracked,ports)).status,'unsupported');
});

test('event result command provides per-item details and validates the signed chat-bound callback payload',()=>{
 const server=fs.readFileSync('src/web/server.ts','utf8');
 const command=server.slice(server.indexOf('eventresults: ({ chatId })'),server.indexOf('inbox: ({chatId})'));
 const callback=server.slice(server.indexOf("if (data.startsWith('event-result:handle:"),server.indexOf("if (data.startsWith('delivery:handle:"));
 assert.match(command,/['"]detail['"]/);
 assert.match(command,/详情/);
 assert.match(callback,/record\.chatId\s*!==\s*ctx\.chatId|consumeTelegramCallback\(data,\s*'event-result:handle',\s*ctx\.chatId\)/);
 assert.match(callback,/telegramEventResults\.detail\(ctx\.chatId,\s*id\)/);
 assert.match(callback,/formatEventResultDetail/);
 assert.match(callback,/telegramSafeExternalUrl/);
});
