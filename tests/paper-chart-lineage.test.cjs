const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('chart lineage selects only exact market and identity, preserving unlinked legacy orders',()=>{
 const fs=require('node:fs');assert.ok(fs.existsSync('src/features/paper-chart-lineage.ts'),'lineage projection missing');
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const base={id:'o1',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:1,timestamp:'2026-10-08T00:00:00Z',signalId:'s1',dataSnapshotId:'d1',accountId:'a1',feeUsd:1};
 const ledger={orders:[base,{...base,id:'legacy',signalId:undefined},{...base,id:'other',instrumentId:'stock:us:MU'},{...base,id:'crypto',instrumentType:'crypto'}],runnerAccounts:{a2:{accountId:'a2',runnerId:'r2',orders:[{...base,id:'runner',accountId:'a2',runnerId:'r2'}]}}};
 const result=paperChartLineage(ledger,'stocks','stock:us:AAPL');
 assert.deepEqual(result.markers.map(row=>row.orderId),['o1','runner']);assert.equal(result.unlinked.length,1);assert.equal(result.unlinked[0].orderId,'legacy');assert.match(result.unlinked[0].reason,/信号/);assert.equal(result.markers[0].feeUsd,1);
 assert.equal(paperChartLineage(ledger,'stocks','stock:us:AAPL','a2').markers.length,1);
 assert.equal(paperChartLineage(ledger,'crypto','stock:us:AAPL').markers.length,0);
});
test('invalid fill timestamps and nonfinite prices never become chart markers',()=>{
 const fs=require('node:fs');assert.ok(fs.existsSync('src/features/paper-chart-lineage.ts'),'lineage projection missing');
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const order={id:'o',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:NaN,quantity:1,timestamp:'bad',signalId:'s',dataSnapshotId:'d'};
 const result=paperChartLineage({orders:[order]},'stocks',order.instrumentId);assert.equal(result.markers.length,0);assert.equal(result.unlinked.length,1);
});
