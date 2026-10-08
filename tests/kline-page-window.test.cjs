const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
test('history pages never turn a stale or degraded source response into successful historical data',()=>{
 const {klinePageStatus}=require('../src/features/kline-page-window');assert.equal(typeof klinePageStatus,'function');assert.equal(klinePageStatus('live',true),'historical');for(const status of ['stale','degraded','unavailable','cached'])assert.equal(klinePageStatus(status,true),status);assert.equal(klinePageStatus('live',false),'live');
});
test('source paging validates exclusive cursor, timeframe and bounded window without guessing market calendars',()=>{
 assert.ok(fs.existsSync('src/features/kline-page-window.ts'),'source page contract missing');const {klinePageWindow}=require('../src/features/kline-page-window'),now=Date.UTC(2026,9,8),before=now-86400000;
 assert.deepEqual(klinePageWindow('crypto','5m',before,100,now),{before,startTime:before-100*300000,endTime:before-1,limit:100});
 const stock=klinePageWindow('stocks','1d',before,100,now);assert.equal(stock.startTime,before-300*86400000);assert.equal(stock.endTime,before-1);assert.equal(stock.limit,100);
 for(const args of [['options','1d',before,100],['stocks','3d',before,100],['stocks','1d',now+1,100],['crypto','5m',before,1001],['crypto','5m',NaN,100]])assert.throws(()=>klinePageWindow(...args,now));
});
