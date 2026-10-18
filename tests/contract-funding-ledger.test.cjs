const test=require('node:test'),assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
const {reviewContractPositionCosts}=require('../src/features/contract-panel-history');
const instrument='crypto:gateio:BTC_USDT', now=Date.parse('2026-10-13T00:00:00Z');
const base={market:'crypto',instrument,accountId:'main',orders:[],history:{instrument,rows:[]},funding:[],now};
const settlement=(overrides={})=>({id:'fund-1',accountId:'main',market:'crypto',instrument,source:'Gate account funding statement',settledAt:'2026-10-12T08:00:00Z',currency:'USDT',amount:-2,amountConvention:'cash-credit-positive',status:'verified',evidenceRef:'statement-1',...overrides});
test('holding-cost UI never relabels USD ledger fees as USDT funding cash',()=>{
 const ui=require('node:fs').readFileSync('src/web/public/contracts-workspace.js','utf8');assert.ok(ui.includes("number(l.feeUsd))+' USD ·"));assert.ok(ui.includes("number(l.slippageUsd))+' USD ·"));assert.ok(ui.includes('不将USD费用与USDT资金现金流直接相加'));
});
test('holding-cost UI includes explicit price attribution and linked order IDs rather than inferred net returns',()=>{
 const ui=require('node:fs').readFileSync('src/web/public/contracts-workspace.js','utf8');assert.match(ui,/data-contract-attribution/);assert.match(ui,/recordedPricePnlUsd/);assert.match(ui,/priceOrderIds/);assert.match(ui,/unlinkedAccountOrders/);
});
test('actual funding uses explicit account cash flows, deduplicates IDs, and keeps assumptions separate',()=>{
 const records=[settlement(),settlement(),settlement({id:'fund-2',amount:1,settledAt:'2026-10-12T16:00:00Z'}),settlement({id:'other',accountId:'ai-runner:other',amount:-90})];
 const result=reviewContractPositionCosts({...base,fundingSettlements:records});
 assert.equal(result.funding.paidCostUSDT,1);
 assert.equal(result.funding.paidCostUsd,null,'USDT must not be silently converted to USD');
 assert.equal(result.funding.settlementCount,2);
 assert.equal(result.funding.cashFlowUSDT,-1);
 assert.deepEqual(result.funding.evidenceRefs,['statement-1']);
 assert.equal(result.funding.observationCount,0);
});
test('conflicting identities and unverified/future/wrong-unit cash flows never become actual funding',()=>{
 for(const change of [{status:'estimated'},{currency:'BTC'},{market:'stocks'},{instrument:'crypto:gateio:ETH_USDT'},{evidenceRef:''},{amount:null},{amount:true},{amountConvention:'expense-positive'},{settledAt:'2026-10-14T00:00:00Z'}]){
  const result=reviewContractPositionCosts({...base,fundingSettlements:[settlement(change)]});
  assert.equal(result.funding.paidCostUSDT,null,JSON.stringify(change));
 }
 const conflict=reviewContractPositionCosts({...base,fundingSettlements:[settlement(),settlement({amount:-3})]});
 assert.equal(conflict.funding.paidCostUSDT,null);
 assert.match(conflict.funding.reason,/冲突/);
});
test('period windows include no future settlement and missing account cannot infer ownership',()=>{
 const result=reviewContractPositionCosts({...base,from:'2026-10-12T12:00:00Z',fundingSettlements:[settlement(),settlement({id:'two',amount:-3,settledAt:'2026-10-12T16:00:00Z'})]});
 assert.equal(result.funding.paidCostUSDT,3);
 const unknown=reviewContractPositionCosts({...base,accountId:undefined,fundingSettlements:[settlement()]});
 assert.equal(unknown.funding.paidCostUSDT,null);
});
test('overflowed settlement totals are unavailable rather than a finite or fabricated zero expense',()=>{
 const result=reviewContractPositionCosts({...base,fundingSettlements:[settlement({amount:1e308}),settlement({id:'overflow',amount:1e308})]});
 assert.equal(result.funding.paidCostUSDT,null);
 assert.equal(result.funding.settlementStatus,'partial');
});
test('invalid private account fails before any source request or history archive',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),source=fs.readFileSync('src/web/server.ts','utf8');
 const start=source.indexOf("app.get('/api/contracts/holding-cost'"),end=source.indexOf("app.post('/api/contracts/scenario'",start);
 assert.ok(start>=0&&end>start);let handler,requests=0,archives=0,status=200,body;
 const context={app:{get:(route,fn)=>handler=fn},adminOnly:()=>true,contractIdentity:()=>({}),unifiedPaperLedgerStore:{getAccount:()=>null},contractResearchService:{detail:async()=>{requests++;return {dataStatus:'cached',funding:[],sections:{}};}},dataLakeCatalog:{queryContractMetrics:async()=>{archives++;return {instrument,rows:[]};}},reviewContractPositionCosts};
 vm.runInNewContext(ts.transpile(source.slice(start,end)),context);
 const res={status:(value)=>{status=value;return res;},json:(value)=>{body=value;return res;}};
 await handler({query:{market:'crypto',instrument,accountId:'missing'}},res);
 assert.equal(status,400);assert.match(body.reason,/账户/);assert.equal(requests,0);assert.equal(archives,0);
});
