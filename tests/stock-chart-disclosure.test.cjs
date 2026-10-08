const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
test('stock chart disclosure never infers adjustment from provider name or receipt time',()=>{
 assert.ok(fs.existsSync('src/features/stock-chart-disclosure.ts'),'chart disclosure missing');const {stockChartDisclosure}=require('../src/features/stock-chart-disclosure');
 const rows=[{time:1000},{time:2000}];const result=stockChartDisclosure(rows);
 assert.equal(result.adjustment.actual,'unknown');assert.equal(result.adjustment.conversionEnabled,false);assert.deepEqual(result.adjustment.available,['source']);assert.equal(result.coverage.records,2);assert.equal(result.coverage.from,1000);assert.throws(()=>stockChartDisclosure(rows,'forward'),/复权/);
});
test('historical chart exposes only the stored adjustment and rejects unsupported conversion',()=>{
 assert.ok(fs.existsSync('src/features/stock-chart-disclosure.ts'),'chart disclosure missing');const {stockChartDisclosure}=require('../src/features/stock-chart-disclosure');
 const result=stockChartDisclosure([{time:1000}],'source','unadjusted');assert.equal(result.adjustment.actual,'unadjusted');assert.deepEqual(result.adjustment.available,['source','unadjusted']);assert.equal(stockChartDisclosure([{time:1000}],'unadjusted','unadjusted').adjustment.requested,'unadjusted');assert.throws(()=>stockChartDisclosure([{time:1000}],'forward','unadjusted'),/复权/);
});
test('aligned Yahoo adjusted-close evidence enables an explicitly labeled forward OHLC view but keeps volume source-based',()=>{
 const {stockChartDisclosure}=require('../src/features/stock-chart-disclosure');
 const rows=[{time:1000,open:1,high:2,low:.5,close:1.5,volume:10}];
 const source=stockChartDisclosure(rows,'source','unknown',{forwardAvailable:true,volumeBasis:'source'});
 assert.deepEqual(source.adjustment.available,['source','forward']);
 assert.equal(source.adjustment.conversionEnabled,false);
 const forward=stockChartDisclosure(rows,'forward','unknown',{forwardAvailable:true,volumeBasis:'source'});
 assert.equal(forward.adjustment.actual,'yahoo-adjclose-factor-derived');
 assert.equal(forward.adjustment.conversionEnabled,true);
 assert.equal(forward.adjustment.volumeBasis,'source');
 assert.match(forward.adjustment.reason,/Yahoo Adj Close.*成交量.*来源/);
});
test('derived forward adjustment is prohibited for as-of, named intraday, and paginated windows',()=>{
 const {stockChartAdjustmentRequestReason}=require('../src/features/stock-chart-disclosure');
 assert.equal(stockChartAdjustmentRequestReason('source',{asOf:true}),null);
 assert.match(stockChartAdjustmentRequestReason('forward',{asOf:true}),/历史时点/);
 assert.match(stockChartAdjustmentRequestReason('forward',{tradingDate:true}),/日内/);
 assert.match(stockChartAdjustmentRequestReason('forward',{paginated:true}),/分页/);
 assert.match(stockChartAdjustmentRequestReason('backward',{}),/后复权/);
});
