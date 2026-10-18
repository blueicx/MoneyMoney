const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const now='2026-10-01T12:00:00Z',instrument='crypto:gateio:BTC_USDT';
const order=(id,side,pnlUsd)=>({id,accountId:'main',instrumentId:instrument,instrumentType:'crypto',side,timestamp:'2026-10-01T11:00:00Z',pnlUsd,feeUsd:1,slippageUsd:.5});
test('contract attribution shows explicit recorded price PnL and costs without converting funding currency or guessing paired trades',()=>{
 const {reviewContractCostAttribution}=require('../src/features/contract-cost-attribution');assert.equal(typeof reviewContractCostAttribution,'function');
 const out=reviewContractCostAttribution({accountId:'main',instrument,orders:[order('buy','BUY'),order('sell','SELL',10)],asOf:now});
 assert.equal(out.recordedPricePnlUsd,10);assert.equal(out.recordedFeesUsd,2);assert.equal(out.recordedSlippageUsd,1);assert.equal(out.totalNetPnl,null);assert.equal(out.dataStatus,'historical');assert.deepEqual(out.priceOrderIds,['sell']);assert.match(out.reason,/USDT|汇率/);
});
test('unassigned legacy account rows stay unlinked instead of disappearing or being attributed to main',()=>{
 const {reviewContractCostAttribution}=require('../src/features/contract-cost-attribution');
 const legacy={...order('legacy','SELL',400),accountId:undefined};
 const out=reviewContractCostAttribution({accountId:'main',instrument,orders:[legacy],asOf:now});
 assert.equal(out.unlinkedAccountOrders,1);assert.equal(out.recordedPricePnlUsd,null);assert.equal(out.dataStatus,'partial');assert.deepEqual(out.priceOrderIds,[]);
});
test('existing cost review exposes explicit price attribution inside the selected account and date window',()=>{
 const {reviewContractPositionCosts}=require('../src/features/contract-panel-history');
 const out=reviewContractPositionCosts({market:'crypto',instrument,accountId:'main',orders:[order('sell','SELL',10),{...order('other','SELL',99),accountId:'other'},{...order('old','SELL',50),timestamp:'2026-09-01T00:00:00Z'}],history:{instrument,rows:[]},funding:[],from:'2026-10-01T00:00:00Z',to:now,now:Date.parse(now)});
 assert.equal(out.attribution.recordedPricePnlUsd,10);assert.deepEqual(out.attribution.priceOrderIds,['sell']);assert.equal(out.attribution.totalNetPnl,null);
});
test('legacy missing PnL, foreign accounts, duplicates and future orders are excluded with explicit incomplete coverage',()=>{
 const {reviewContractCostAttribution}=require('../src/features/contract-cost-attribution');assert.equal(typeof reviewContractCostAttribution,'function');
 const legacy=reviewContractCostAttribution({accountId:'main',instrument,orders:[order('old','SELL')],asOf:now});assert.equal(legacy.recordedPricePnlUsd,null);assert.equal(legacy.unlinkedPriceOrders,1);assert.equal(legacy.dataStatus,'partial');
 const a=order('a','SELL',10),foreign={...order('b','SELL',999),accountId:'other'},future={...order('future','SELL',777),timestamp:'2026-10-02T00:00:00Z'};
 const out=reviewContractCostAttribution({accountId:'main',instrument,orders:[a,a,foreign,future],asOf:now});assert.equal(out.recordedPricePnlUsd,null,'duplicate identities make the total ambiguous');assert.equal(out.conflicts,1);assert.equal(out.totalNetPnl,null);
});
