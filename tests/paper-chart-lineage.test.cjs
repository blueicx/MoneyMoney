const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('nonempty IDs are not proof: missing, wrong-scope, unrelated and future references remain unlinked',()=>{
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');const order={id:'o',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:1,timestamp:'2026-10-08T00:00:00Z',signalId:'s',dataSnapshotId:'d',accountId:'ai-runner:r',runnerId:'r'};
 const signal={id:'s',market:'stocks',instrument:order.instrumentId,accountId:order.accountId,runnerId:'r',orderId:'o',at:'2026-10-07T23:59:00Z',snapshotIds:['d'],decision:{id:'s',runnerId:'r',orderId:'o',market:'stocks',instrument:'AAPL',action:'BUY'}},snapshot={id:'d',market:'stocks',instrument:order.instrumentId,at:'2026-10-07T23:59:00Z'};
 const refs={signal:()=>signal,snapshot:()=>snapshot};
 const ledger={orders:[],runnerAccounts:{[order.accountId]:{accountId:order.accountId,runnerId:order.runnerId,orders:[order]}}};
 assert.equal(paperChartLineage(ledger,'stocks',order.instrumentId).markers.length,0);
 for(const broken of [{...refs,signal:()=>null},{...refs,snapshot:()=>null},{...refs,signal:()=>({...signal,instrument:'stock:us:MU'})},{...refs,snapshot:()=>({...snapshot,market:'crypto'})},{...refs,signal:()=>({...signal,snapshotIds:['other']})},{...refs,snapshot:()=>({...snapshot,at:'2026-10-09T00:00:00Z'})}]){
  const result=paperChartLineage(ledger,'stocks',order.instrumentId,undefined,broken);assert.equal(result.markers.length,0);assert.equal(result.unlinked.length,1);
 }
 assert.equal(paperChartLineage(ledger,'stocks',order.instrumentId,undefined,refs).markers.length,1);
 assert.equal(paperChartLineage({...ledger,runnerAccounts:{[order.accountId]:{...ledger.runnerAccounts[order.accountId],orders:[{...order,accountId:'forged'}]}}},'stocks',order.instrumentId,undefined,refs).markers.length,0);
});
test('chart markers require the persisted decision action and prediction outcome to match the fill',()=>{
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const stock={id:'stock-order',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:1,timestamp:'2026-10-08T00:00:02Z',signalId:'stock-signal',dataSnapshotId:'stock-snapshot',accountId:'ai-runner:r',runnerId:'r'};
 const stockSignal={id:'stock-signal',runnerId:'r',accountId:'ai-runner:r',orderId:stock.id,market:'stocks',instrument:stock.instrumentId,at:'2026-10-08T00:00:01Z',snapshotIds:['stock-snapshot'],decision:{id:'stock-signal',runnerId:'r',orderId:stock.id,market:'stocks',instrument:'AAPL',action:'BUY'}};
 const stockSnapshot={id:'stock-snapshot',market:'stocks',instrument:stock.instrumentId,at:'2026-10-08T00:00:01Z'},stockRefs={signal:()=>stockSignal,snapshot:()=>stockSnapshot};
 const stockLedger={orders:[],runnerAccounts:{'ai-runner:r':{accountId:'ai-runner:r',runnerId:'r',orders:[stock]}}};
 assert.equal(paperChartLineage(stockLedger,'stocks',stock.instrumentId,undefined,stockRefs).markers.length,1);
 const wrongStockSignal={...stockSignal,decision:{...stockSignal.decision,action:'SELL'}};
 assert.equal(paperChartLineage({...stockLedger,runnerAccounts:{'ai-runner:r':{...stockLedger.runnerAccounts['ai-runner:r'],orders:[stock]}}},'stocks',stock.instrumentId,undefined,{...stockRefs,signal:()=>wrongStockSignal}).unlinked.length,1);
 const missingAction={...stockSignal,decision:{...stockSignal.decision,action:undefined}};
 assert.equal(paperChartLineage(stockLedger,'stocks',stock.instrumentId,undefined,{...stockRefs,signal:()=>missingAction}).unlinked.length,1);
 const missingSideOrder={...stock,side:undefined};
 assert.equal(paperChartLineage({...stockLedger,runnerAccounts:{'ai-runner:r':{...stockLedger.runnerAccounts['ai-runner:r'],orders:[missingSideOrder]}}},'stocks',stock.instrumentId,undefined,{...stockRefs,signal:()=>missingAction}).unlinked.length,1);
 const prediction={id:'prediction-order',instrumentType:'prediction',instrumentId:'prediction:predictfun:EVENT-1',side:'YES',price:.4,quantity:1,timestamp:'2026-10-08T00:00:02Z',signalId:'prediction-signal',dataSnapshotId:'prediction-snapshot',accountId:'ai-runner:r',runnerId:'r'};
 const predictionSignal={id:'prediction-signal',runnerId:'r',accountId:'ai-runner:r',orderId:prediction.id,market:'prediction',instrument:prediction.instrumentId,at:'2026-10-08T00:00:01Z',snapshotIds:['prediction-snapshot'],decision:{id:'prediction-signal',runnerId:'r',orderId:prediction.id,market:'prediction',instrument:'EVENT-1',action:'BUY',side:'YES'}};
 const predictionSnapshot={id:'prediction-snapshot',market:'prediction',instrument:prediction.instrumentId,at:'2026-10-08T00:00:01Z'},predictionRefs={signal:()=>predictionSignal,snapshot:()=>predictionSnapshot};
 const predictionLedger={orders:[],runnerAccounts:{'ai-runner:r':{accountId:'ai-runner:r',runnerId:'r',orders:[prediction]}}};
 const valid=paperChartLineage(predictionLedger,'prediction',prediction.instrumentId,undefined,predictionRefs);
 assert.equal(valid.markers.length,1);assert.equal(valid.markers[0].outcome,'YES');
 const wrongSide={...prediction,side:'NO'};
 assert.equal(paperChartLineage({...predictionLedger,runnerAccounts:{'ai-runner:r':{...predictionLedger.runnerAccounts['ai-runner:r'],orders:[wrongSide]}}},'prediction',prediction.instrumentId,undefined,predictionRefs).unlinked.length,1);
 const close={...prediction,id:'prediction-close',side:'SELL',outcome:'NO',signalId:'prediction-close-signal',dataSnapshotId:'prediction-close-snapshot'};
 const closeSignal={...predictionSignal,id:close.signalId,orderId:close.id,snapshotIds:[close.dataSnapshotId],decision:{...predictionSignal.decision,id:close.signalId,orderId:close.id,action:'SELL',side:'NO'}};
 const closeRefs={signal:()=>closeSignal,snapshot:()=>({...predictionSnapshot,id:close.dataSnapshotId})};
 assert.equal(paperChartLineage({...predictionLedger,runnerAccounts:{'ai-runner:r':{...predictionLedger.runnerAccounts['ai-runner:r'],orders:[close]}}},'prediction',prediction.instrumentId,undefined,closeRefs).markers[0].outcome,'NO');
 assert.equal(paperChartLineage({...predictionLedger,runnerAccounts:{'ai-runner:r':{...predictionLedger.runnerAccounts['ai-runner:r'],orders:[{...close,outcome:'YES'}]}}},'prediction',prediction.instrumentId,undefined,closeRefs).unlinked.length,1);
});
test('chart lineage selects only exact market and identity, preserving unlinked legacy orders',()=>{
 const fs=require('node:fs');assert.ok(fs.existsSync('src/features/paper-chart-lineage.ts'),'lineage projection missing');
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const base={id:'o1',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:1,timestamp:'2026-10-08T00:00:00Z',signalId:'s1',dataSnapshotId:'d1',accountId:'a1',runnerId:'r1',feeUsd:1};
 const runner={...base,id:'runner',signalId:'s2',dataSnapshotId:'d2',accountId:'a2',runnerId:'r2'};
 const ledger={orders:[],runnerAccounts:{a1:{accountId:'a1',runnerId:'r1',orders:[base,{...base,id:'legacy',signalId:undefined},{...base,id:'other',instrumentId:'stock:us:MU'},{...base,id:'crypto',instrumentType:'crypto'}]},a2:{accountId:'a2',runnerId:'r2',orders:[runner]}}};
 const refs={signal:id=>id==='s1'?({id:'s1',runnerId:'r1',accountId:'a1',orderId:'o1',market:'stocks',instrument:base.instrumentId,at:base.timestamp,snapshotIds:['d1'],decision:{id:'s1',runnerId:'r1',orderId:'o1',market:'stocks',instrument:'AAPL',action:'BUY'}}):({id:'s2',runnerId:'r2',accountId:'a2',orderId:'runner',market:'stocks',instrument:base.instrumentId,at:base.timestamp,snapshotIds:['d2'],decision:{id:'s2',runnerId:'r2',orderId:'runner',market:'stocks',instrument:'AAPL',action:'BUY'}}),snapshot:id=>({id,market:'stocks',instrument:base.instrumentId,at:base.timestamp})};
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

test('explicit research signal and evidence IDs can link a main-ledger fill without runner-only decision fields',()=>{
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const order={id:'manual-fill',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:101,quantity:2,timestamp:'2026-10-08T00:02:00Z',signalId:'research-signal',dataSnapshotId:'evidence-snapshot',feeUsd:0.4};
 const signal={id:'research-signal',market:'stocks',instrument:order.instrumentId,at:'2026-10-08T00:00:00Z',snapshotIds:['evidence-snapshot'],action:'BUY'};
 const snapshot={id:'evidence-snapshot',market:'stocks',instrument:order.instrumentId,at:'2026-10-08T00:01:00Z',retrievedAt:'2026-10-08T00:01:10Z'};
 const ledger={orders:[order],runnerAccounts:{}};
 const result=paperChartLineage(ledger,'stocks',order.instrumentId,undefined,{signal:id=>id===signal.id?signal:null,snapshot:id=>id===snapshot.id?snapshot:null});
 assert.equal(result.markers.length,1);assert.equal(result.markers[0].orderId,order.id);assert.equal(result.markers[0].signalId,signal.id);assert.equal(result.markers[0].snapshotId,snapshot.id);assert.equal(result.markers[0].accountId,'unified-paper-ledger');assert.equal(result.markers[0].feeUsd,0.4);
});

test('generic research references still reject mismatched action, instrument, or evidence retrieval after the fill',()=>{
 const {paperChartLineage}=require('../src/features/paper-chart-lineage');
 const order={id:'manual-fill',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:101,quantity:2,timestamp:'2026-10-08T00:02:00Z',signalId:'research-signal',dataSnapshotId:'evidence-snapshot'};
 const signal={id:'research-signal',market:'stocks',instrument:order.instrumentId,at:'2026-10-08T00:00:00Z',snapshotIds:['evidence-snapshot'],action:'BUY'};
 const snapshot={id:'evidence-snapshot',market:'stocks',instrument:order.instrumentId,at:'2026-10-08T00:01:00Z',retrievedAt:'2026-10-08T00:01:10Z'};
 const ledger={orders:[order],runnerAccounts:{}};
 for(const refs of [
  {signal:id=>({...signal,action:'SELL'}),snapshot:()=>snapshot},
  {signal:()=>({...signal,instrument:'stock:us:MU'}),snapshot:()=>snapshot},
  {signal:()=>signal,snapshot:()=>({...snapshot,retrievedAt:'2026-10-08T00:03:00Z'})},
  {signal:()=>({...signal,snapshotIds:['other-snapshot']}),snapshot:()=>snapshot},
 ]){const result=paperChartLineage(ledger,'stocks',order.instrumentId,undefined,refs);assert.equal(result.markers.length,0);assert.equal(result.unlinked.length,1);}
});
