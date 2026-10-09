const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('ts-node/register/transpile-only');
function load(){assert.ok(fs.existsSync(path.join(__dirname,'../src/features/ai-comparison-watchlist.ts')),'缺少冻结自选身份选择器');return require('../src/features/ai-comparison-watchlist');}
test('automatic universe freezes pinned administrator stocks before existing order and reports capacity exclusions',()=>{
 const {selectComparisonWatchlist}=load(),refs=Array.from({length:7},(_,n)=>({id:'stock:us:S'+n,type:'stock',venue:'us',symbol:'S'+n,title:'S'+n,aliases:[]}));
 const selected=selectComparisonWatchlist('stocks',refs.map(r=>r.id),[refs[6].id],id=>refs.find(r=>r.id===id));
 assert.deepEqual(selected.instruments.map(r=>r.symbolOrMarketId),['S6','S0','S1','S2','S3']);
 assert.deepEqual(selected.excluded.map(r=>r.instrument),['stock:us:S4','stock:us:S5']);
 assert.match(selected.excluded[0].reason,/容量/);
});
test('unresolved identity and unsupported trading venue are explicit exclusions, never converted to another market or venue',()=>{
 const {selectComparisonWatchlist}=load(),rows=[{id:'crypto:gateio:BTC_USDT',type:'crypto',venue:'gateio',symbol:'BTC_USDT',title:'BTC',aliases:[]},{id:'crypto:binance:BTCUSDT',type:'crypto',venue:'binance',symbol:'BTCUSDT',title:'BTC',aliases:[]}];
 const selected=selectComparisonWatchlist('crypto',['unknown',...rows.map(r=>r.id)],[],id=>rows.find(r=>r.id===id));
 assert.deepEqual(selected.instruments.map(r=>r.symbolOrMarketId),['BTCUSDT']);assert.equal(selected.excluded.length,2);
 assert.match(selected.excluded[0].reason,/身份/);assert.match(selected.excluded[1].reason,/交易场所/);
 const other=selectComparisonWatchlist('stocks',rows.map(r=>r.id),[],id=>rows.find(r=>r.id===id));assert.equal(other.instruments.length,0);
});
test('legacy aliases cannot duplicate a canonical security in the frozen universe',()=>{
 const {selectComparisonWatchlist}=load(),ref={id:'stock:us:AAPL',type:'stock',venue:'us',symbol:'AAPL',title:'Apple',aliases:['usAAPL']};
 const selected=selectComparisonWatchlist('stocks',['usAAPL','stock:us:AAPL'],[],()=>ref);
 assert.equal(selected.instruments.length,1);assert.match(selected.excluded[0].reason,/重复/);
});
test('automatic options comparison accepts only exact Deribit BTC/ETH contracts supported by the runner',()=>{
 const {selectComparisonWatchlist}=load(),rows=[
  {id:'option:deribit:BTC-19OCT26-65000-C',type:'option',venue:'deribit',symbol:'BTC-19OCT26-65000-C',title:'BTC call',aliases:[]},
  {id:'option:cboe:SPY-20270115-500-C',type:'option',venue:'cboe',symbol:'SPY-20270115-500-C',title:'SPY call',aliases:[]},
  {id:'option:deribit:BTC-PERPETUAL',type:'option',venue:'deribit',symbol:'BTC-PERPETUAL',title:'BTC perpetual',aliases:[]},
 ];
 const selected=selectComparisonWatchlist('options',rows.map(row=>row.id),[],id=>rows.find(row=>row.id===id));
 assert.deepEqual(selected.instruments.map(row=>row.symbolOrMarketId),['BTC-19OCT26-65000-C']);
 assert.equal(selected.instruments[0].venue,'Options');
 assert.equal(selected.excluded.length,2);
 assert.ok(selected.excluded.every(row=>/Deribit|期权/.test(row.reason)));
});
