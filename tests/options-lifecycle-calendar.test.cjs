const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('option calendar keeps contract expiry date separate from unverified trading cutoff and dividend/assignment metadata',()=>{
 const {buildOptionLifecycleCalendar}=require('../src/features/options-market');assert.equal(typeof buildOptionLifecycleCalendar,'function');
 const input={source:'CBOE delayed quotes',fetchedAt:'2026-10-01T12:00:00Z',nowMs:Date.parse('2026-10-01T12:01:00Z'),legs:[{row:{instrumentName:'AAPL261016C00100000'},action:'sell',contracts:1},{row:{instrumentName:'AAPL261016P00100000'},action:'buy',contracts:1}]};
 const result=buildOptionLifecycleCalendar(input);assert.equal(result.executionEnabled,false);assert.equal(result.legs.length,2);assert.equal(result.legs[0].expiryDate,'2026-10-16');assert.equal(result.legs[0].cutoffAt,null);assert.equal(result.legs[0].exDividendAt,null);assert.equal(result.legs[0].exerciseStyle,null);assert.equal(result.legs[0].assignmentCalculationEnabled,false);assert.match(result.legs[0].reason,/卖出|指派/);assert.equal(result.dataStatus,'partial');
});
test('existing payoff route and workspace expose the same lifecycle calendar, not a separate data channel',()=>{
 const fs=require('node:fs'),server=fs.readFileSync('src/web/server.ts','utf8'),ui=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8');
 const start=server.indexOf("app.post('/api/options/payoff'");assert.match(server.slice(start,server.indexOf("app.post('/api/options/history/save'",start)),/buildOptionLifecycleCalendar/);assert.ok(ui.includes("dataset.optionLifecycle=''"));
});
test('invalid dates, unrelated markets, unknown names and future or stale observations never become lifecycle evidence',()=>{
 const {buildOptionLifecycleCalendar}=require('../src/features/options-market');assert.equal(typeof buildOptionLifecycleCalendar,'function');
 for(const instrumentName of ['AAPL260230C00100000','BTCUSDT','AAPL','AAPL261016X00100000']){const out=buildOptionLifecycleCalendar({source:'fixture',fetchedAt:'2026-10-01T12:00:00Z',nowMs:Date.parse('2026-10-01T12:01:00Z'),legs:[{row:{instrumentName},action:'buy',contracts:1}]});assert.equal(out.legs[0].expiryDate,null);assert.equal(out.dataStatus,'unavailable');}
 const out=buildOptionLifecycleCalendar({source:'fixture',fetchedAt:'2027-10-01T12:00:00Z',nowMs:Date.parse('2026-10-01T12:01:00Z'),legs:[{row:{instrumentName:'AAPL261016C00100000'},action:'sell',contracts:1}]});assert.equal(out.dataStatus,'unavailable');assert.equal(out.legs.length,0);
});
