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
