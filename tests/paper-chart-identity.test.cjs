require('ts-node/register/transpile-only');
const test=require('node:test'),assert=require('node:assert/strict');
const {resolvePaperChartInstrument}=require('../src/features/paper-chart-lineage');
test('chart lineage resolves explicit persisted runner identities without a data-lake partition',()=>{
 const ledger={orders:[],runnerAccounts:{runner:{accountId:'ai-runner:r',runnerId:'r',orders:[{instrumentType:'stock',instrumentId:'stock:us:MU'},{instrumentType:'stock',instrumentId:'stock:us:SNDK'}]}}};
 for(const symbol of ['MU','SNDK'])assert.equal(resolvePaperChartInstrument(ledger,'stocks','stock:us:'+symbol), 'stock:us:'+symbol);
 for(const query of ['MU','usMU','stock:nyse:MU','crypto:binance:MU','stock::MU'])assert.equal(resolvePaperChartInstrument(ledger,'stocks',query),null);
 assert.equal(resolvePaperChartInstrument(ledger,'stocks','stock:us:AAPL'),'stock:us:AAPL');
 assert.equal(resolvePaperChartInstrument(ledger,'crypto','stock:us:MU'),null);
});
test('ledger identity resolution requires matching explicit order type and retains registered alias resolution',()=>{
 const ledger={orders:[{instrumentType:'stock',instrumentId:'option:cboe:AAPL-contract'},{instrumentType:'crypto',instrumentId:'crypto:gateio:BTC_USDT'},{instrumentType:'prediction',instrumentId:'prediction:predictfun:event-42'}]};
 assert.equal(resolvePaperChartInstrument(ledger,'options','option:cboe:AAPL-contract'),null);
 assert.equal(resolvePaperChartInstrument(ledger,'crypto','crypto:gateio:BTC_USDT'),'crypto:gateio:BTC_USDT');
 assert.equal(resolvePaperChartInstrument(ledger,'prediction','prediction:predictfun:event-42'),'prediction:predictfun:event-42');
 assert.equal(resolvePaperChartInstrument(ledger,'stocks','usAAPL',(_,query)=>query==='usAAPL'?{id:'stock:us:AAPL'}:null),'stock:us:AAPL');
 assert.equal(resolvePaperChartInstrument(ledger,'stocks','AAPL','crypto:binance:AAPL'),null);
});
