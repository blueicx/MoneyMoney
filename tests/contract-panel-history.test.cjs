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
 const detail={instrument:'crypto:gateio:BTC_USDT',series:{openInterest:{kind:'snapshot',value:10,unit:'USDT'},basis:{kind:'snapshot',value:.2,unit:'%'}}},history={instrument:detail.instrument,dataStatus:'historical',timeBasis:'retrievedAt',reason:'真实抓取时点',rows:[{retrievedAt:'2026-10-01T00:00:00Z',openInterestUsd:10,basisPct:null,evidenceRef:'p1',source:'Gate verified source'},{retrievedAt:'2026-10-01T01:00:00Z',openInterestUsd:20,basisPct:.2,evidenceRef:'p2',source:'Gate verified source'}]};
 const result=withContractPanelHistory(detail,history,['openInterest','basis']);assert.equal(result.series.openInterest.points.length,2);assert.equal(result.series.basis.points.length,1);assert.equal(result.series.basis.dataStatus,'partial');assert.match(result.series.basis.reason,/1/);assert.equal(result.series.openInterest.timeBasis,'retrievedAt');assert.equal(result.series.openInterest.points[0].evidenceRef,'p1');assert.equal(result.series.openInterest.sourceTime,undefined);assert.equal(result.series.openInterest.coverage.maxObservedGapMs,3600000);assert.equal(result.series.openInterest.source,'Gate verified source');assert.equal(detail.series.openInterest.kind,'snapshot');
 assert.throws(()=>withContractPanelHistory(detail,{...history,instrument:'crypto:gateio:ETH_USDT'},['openInterest']));
});
test('contract metric series never mixes providers and reports sampled coverage gaps',()=>{
 const {withContractPanelHistory}=require('../src/features/contract-panel-history'),instrument='crypto:gateio:BTC_USDT';
 const detail={instrument,series:{openInterest:{kind:'snapshot'},basis:{kind:'snapshot'}}};
 const rows=[{retrievedAt:'2026-10-01T00:00:00Z',openInterestUsd:10,basisPct:.1,evidenceRef:'old',source:'provider-old'},{retrievedAt:'2026-10-01T01:00:00Z',openInterestUsd:20,basisPct:.2,evidenceRef:'new-1',source:'provider-new'},{retrievedAt:'2026-10-01T04:00:00Z',openInterestUsd:30,basisPct:.3,evidenceRef:'new-2',source:'provider-new'}];
 const result=withContractPanelHistory(detail,{instrument,rows,dataStatus:'historical',reason:'snapshot archive'},['openInterest','basis']);
 assert.deepEqual(result.series.openInterest.points.map(point=>point.evidenceRef),['new-1','new-2']);
 assert.equal(result.series.openInterest.source,'provider-new');
 assert.equal(result.series.openInterest.coverage.maxObservedGapMs,3*3600000);
 assert.match(result.series.openInterest.reason,/来源切换/);
});
test('no archives never becomes a fabricated curve and unselected panels remain unchanged',()=>{
 assert.ok(fs.existsSync('src/features/contract-panel-history.ts'));const {withContractPanelHistory}=require('../src/features/contract-panel-history');const detail={instrument:'crypto:gateio:BTC_USDT',series:{openInterest:{kind:'snapshot',value:10},basis:{kind:'snapshot',value:.2}}};const result=withContractPanelHistory(detail,{instrument:detail.instrument,dataStatus:'empty',rows:[],reason:'尚无归档'},['openInterest']);assert.equal(result.series.openInterest.points.length,0);assert.equal(result.series.openInterest.dataStatus,'empty');assert.match(result.series.openInterest.reason,/尚无归档/);assert.strictEqual(result.series.basis,detail.series.basis);
});
