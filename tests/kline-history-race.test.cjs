const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('src/web/public/index.html','utf8');
for(const market of ['crypto','stocks'])test(`${market} history accepts same-context live refresh but rejects a new selection`,async()=>{
 const crypto=market==='crypto',name=crypto?'loadEarlierCryptoKline':'loadEarlierStockKline';
 const start=html.indexOf('async function '+name+'('),end=html.indexOf('\n}',start)+2;
 const old={time:100,open:10,high:12,low:9,close:11,volume:1};let finish;
 const c={URLSearchParams,AbortController,document:{hidden:false,getElementById:()=>({dataset:{marketScope:market}})},window:{MoneyTradingChart:{mergeHistory:(a,b)=>b.concat(a)}},fetch:()=>new Promise(resolve=>finish=resolve),drawCandles(){},drawRSI(){},drawMACD(){},drawStockKline(){},bnCurrentSymbol:'BTCUSDT',bnCurrentInterval:'5m',bnKlineRequestRevision:1,bnKlineContextRevision:1,bnKlineData:[old],currentStockSymbol:'usAAPL',currentStockApiSymbol:'',currentStockKlinePeriod:'5m',stockChartAdjustment:'source',stockKlineRequestRevision:1,stockKlineContextRevision:1,stockChartKlines:[old],stockChartAsOf:'',stockChartIntradayDate:''};
 vm.createContext(c);vm.runInContext(html.slice(start,end),c);
 const payload={success:true,market,instrument:crypto?'crypto:binance:BTCUSDT':'usAAPL',timeframe:'5m',source:'fixture',data:[{...old,time:50}]};
 const pending=c[name](new AbortController().signal);c[crypto?'bnKlineRequestRevision':'stockKlineRequestRevision']++;
 finish({ok:true,json:async()=>payload});assert.match(await pending,/已加载更早记录/);assert.equal(c[crypto?'bnKlineData':'stockChartKlines'].length,2);
 const next=c[name](new AbortController().signal);c[crypto?'bnKlineContextRevision':'stockKlineContextRevision']++;
 finish({ok:true,json:async()=>({...payload,data:[{...old,time:25}]})});await next;assert.equal(c[crypto?'bnKlineData':'stockChartKlines'].length,2);
});
