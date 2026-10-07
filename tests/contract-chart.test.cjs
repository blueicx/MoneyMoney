const test=require('node:test'),assert=require('node:assert/strict');
const {ContractResearchService}=require('../dist/features/contract-research');
test('contract chart fails closed on mismatched metadata and retains a source error through cache',async()=>{
  const wrong=new ContractResearchService(async path=>path.includes('/contracts/')?{name:'ETH_USDT',type:'direct'}:[]);
  const result=await wrong.chart('crypto:gateio:BTC_USDT');assert.equal(result.dataStatus,'unavailable');assert.equal(result.data.length,0);assert.equal(result.executionEnabled,false);
  const broken=new ContractResearchService(async()=>{throw Error('isolated upstream unavailable');});assert.equal((await broken.chart('crypto:gateio:BTC_USDT')).dataStatus,'unavailable');assert.equal((await broken.chart('crypto:gateio:BTC_USDT')).dataStatus,'unavailable');
});
test('delivery candles stay on delivery endpoints and negative contract volume is not accepted',async()=>{
  const paths=[],now=Date.now(),t=Math.floor(now/60000)*60;
  const svc=new ContractResearchService(async path=>{paths.push(path);return path.includes('/contracts/')?{name:'BTC_USDT_20261225',type:'direct'}:[{t,o:100,h:102,l:99,c:101,v:-1}];},()=>now);
  const result=await svc.chart('crypto:gateio-delivery:BTC_USDT_20261225','1m');assert.equal(result.dataStatus,'empty');assert.equal(result.data.length,0);assert.ok(paths.every(path=>path.startsWith('/delivery/usdt/')));await assert.rejects(async()=>svc.chart('stock:us:AAPL'));
});
test('contract chart uses its own venue identity and retains valid current OHLC with volume units',async()=>{const now=Date.now(),t=Math.floor(now/300000)*300;const paths=[];const svc=new ContractResearchService(async path=>{paths.push(path);if(path.includes('/contracts/'))return {name:'BTC_USDT',type:'direct',quanto_multiplier:'0.0001'};return [{t,o:'100',h:'102',l:'99',c:'101',v:'1000'},{t:t+300,o:'100',h:'102',l:'99',c:'101',v:'1000'},{t:t-300,o:'100',h:'90',l:'99',c:'101',v:'1000'}];},()=>now);assert.equal(typeof svc.chart,'function','current contract chart service must exist');const d=await svc.chart('crypto:gateio:BTC_USDT','5m');assert.equal(d.data.length,1);assert.equal(d.data[0].close,101);assert.equal(d.data[0].volume,1000);assert.equal(d.volumeUnit,'contracts');assert.equal(d.data[0].closed,false);assert.ok(paths.some(p=>p.includes('interval=5m')));await assert.rejects(async()=>svc.chart('crypto:binance:BTCUSDT','5m'));await assert.rejects(async()=>svc.chart('crypto:gateio:BTC_USDT','bogus'));assert.equal((await svc.chart('crypto:gateio:BTC_USDT','5m')).dataStatus,'cached');});
