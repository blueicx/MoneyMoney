const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const annual=(val,extra={})=>({start:'2025-01-01',end:'2025-12-31',filed:'2026-02-15',form:'10-K',fp:'FY',val,accn:'same-filing',...extra});
function facts(){return {facts:{'us-gaap':{NetCashProvidedByUsedInOperatingActivities:{units:{USD:[annual(200)]}},NetIncomeLoss:{units:{USD:[annual(100)]}},WeightedAverageNumberOfDilutedSharesOutstanding:{units:{shares:[annual(50)]}},EarningsPerShareDiluted:{units:{'USD/shares':[annual(2)]}},CommonStockSharesOutstanding:{units:{shares:[annual(99,{start:undefined})]}}}}};}
test('per-share bridge uses exact annual weighted diluted shares and same filing, not ending shares',()=>{
 const {buildCapitalHistory}=require('../src/features/stock-capital-history');const point=buildCapitalHistory(facts(),'2026-03-01T00:00:00Z').points[0];
 assert.ok(point.perShareBridge,'per-share financial bridge');assert.equal(point.perShareBridge.netIncomeUsd.value,100);assert.equal(point.perShareBridge.weightedDilutedShares.value,50);assert.equal(point.perShareBridge.impliedIncomePerDilutedShare,2);assert.equal(point.perShareBridge.reportedDilutedEps.value,2);assert.equal(point.perShareBridge.epsDifference,0);assert.equal(point.shares.value,99);
 assert.match(point.perShareBridge.reason,/加权|期末/);assert.equal(point.perShareBridge.dataStatus,'historical');
});
test('per-share bridge withholds ratios for missing units, mismatched filings, conflicting or future facts',()=>{
 const {buildCapitalHistory}=require('../src/features/stock-capital-history');
 for(const mutate of [f=>f.NetIncomeLoss.units={EUR:[annual(100)]},f=>f.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares[0].accn='other',f=>f.NetIncomeLoss.units.USD.push(annual(999)),f=>f.NetIncomeLoss.units.USD[0].filed='2027-01-01',f=>f.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares[0].val=0]){
  const input=facts();mutate(input.facts['us-gaap']);const bridge=buildCapitalHistory(input,'2026-03-01T00:00:00Z').points[0].perShareBridge;assert.ok(bridge);assert.equal(bridge.impliedIncomePerDilutedShare,null);assert.equal(bridge.dataStatus,'partial');
 }
});
test('reported EPS disagreement remains visible and is not silently reconciled',()=>{
 const {buildCapitalHistory}=require('../src/features/stock-capital-history'),input=facts();input.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'][0].val=1.8;
 const bridge=buildCapitalHistory(input,'2026-03-01T00:00:00Z').points[0].perShareBridge;assert.ok(bridge);assert.ok(Math.abs(bridge.epsDifference-.2)<1e-8);assert.equal(bridge.dataStatus,'partial');assert.match(bridge.reason,/不等|差异/);
});
test('financial workspace exposes the bridge and exact filing references without injecting source HTML',()=>{
 const fs=require('node:fs'),{JSDOM}=require('jsdom'),source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=source.indexOf('function renderStockCapitalHistory('),end=source.indexOf('function renderFundamentalQuality(',start);
 const dom=new JSDOM('<section id="host"></section>',{runScripts:'outside-only'}),w=dom.window;w.stockEscapeHtml=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');w.eval(source.slice(start,end));
 const input=facts();input.facts['us-gaap'].NetIncomeLoss.units.USD[0].accn='<script>fixture</script>';const history=require('../src/features/stock-capital-history').buildCapitalHistory(input,'2026-03-01T00:00:00Z');
 w.renderStockCapitalHistory(w.document.getElementById('host'),{symbol:'AAPL',capitalHistory:history});assert.ok(w.document.querySelector('[data-per-share-bridge]'));assert.match(w.document.body.textContent,/加权稀释股数/);assert.match(w.document.body.textContent,/same-filing/);assert.equal(w.document.querySelector('script'),null);assert.equal(w.document.querySelector('table').style.minWidth,'1050px','financial columns must scroll, not collapse into single characters');dom.window.close();
});
