const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
test('archive read failure preserves successful quote and marks only requested history unavailable',async()=>{
 const {loadContractPanelHistory}=require('../src/features/contract-panel-history');
 const detail={instrument:'crypto:gateio:BTC_USDT',dataStatus:'delayed',quote:{last:60000},series:{openInterest:{kind:'snapshot',value:10},basis:{kind:'snapshot',value:.2}}};
 assert.equal(typeof loadContractPanelHistory,'function');
 const result=await loadContractPanelHistory(detail,['openInterest'],async()=>{throw Error('归档读取失败');});
 assert.equal(result.dataStatus,'delayed');assert.strictEqual(result.quote,detail.quote);
 assert.equal(result.series.openInterest.dataStatus,'unavailable');assert.deepEqual(result.series.openInterest.points,[]);assert.match(result.series.openInterest.reason,/归档读取失败/);assert.strictEqual(result.series.basis,detail.series.basis);
});
test('OI and basis history preserve partial fields, timestamps and evidence without interpolating gaps',()=>{
 assert.ok(fs.existsSync('src/features/contract-panel-history.ts'),'contract history adapter missing');const {withContractPanelHistory}=require('../src/features/contract-panel-history');
 const detail={instrument:'crypto:gateio:BTC_USDT',series:{openInterest:{kind:'snapshot',value:10,unit:'USDT'},basis:{kind:'snapshot',value:.2,unit:'%'}}},history={instrument:detail.instrument,dataStatus:'historical',timeBasis:'retrievedAt',units:{openInterestUsd:'USDT',basisPct:'%'},reason:'真实抓取时点',rows:[{retrievedAt:'2026-10-01T00:00:00Z',openInterestUsd:10,basisPct:null,units:{openInterestUsd:'USDT',basisPct:'%'},evidenceRef:'p1',source:'Gate verified source'},{retrievedAt:'2026-10-01T01:00:00Z',openInterestUsd:20,basisPct:.2,units:{openInterestUsd:'USDT',basisPct:'%'},evidenceRef:'p2',source:'Gate verified source'}]};
 const result=withContractPanelHistory(detail,history,['openInterest','basis']);assert.equal(result.series.openInterest.points.length,2);assert.equal(result.series.basis.points.length,1);assert.equal(result.series.basis.dataStatus,'partial');assert.match(result.series.basis.reason,/1/);assert.equal(result.series.openInterest.timeBasis,'retrievedAt');assert.equal(result.series.openInterest.points[0].evidenceRef,'p1');assert.equal(result.series.openInterest.sourceTime,undefined);assert.equal(result.series.openInterest.coverage.maxObservedGapMs,3600000);assert.equal(result.series.openInterest.source,'Gate verified source');assert.equal(detail.series.openInterest.kind,'snapshot');
 assert.throws(()=>withContractPanelHistory(detail,{...history,instrument:'crypto:gateio:ETH_USDT'},['openInterest']));
});
test('contract metric series never mixes providers and reports sampled coverage gaps',()=>{
 const {withContractPanelHistory}=require('../src/features/contract-panel-history'),instrument='crypto:gateio:BTC_USDT';
 const detail={instrument,series:{openInterest:{kind:'snapshot'},basis:{kind:'snapshot'}}};
 const units={openInterestUsd:'USDT',basisPct:'%'},rows=[{retrievedAt:'2026-10-01T00:00:00Z',openInterestUsd:10,basisPct:.1,units,evidenceRef:'old',source:'provider-old'},{retrievedAt:'2026-10-01T01:00:00Z',openInterestUsd:20,basisPct:.2,units,evidenceRef:'new-1',source:'provider-new'},{retrievedAt:'2026-10-01T04:00:00Z',openInterestUsd:30,basisPct:.3,units,evidenceRef:'new-2',source:'provider-new'}];
 const result=withContractPanelHistory(detail,{instrument,rows,dataStatus:'historical',units:{openInterestUsd:'USDT',basisPct:'%'},reason:'snapshot archive'},['openInterest','basis']);
 assert.deepEqual(result.series.openInterest.points.map(point=>point.evidenceRef),['new-1','new-2']);
 assert.equal(result.series.openInterest.source,'provider-new');
 assert.equal(result.series.openInterest.coverage.maxObservedGapMs,3*3600000);
 assert.match(result.series.openInterest.reason,/来源切换/);
 });
