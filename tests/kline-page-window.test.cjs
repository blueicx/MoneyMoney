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
test('stock chart bootstrap is capped at 300 and keeps enough source history for the existing earlier-page control',()=>{
 const {stockKlineChartInitialWindow}=require('../src/features/kline-page-window');
 assert.equal(typeof stockKlineChartInitialWindow,'function');
 const now=Date.UTC(2026,9,8,12,34,56,789),endTime=Date.UTC(2026,9,8,12,34);
 for(const [interval,span] of [['1m',7*86400000-2*60000],['5m',30*86400000],['15m',60*86400000-2*60000],['1h',180*86400000],['1d',2*365*86400000]]){
  assert.deepEqual(stockKlineChartInitialWindow(interval,{enabled:true,adjustment:'source'},now),{startTime:endTime-span,endTime,limit:300});
 }
 for(const context of [
  {enabled:false,adjustment:'source'},
  {enabled:true,adjustment:'source',asOf:true},
  {enabled:true,adjustment:'source',tradingDate:true},
  {enabled:true,adjustment:'source',paginated:true},
  {enabled:true,adjustment:'forward'},
 ]) assert.equal(stockKlineChartInitialWindow('1d',context,now),undefined);
 assert.equal(stockKlineChartInitialWindow('3d',{enabled:true,adjustment:'source'},now),undefined,'non-paginatable aggregate periods retain their existing range');
 assert.throws(()=>stockKlineChartInitialWindow('1d',{enabled:true,adjustment:'source'},NaN),/时间/);
});
test('only the opt-in stock chart route applies the bootstrap window and labels cache hits without weakening source status',()=>{
 const server=fs.readFileSync('src/web/server.ts','utf8'),start=server.indexOf("app.get('/api/stock/kline'"),end=server.indexOf("app.use('/api/stocks/guru-holdings'",start),route=server.slice(start,end);
 assert.match(route,/stockKlineChartInitialWindow\(effectivePeriod/);
 assert.match(route,/enabled:req\.query\.chartWindow==='1'/);
 assert.match(route,/asOf:Boolean\(asOf\).*tradingDate:Boolean\(tradingDate\).*paginated:Boolean\(page\).*adjustment/);
 assert.match(route,/page\?\{startTime:page\.startTime,endTime:page\.endTime\+1\}:initialWindow\?\{startTime:initialWindow\.startTime,endTime:initialWindow\.endTime\}/);
 assert.match(route,/initialWindow\?bars\.slice\(-initialWindow\.limit\)/);
 assert.match(route,/cacheableLiveChart\s*=\s*isCacheableLatestStockChart/,'only an explicit latest chart request may use the display cache');
 assert.match(route,/responseDataStatus\s*=\s*displayCacheEntry\?\.status\s*===\s*'expired'/,'expired cached chart data must fail closed');
 assert.match(route,/dataStatus:klinePageStatus\(responseDataStatus,!!page\)/,'cache hits must be reported as cached, not as live source data');
 assert.match(route,/sourceTime:history\?\.sourceTime\|\|null/,'source timestamp must remain visible separately from cache capture time');
});
