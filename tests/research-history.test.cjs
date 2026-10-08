const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mod = fs.existsSync('dist/features/portfolio-history.js') ? require('../dist/features/portfolio-history.js') : {};
const bars = (values) => values.map((close, i) => ({ timestamp:`2026-09-${String(20+i).padStart(2,'0')}T20:00:00Z`,close }));
test('historical assembly rejects cross-market and unsupported-venue fallback', async () => {
  assert.equal(typeof mod.assembleHistory, 'function');
  const catalog = { queryBarsAsOf: async () => { throw Error('must not query another venue'); }, listCorporateActions: () => [] };
  await assert.rejects(()=>mod.assembleHistory(catalog,'stocks',['crypto:binance:BTCUSDT'],'2026-09-30T00:00:00Z'), /market|市场/);
  const result = await mod.assembleHistory(catalog,'crypto',['crypto:gate_io:BTC_USDT'],'2026-09-30T00:00:00Z');
  assert.equal(result.series[0].dataStatus,'unsupported');
});
test('comparison aligns dates and retains invalid-price gaps instead of averaging or filling', async () => {
  assert.equal(typeof mod.assembleHistory, 'function');
  const catalog={queryBarsAsOf:async({instrument})=>({ rows:bars(instrument==='AAPL'?[100,110,null,121]:[200,220,230,240]),source:'test actual partition',snapshot:{id:instrument,contentHash:instrument},updatedAt:'2026-09-25T00:00:00Z' }),listCorporateActions:()=>[]};
  const result=await mod.assembleHistory(catalog,'stocks',['stock:us:AAPL','stock:us:MU'],'2026-09-30T00:00:00Z');
  assert.equal(result.series[0].points[1].value,10);
  assert.equal(result.series[0].points[2].value,null);
  assert.equal(result.series[0].datedReturns.length,1);
  assert.ok(result.evidenceRefs.includes('AAPL'));
});
test('corporate actions with unknown adjustment prevent misleading returns', async()=>{
  assert.equal(typeof mod.assembleHistory,'function');
  const catalog={queryBarsAsOf:async()=>({rows:bars([100,50,55]),source:'unadjusted source'}),listCorporateActions:()=>[{id:'split',market:'stocks',instrument:'AAPL',kind:'split',factor:2,effectiveAt:'2026-09-21T00:00:00Z',observedAt:'2026-09-21T00:00:00Z',source:'test'}]};
  const result=await mod.assembleHistory(catalog,'stocks',['stock:us:AAPL'],'2026-09-30T00:00:00Z');
  assert.equal(result.series[0].dataStatus,'unavailable');
  assert.match(result.series[0].reason,/公司行动|复权/);
});
test('point-in-time history hides a corporate action before its first observation and blocks unverified conversion after', async()=>{
 const {assembleHistory}=require('../dist/features/portfolio-history.js');
 const action={id:'yahoo-split',market:'stocks',instrument:'AAPL',kind:'split',factor:2,effectiveAt:'2026-09-21T00:00:00Z',observedAt:'2026-10-01T00:00:00Z',source:'Yahoo Finance chart events'};
 const catalog={queryBarsAsOf:async()=>({rows:bars([100,50,55]),source:'yahoo-finance-history',adjustment:'unknown'}),listCorporateActions:()=>[action]};
 const before=await assembleHistory(catalog,'stocks',['stock:us:AAPL'],'2026-09-30T00:00:00Z');
 assert.deepEqual(before.series[0].corporateActions,[]);
 const after=await assembleHistory(catalog,'stocks',['stock:us:AAPL'],'2026-10-02T00:00:00Z');
 assert.equal(after.series[0].corporateActions[0].observedAt,action.observedAt);
 assert.equal(after.series[0].dataStatus,'unavailable');
 assert.match(after.series[0].reason,/公司行动|复权/);
});
test('point-in-time history omits legacy corporate actions with missing or invalid knowledge timestamps',async()=>{
 const {assembleHistory}=require('../dist/features/portfolio-history.js');
 const actions=[
  {id:'legacy-unknown',market:'stocks',instrument:'AAPL',kind:'split',factor:2,effectiveAt:'2026-09-21T00:00:00Z',source:'legacy'},
  {id:'invalid-time',market:'stocks',instrument:'AAPL',kind:'split',factor:2,effectiveAt:'2026-09-22T00:00:00Z',publishedAt:'not-a-date',source:'legacy'},
 ];
 const catalog={queryBarsAsOf:async()=>({rows:bars([100,50,55]),source:'yahoo-finance-history',adjustment:'unknown'}),listCorporateActions:()=>actions};
 const result=await assembleHistory(catalog,'stocks',['stock:us:AAPL'],'2026-10-02T00:00:00Z');
 assert.deepEqual(result.series[0].corporateActions,[]);
});
test('legacy bare symbols resolve only through verified market registry and unresolved rows remain unavailable',async()=>{
 const {assembleHistory}=require('../dist/features/portfolio-history.js');
 const catalog={resolveInstrument:(market,id)=>id==='AAPL'?{id:'stock:us:AAPL'}:null,queryBarsAsOf:async()=>({rows:[],source:null}),listCorporateActions:()=>[]};
 const result=await assembleHistory(catalog,'stocks',['AAPL','unknown'],new Date().toISOString());
 assert.equal(result.series[0].instrument,'AAPL');assert.match(result.series[1].reason,/身份/);
});