test('contract history with missing or mismatched units is not plotted',()=>{
 const {withContractPanelHistory}=require('../src/features/contract-panel-history'),instrument='crypto:gateio:BTC_USDT';
 const detail={instrument,series:{openInterest:{kind:'snapshot',unit:'USDT'},basis:{kind:'snapshot',unit:'%'}}};
 const base={instrument,dataStatus:'historical',rows:[{retrievedAt:'2026-10-01T00:00:00Z',openInterestUsd:10,basisPct:.2,units:{openInterestUsd:'USDT',basisPct:'%'},source:'Gate public API'}]};
 const result=withContractPanelHistory(detail,{...base,rows:base.rows.map(row=>({...row,units:{openInterestUsd:'BTC',basisPct:'fraction'}}))},['openInterest','basis']);
 assert.equal(result.series.openInterest.dataStatus,'unavailable');assert.deepEqual(result.series.openInterest.points,[]);assert.match(result.series.openInterest.reason,/单位/);
 assert.equal(result.series.basis.dataStatus,'unavailable');assert.deepEqual(result.series.basis.points,[]);assert.match(result.series.basis.reason,/单位/);
 const missing=withContractPanelHistory(detail,{...base,rows:base.rows.map(({units,...row})=>row)},['openInterest']);assert.equal(missing.series.openInterest.dataStatus,'unavailable');assert.deepEqual(missing.series.openInterest.points,[]);
});
test('no archives never becomes a fabricated curve and unselected panels remain unchanged',()=>{
 assert.ok(fs.existsSync('src/features/contract-panel-history.ts'));const {withContractPanelHistory}=require('../src/features/contract-panel-history');const detail={instrument:'crypto:gateio:BTC_USDT',series:{openInterest:{kind:'snapshot',value:10},basis:{kind:'snapshot',value:.2}}};const result=withContractPanelHistory(detail,{instrument:detail.instrument,dataStatus:'empty',rows:[],reason:'尚无归档'},['openInterest']);assert.equal(result.series.openInterest.points.length,0);assert.equal(result.series.openInterest.dataStatus,'empty');assert.match(result.series.openInterest.reason,/尚无归档/);assert.strictEqual(result.series.basis,detail.series.basis);
});
test('holding cost review uses only exact-contract ledger rows and leaves unrecorded funding cost unknown',()=>{
 const {reviewContractPositionCosts}=require('../src/features/contract-panel-history');
 const instrument='crypto:gateio:BTC_USDT',orders=[
  {instrumentId:instrument,instrumentType:'crypto',side:'BUY',quantity:1,price:100,timestamp:'2026-10-01T00:00:00Z',feeUsd:1,slippageUsd:.5},
  {instrumentId:instrument,instrumentType:'crypto',side:'SELL',quantity:1,price:110,timestamp:'2026-10-02T00:00:00Z',feeUsd:1.1,slippageUsd:.6},
  {instrumentId:'crypto:gateio:ETH_USDT',instrumentType:'crypto',side:'BUY',quantity:2,price:20,timestamp:'2026-10-01T00:00:00Z',feeUsd:90,slippageUsd:90},
  {instrumentId:instrument,instrumentType:'crypto',side:'BUY',quantity:1,price:100,timestamp:'2026-10-03T00:00:00Z'},
 ];
 const history={instrument,rows:[{retrievedAt:'2026-10-01T12:00:00Z',source:'Gate official',openInterestUsd:100,basisPct:.2,units:{openInterestUsd:'USDT',basisPct:'%'}}],coverage:{from:'2026-10-01T12:00:00Z',to:'2026-10-01T12:00:00Z',records:1}};
 const result=reviewContractPositionCosts({market:'crypto',instrument,orders,history,funding:[{at:'2026-10-01T08:00:00Z',ratePct:.01},{at:'2026-10-04T08:00:00Z',ratePct:.02}],now:Date.parse('2026-10-03T12:00:00Z')});
 assert.equal(result.ledger.orderCount,3);
 assert.equal(result.ledger.feeUsd,2.1);
 assert.equal(result.ledger.slippageUsd,1.1);
 assert.equal(result.ledger.incompleteCostOrders,1);
 assert.equal(result.funding.observationCount,1);
 assert.equal(result.funding.paidCostUsd,null,'funding-rate history is not an account settlement ledger');
 assert.match(result.funding.reason,/未记录逐笔资金结算/);
 assert.equal(result.history.openInterest.records,1);
 assert.equal(result.history.basis.records,1);
 assert.equal(result.history.openInterest.maxObservedGapMs,null,'a single sample has no interpolated gap');
 const partial=reviewContractPositionCosts({market:'crypto',instrument,orders,history:{...history,dataStatus:'partial',rows:[history.rows[0],{...history.rows[0],retrievedAt:'2026-10-02T12:00:00Z',openInterestUsd:120}]},funding:[],now:Date.parse('2026-10-03T12:00:00Z')});
 assert.equal(partial.history.openInterest.dataStatus,'partial','an incomplete archive remains partial even when two observations exist');
});
test('holding cost review rejects cross-market, instrument-mismatched history and invalid windows',()=>{
 const {reviewContractPositionCosts}=require('../src/features/contract-panel-history'),input={market:'crypto',instrument:'crypto:gateio:BTC_USDT',orders:[],history:{instrument:'crypto:gateio:BTC_USDT',rows:[]},funding:[],now:Date.parse('2026-10-03T12:00:00Z')};
 assert.throws(()=>reviewContractPositionCosts({...input,market:'stocks'}),/市场|身份/);
 assert.throws(()=>reviewContractPositionCosts({...input,history:{...input.history,instrument:'crypto:gateio:ETH_USDT'}}),/身份/);
 assert.throws(()=>reviewContractPositionCosts({...input,from:'2026-10-04T00:00:00Z',to:'2026-10-03T00:00:00Z'}),/区间/);
});
test('contract rule comparisons require exact identity/source and distinguish unknown legacy metadata from changes',()=>{
 const {compareArchivedContractRules}=require('../dist/features/contract-panel-history');
 const instrument='crypto:gateio:BTC_USDT',source='https://api.gateio.ws/api/v4/futures/usdt/contracts/BTC_USDT';
 const row=(at,values)=>({market:'crypto',instrument,source,retrievedAt:at,rulesJson:JSON.stringify(values),evidenceRef:at,contentHash:'saved'});
 const old={multiplier:.001,fundingIntervalSeconds:28800,settlementCurrency:'USDT',inDelisting:false,status:null};
 const rows=[row('2026-10-01T00:00:00Z',old),row('2026-10-02T00:00:00Z',{...old,fundingIntervalSeconds:14400}),row('2026-10-03T00:00:00Z',{...old,multiplier:.002}),{...row('2026-10-02T01:00:00Z',old),instrument:'crypto:gateio:ETH_USDT'}];
 const r=compareArchivedContractRules({instrument,rows,asOf:'2026-10-02T12:00:00Z'});
 assert.equal(r.changes.length,1);assert.equal(r.changes[0].fields[0].field,'fundingIntervalSeconds');assert.equal(r.changes[0].effectiveAt,null);assert.equal(r.changes[0].fields[0].before,28800);
 const unknown=compareArchivedContractRules({instrument,rows:[{...rows[0],rulesJson:undefined}]});assert.equal(unknown.dataStatus,'unavailable');assert.equal(unknown.changes.length,0);
});
test('contract workspace exposes observed rule changes only in its selected-contract panels',()=>{
 const source=require('node:fs').readFileSync('src/web/public/contracts-workspace.js','utf8');assert.match(source,/data-contract-rule-history/);assert.match(source,/result\.ruleHistory/);
});
