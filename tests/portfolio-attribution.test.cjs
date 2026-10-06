const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('attribution preserves currencies, accounts, explicit cash flows and unknown old costs',()=>{
 const {portfolioAttribution}=require('../src/features/portfolio-attribution');
 const rows=[{market:'stocks',instrument:'stock:us:AAPL',quantity:2,price:110,averageCost:100,currency:'USD',accountSource:'paper',accountId:'main',cashFlows:[{at:'2026-10-01T00:00:00Z',amount:2,currency:'USD'}]},{market:'stocks',instrument:'stock:hk:00700',quantity:1,price:400,currency:'HKD',accountSource:'manual',accountId:'import'}];
 const orders=[{instrumentId:'stock:us:AAPL',instrumentType:'stock',side:'SELL',quantity:1,price:110,timestamp:'2026-10-01T00:00:00Z',strategy:'ma',strategyVersion:'v1',pnlUsd:10,feeUsd:1,slippageUsd:0}];const before=JSON.stringify(rows);
 const result=portfolioAttribution('stocks',rows,orders);assert.equal(result.byCurrency.USD.unrealizedPnl,20);assert.equal(result.byCurrency.HKD.unrealizedPnl,null);assert.equal(result.byCurrency.USD.cashFlows,2);assert.equal(result.strategies[0].recordedFeesUsd,1);assert.equal(result.strategies[0].unrealizedPnl,null);assert.equal(result.strategies[0].realizedQuotePnl,10);assert.equal(result.strategies[0].currency,'UNKNOWN');assert.equal(result.totalConvertedValue,null);assert.equal(JSON.stringify(rows),before);assert.equal(result.executionEnabled,false);
 assert.throws(()=>portfolioAttribution('crypto',rows,orders),/市场/);
 const legacy=portfolioAttribution('stocks',rows,[{...orders[0],feeUsd:undefined}]);assert.equal(legacy.strategies[0].recordedFeesUsd,null);
});
test('signal quality never represents missing benchmarks, outcomes or excursions as zero',()=>{
 const {analyzeSignalQuality}=require('../src/features/decision-intelligence');const row={id:'s',market:'stocks',instrument:'stock:us:AAPL',strategyId:'ma',strategyVersion:'v1',timeframe:'1d',source:'Nasdaq',triggeredAt:1,entryPrice:100,sample:'live'};
 const result=analyzeSignalQuality([row]);assert.equal(result.benchmarkReturnPct,null);assert.equal(result.hitRate,null);assert.equal(result.averageReturnPct,null);assert.equal(result.averageMfePct,null);assert.equal(result.byStrategyVersion['ma@v1'].resolved,0);assert.match(result.warnings.join(' '),/样本量/);
});
