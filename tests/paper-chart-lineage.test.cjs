const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('nonempty IDs are not proof: missing, wrong-scope, unrelated and future references remain unlinked',()=>{
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');const order={id:'o',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:1,timestamp:'2026-10-08T00:00:00Z',signalId:'s',dataSnapshotId:'d'};
 const signal={id:'s',market:'stocks',instrument:order.instrumentId,at:'2026-10-07T23:59:00Z',snapshotIds:['d']},snapshot={id:'d',market:'stocks',instrument:order.instrumentId,at:'2026-10-07T23:59:00Z'};
 const refs={signal:()=>signal,snapshot:()=>snapshot};
 assert.equal(paperChartLineage({orders:[order]},'stocks',order.instrumentId).markers.length,0);
 for(const broken of [{...refs,signal:()=>null},{...refs,snapshot:()=>null},{...refs,signal:()=>({...signal,instrument:'stock:us:MU'})},{...refs,snapshot:()=>({...snapshot,market:'crypto'})},{...refs,signal:()=>({...signal,snapshotIds:['other']})},{...refs,snapshot:()=>({...snapshot,at:'2026-10-09T00:00:00Z'})}]){
  const result=paperChartLineage({orders:[order]},'stocks',order.instrumentId,undefined,broken);assert.equal(result.markers.length,0);assert.equal(result.unlinked.length,1);
 }
 assert.equal(paperChartLineage({orders:[order]},'stocks',order.instrumentId,undefined,refs).markers.length,1);
 assert.equal(paperChartLineage({orders:[{...order,accountId:'forged'}]},'stocks',order.instrumentId,undefined,refs).markers.length,0);
});
test('chart lineage selects only exact market and identity, preserving unlinked legacy orders',()=>{
 const fs=require('node:fs');assert.ok(fs.existsSync('src/features/paper-chart-lineage.ts'),'lineage projection missing');
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const base={id:'o1',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:1,timestamp:'2026-10-08T00:00:00Z',signalId:'s1',dataSnapshotId:'d1',accountId:'unified-paper-ledger',feeUsd:1};
 const ledger={orders:[base,{...base,id:'legacy',signalId:undefined},{...base,id:'other',instrumentId:'stock:us:MU'},{...base,id:'crypto',instrumentType:'crypto'}],runnerAccounts:{a2:{accountId:'a2',runnerId:'r2',orders:[{...base,id:'runner',accountId:'a2',runnerId:'r2'}]}}};
 const refs={signal:()=>({id:'s1',market:'stocks',instrument:base.instrumentId,at:base.timestamp,snapshotIds:['d1']}),snapshot:()=>({id:'d1',market:'stocks',instrument:base.instrumentId,at:base.timestamp})};
 const result=paperChartLineage(ledger,'stocks','stock:us:AAPL',undefined,refs);
 assert.deepEqual(result.markers.map(row=>row.orderId),['o1','runner']);assert.equal(result.unlinked.length,1);assert.equal(result.unlinked[0].orderId,'legacy');assert.match(result.unlinked[0].reason,/信号/);assert.equal(result.markers[0].feeUsd,1);
 assert.equal(paperChartLineage(ledger,'stocks','stock:us:AAPL','a2',refs).markers.length,1);
 assert.equal(paperChartLineage(ledger,'crypto','stock:us:AAPL').markers.length,0);
});
test('invalid fill timestamps and nonfinite prices never become chart markers',()=>{
 const fs=require('node:fs');assert.ok(fs.existsSync('src/features/paper-chart-lineage.ts'),'lineage projection missing');
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const order={id:'o',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:NaN,quantity:1,timestamp:'bad',signalId:'s',dataSnapshotId:'d'};
 const result=paperChartLineage({orders:[order]},'stocks',order.instrumentId);assert.equal(result.markers.length,0);assert.equal(result.unlinked.length,1);
});
