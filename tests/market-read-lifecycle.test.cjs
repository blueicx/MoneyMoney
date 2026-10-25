const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),ast=ts.createSourceFile('runtime.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=new Map(ast.statements.filter(ts.isFunctionDeclaration).filter(node=>node.name).map(node=>[node.name.text,source.slice(node.getStart(ast),node.end)]));
function fixture(){
 const elements=new Map(['bn-depth','bn-trades','bn-candlestick','bn-chart-title','forecast-lab-panel'].map(id=>[id,{innerHTML:'initial '+id,textContent:'',isConnected:true}])),requests=[],draws=[],notes=[];
 const document=Object.assign(new EventTarget(),{hidden:false,getElementById:id=>elements.get(id)||null}),window=Object.assign(new EventTarget(),{MoneyLiveKline:{stop(){},sync(){notes.push('sync');},note:(...args)=>notes.push(args)}});
 const context={document,window,AbortController,performance,Date,console,activeMarketScope:'crypto',activeWorkspaceId:'crypto-quotes',marketScopeRequestEpoch:1,bnCurrentSymbol:'AAAUSDT',bnCurrentInterval:'5m',bnKlineData:[],bnKlineController:null,bnDepthController:null,bnTradesController:null,bnKlineRequestRevision:0,bnKlineContextRevision:0,currentForecastLabController:null,forecastLabLoading:false,
  fetch:(url,options={})=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),drawDepthChart:(...args)=>draws.push(['depth',...args]),drawCandles:(...args)=>draws.push(['candles',...args]),radarEscape:String,renderForecastLab:data=>'rendered '+data.id,loadAlertsForChart:async()=>{},marketScopeRequestToken:()=>({scope:context.activeMarketScope,epoch:context.marketScopeRequestEpoch}),isCurrentMarketScopeToken:token=>token.scope===context.activeMarketScope&&token.epoch===context.marketScopeRequestEpoch};
 for(const name of declarations.get('abortMarketScopedRequests').matchAll(/(\w+)\?\.abort\(/g))context[name[1]]??=null;
 vm.createContext(context);
 for(const name of ['abortQuoteAndForecastReads','bindQuoteAndForecastReadLifecycle','abortMarketScopedRequests','loadBinanceDepth','loadBinanceTrades','loadBinanceKlines','loadForecastLab'])if(declarations.has(name))vm.runInContext(declarations.get(name),context);
 if(context.bindQuoteAndForecastReadLifecycle)context.bindQuoteAndForecastReadLifecycle();
 const reply=(request,data)=>request.resolve({ok:true,headers:{get:()=>null},json:async()=>data});
 return {context,elements,requests,draws,notes,reply,event:detail=>window.dispatchEvent(Object.assign(new Event('mm-workspace-context'),{detail}))};
}
const payload=(name,price)=>name==='loadBinanceDepth'?{success:true,data:{bids:[[price,1]],asks:[[price+1,1]]}}:name==='loadBinanceTrades'?{success:true,data:[{isBuyerMaker:false,price,qty:1,time:0}]}:{success:true,data:[{time:1000,open:price,high:price+1,low:price-1,close:price,volume:1}]};
for(const [name,id]of [['loadBinanceDepth','bn-depth'],['loadBinanceTrades','bn-trades']])test(name+' keeps the newer symbol when older fetch completes last',async()=>{
 const f=fixture(),first=f.context[name]();f.context.bnCurrentSymbol='BBBUSDT';const second=f.context[name]();f.reply(f.requests[1],payload(name,20));await second;const current=f.elements.get(id).innerHTML;f.reply(f.requests[0],payload(name,10));await first;
 assert.equal(f.elements.get(id).innerHTML,current,'old symbol must not replace current prices');assert.equal(f.requests[0].options.signal?.aborted,true,'superseded read must be cancelled');
});
test('market cancellation aborts crypto reads and prevents late chart, DOM and live-sync effects',async()=>{
 const f=fixture(),pending=['loadBinanceDepth','loadBinanceTrades','loadBinanceKlines'].map(name=>f.context[name]());f.context.activeMarketScope='stocks';f.context.activeWorkspaceId='stock-quotes';f.context.marketScopeRequestEpoch++;f.context.abortMarketScopedRequests();
 assert.equal(f.requests.length,3);for(const request of f.requests)assert.equal(request.options.signal?.aborted,true,'market boundary must abort each crypto read');
 for(let i=0;i<f.requests.length;i++)f.reply(f.requests[i],payload(['loadBinanceDepth','loadBinanceTrades','loadBinanceKlines'][i],10));await Promise.all(pending);assert.equal(f.draws.length,0);assert.equal(f.notes.length,0);assert.equal(f.elements.get('bn-depth').innerHTML,'initial bn-depth');
});
test('workspace and page visibility changes cancel reads even within the same market',async()=>{
 for(const visibility of [false,true]){const f=fixture(),pending=f.context.loadBinanceDepth();if(visibility){f.context.document.hidden=true;f.context.document.dispatchEvent(new Event('visibilitychange'));}else{f.context.activeWorkspaceId='research-lab';f.event({market:'crypto',workspace:'research-lab',instrument:'AAAUSDT'});}assert.equal(f.requests[0].options.signal?.aborted,true);f.reply(f.requests[0],payload('loadBinanceDepth',10));await pending;assert.equal(f.elements.get('bn-depth').innerHTML,'initial bn-depth');}
});
test('inactive or hidden crypto workspaces do not start auxiliary or kline GETs',async()=>{
 for(const hidden of [false,true]){const f=fixture();f.context.document.hidden=hidden;if(!hidden)f.context.activeWorkspaceId='research-lab';const pending=['loadBinanceDepth','loadBinanceTrades','loadBinanceKlines'].map(name=>f.context[name]());assert.equal(f.requests.length,0);await Promise.all(pending);}
});
test('an old forecast failure cannot write or unlock a newer forced read',async()=>{
 const f=fixture();f.context.activeMarketScope='prediction';f.context.activeWorkspaceId='prediction-radar';const first=f.context.loadForecastLab(),second=f.context.loadForecastLab(true),loading=f.elements.get('forecast-lab-panel').innerHTML;f.requests[0].reject(Error('old failed request'));await first;
 assert.equal(f.elements.get('forecast-lab-panel').innerHTML,loading,'stale error must not overwrite the active load');await f.context.loadForecastLab();assert.equal(f.requests.length,2,'old finally must not unlock a pending replacement');assert.equal(f.requests[0].options.signal?.aborted,true);f.reply(f.requests[1],{success:true,data:{id:'current'}});await second;assert.equal(f.elements.get('forecast-lab-panel').innerHTML,'rendered current');
});
test('leaving prediction cancels forecast GET and suppresses its late error',async()=>{
 const f=fixture();f.context.activeMarketScope='prediction';f.context.activeWorkspaceId='prediction-radar';const pending=f.context.loadForecastLab();f.context.activeMarketScope='stocks';f.context.marketScopeRequestEpoch++;f.context.abortMarketScopedRequests();f.elements.get('forecast-lab-panel').innerHTML='new market';assert.equal(f.requests[0].options.signal?.aborted,true);f.requests[0].reject(Error('late failure'));await pending;assert.equal(f.elements.get('forecast-lab-panel').innerHTML,'new market');
});
test('kline caller abort subscription is singular and released after completion',async()=>{
 const f=fixture(),controller=new AbortController(),signal=controller.signal;let added=0,removed=0;const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);signal.addEventListener=(...args)=>{added++;return add(...args);};signal.removeEventListener=(...args)=>{removed++;return remove(...args);};const pending=f.context.loadBinanceKlines({signal});f.reply(f.requests[0],payload('loadBinanceKlines',10));await pending;assert.equal(added,1);assert.equal(removed,1);
});
