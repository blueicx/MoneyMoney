const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('Telegram uses the same full kline cache identity for fetched time instead of inventing now',()=>{
 const server=require('node:fs').readFileSync('src/web/server.ts','utf8');
 assert.ok(server.includes('updatedAt = binanceFeed.klineCachedAt(ref.symbol,timeframe,200)'), 'Telegram must read the exact instrument, interval and size cache');
 assert.ok(!server.includes("binanceFeed.cachedAt('kline:'+ref.symbol+':'+timeframe)"));
});
test('Binance pages keep cursor and limit in cache identity and never include the cursor candle',async t=>{
 const {BinanceFeed}=require('../src/features/binance');const original=global.fetch;t.after(()=>global.fetch=original);const calls=[],at=Date.now()-3600000;
 global.fetch=async url=>{calls.push(new URL(url));return {ok:true,json:async()=>[[at-60000,'10','12','9','11','1',0,'1',0,0,'1'],[at,'10','12','9','11','1',0,'1',0,0,'1']]};};
 const feed=new BinanceFeed(),page=await feed.getKlines('BTCUSDT','1m',2,{before:at});assert.equal(calls[0].searchParams.get('endTime'),String(at-1));assert.deepEqual(page.map(row=>row.time),[at-60000]);
 await feed.getKlines('BTCUSDT','1m',3,{before:at});await feed.getKlines('BTCUSDT','1m',2,{before:at-60000});assert.equal(calls.length,3);
 await assert.rejects(()=>feed.getKlines('BTCUSDT','1m',2,{before:Date.now()+60000}),/时间|future/i);assert.equal(calls.length,3);
});
test('Yahoo pages request a bounded UTC window, remove out-of-window bars and never mix range with period bounds',async t=>{
 const {createYahooStockKlineAdapter}=require('../src/data/yahoo-adapter');const original=global.fetch;t.after(()=>global.fetch=original);const startTime=Date.UTC(2026,8,1),endTime=Date.UTC(2026,8,3);let url;
 global.fetch=async input=>{url=new URL(input);return {ok:true,json:async()=>({chart:{result:[{timestamp:[startTime/1000-1,startTime/1000,endTime/1000],indicators:{quote:[{open:[10,10,10],high:[12,12,12],low:[9,9,9],close:[11,11,11],volume:[1,1,1]}]}}]}})};};
 const result=await createYahooStockKlineAdapter().fetch({symbol:'usAAPL',period:'1d',startTime,endTime});assert.equal(url.searchParams.get('period1'),String(startTime/1000));assert.equal(url.searchParams.get('period2'),String(endTime/1000));assert.equal(url.searchParams.has('range'),false);assert.deepEqual(result.data.map(row=>row.time),[startTime]);
});
test('source windows reject partial or future bounds before making an upstream call',async t=>{
 const {createYahooStockKlineAdapter}=require('../src/data/yahoo-adapter');const original=global.fetch;t.after(()=>global.fetch=original);let calls=0;global.fetch=async()=>{calls++;throw Error('must not request');};
 for(const input of [{startTime:1},{startTime:Date.now(),endTime:Date.now()+60000},{startTime:2,endTime:1}]){const result=await createYahooStockKlineAdapter().fetch({symbol:'AAPL',period:'1d',...input});assert.equal(result.status,'unavailable');assert.match(result.error,/window/i);}
 assert.equal(calls,0);
});
