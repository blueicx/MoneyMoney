const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const file='src/web/public/restricted-chart.js';
const api=()=>{assert.ok(fs.existsSync(file),'saved restricted versions need an explicit chart adapter');return require('../'+file);};
const start=Date.parse('2026-01-01T00:00:00Z'),bars=Array.from({length:8},(_,i)=>({time:start+i*300000,open:10+i,high:11+i,low:9+i,close:10+i,volume:100,closed:true}));
const definition={name:'Isolated chart condition',market:'stocks',timeframe:'5m',entry:{op:'gt',left:{field:'close',lag:0},right:{value:12}},exit:{op:'lt',left:{field:'close',lag:0},right:{value:9}},position:{maxAllocationPct:20},costs:{feeBps:10,slippageBps:10}};
const version=()=>({id:'strategy_12345678-1234-1234-1234-123456789012',hash:'a'.repeat(64),version:1,market:'stocks',interpreterVersion:'restricted-conditions-v1',definition});
const context=()=>({market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',workspace:'stock-quotes',authorized:true,source:'Isolated chart fixture — not market data',sourceTime:start+8*300000,sourceFresh:true,now:start+8*300000,asOf:start+8*300000,evidenceRefs:['fixture-evidence']});
test('saved chart versions share causal interpreter points and retain original candle indexes, version and evidence',()=>{
 const e=api(),data=bars.map((b,i)=>i===2?{...b,closed:false}:b),result=e.evaluate(version(),data,context());
 const expected=require('../src/web/public/restricted-strategy').evaluate(definition,data,context().asOf);
 assert.equal(result.points.length,expected.points.length);assert.equal(result.points[0].index,3);assert.equal(result.points[0].price,13);assert.equal(result.points[0].status,'confirmed');assert.equal(result.points[0].strategyVersion,'a'.repeat(64));assert.deepEqual(result.points[0].evidenceRefs,['fixture-evidence']);assert.equal(result.points[0].open,13);assert.ok(result.points.every(p=>p.strategy.includes(version().id)));assert.equal(result.points[0].conditionExplanation.entry.state,'met');
});
test('chart adapter fails closed for guest, wrong market/period, stale source and incomplete current candle',()=>{
 const e=api();for(const changes of [{authorized:false},{market:'crypto',instrument:'crypto:binance:BTCUSDT'},{timeframe:'1d'},{sourceFresh:false},{source:''}]){const result=e.evaluate(version(),bars,{...context(),...changes});assert.equal(result.points.length,0);assert.ok(result.reason);}
 const r=e.evaluate(version(),bars.map((b,i)=>i===7?{...b,closed:false}:b),context());assert.ok(!r.points.some(p=>p.index===7));
 const historical=e.evaluate(version(),bars,{...context(),sourceFresh:false,historical:true,asOf:start+5*300000});assert.ok(historical.points.every(p=>p.time<start+5*300000));
});
test('chart evaluates complete input before viewport mapping and does not invent missing OHLC',()=>{
 const e=api(),v=version();v.definition={...definition,entry:{op:'gt',left:{indicator:'sma',field:'close',period:3,lag:0},right:{value:10}}};
 const result=e.evaluate(v,bars,context());assert.equal(result.points[0].index,2);assert.equal(e.evaluate(v,bars.slice(-2),context()).points.length,0);assert.equal(e.evaluate(v,bars.map(b=>({...b,open:undefined})),context()).points.length,0);
});
function ui(){api();const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'}),w=dom.window;w.mm_isLoggedIn=true;w.mm_isGuest=false;w.MoneyRestrictedStrategy=require('../src/web/public/restricted-strategy');w.MoneyChartAnalysis=require('../src/web/public/chart-analysis');w.eval(fs.readFileSync(file,'utf8'));return {dom,w,host:w.document.getElementById('host')};}
test('private chart selection is manual, frozen to a version, removable and has no automatic API calls',async()=>{
 const {w,host}=ui();try{let calls=0,changes=0;w.fetch=async()=>{calls++;return {ok:true,json:async()=>({success:true,market:'stocks',data:[version()]})};};const options={host,kind:'stock',getContext:context,onChange:()=>changes++};w.MoneyRestrictedChart.render(options);assert.equal(calls,0);host.querySelector('[data-restricted-load]').click();await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);host.querySelector('[data-restricted-choice]').click();assert.ok(w.MoneyRestrictedChart.enabled('stock').length);assert.equal(w.MoneyRestrictedChart.points('stock',bars,context()).points.length,5);assert.equal(changes,1);host.querySelector('[data-restricted-clear]').click();assert.equal(w.MoneyRestrictedChart.enabled('stock').length,0);assert.equal(changes,2);}finally{w.close();}
});
test('late chart list responses cannot repopulate another instrument or guest session',async()=>{
 const {w,host}=ui();try{let finish,ctx=context();w.fetch=()=>new Promise(resolve=>finish=resolve);w.MoneyRestrictedChart.render({host,kind:'stock',getContext:()=>ctx,onChange:()=>{}});host.querySelector('[data-restricted-load]').click();ctx={...ctx,instrument:'stock:us:SNDK'};w.dispatchEvent(new w.Event('mm-workspace-context'));finish({ok:true,json:async()=>({success:true,market:'stocks',data:[version()]})});await new Promise(r=>setTimeout(r,20));assert.equal(host.querySelectorAll('[data-restricted-choice]').length,0);w.mm_isGuest=true;w.dispatchEvent(new w.Event('mm-workspace-context'));assert.equal(w.MoneyRestrictedChart.enabled('stock').length,0);assert.ok(host.querySelector('[data-restricted-chart]').hidden);}finally{w.close();}
});
test('both chart paths merge restricted points before shared viewport mapping and chart bundle loads dependencies lazily',()=>{
 const runtime=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),build=fs.readFileSync('scripts/copy-web-assets.js','utf8');assert.match(runtime,/MoneyRestrictedChart\?\.points\('stock'/);assert.match(runtime,/MoneyRestrictedChart\?\.points\('crypto'/);assert.match(build,/modules\.charts\.push\([\s\S]*restricted-strategy\.js[\s\S]*restricted-chart\.js/);
});
test('stock chart uses selected identity rather than provider alias for shared point lineage',()=>{
 const ts=require('typescript'),source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),ast=ts.createSourceFile('r.js',source,99,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='buildStockStrategySignals');
 const dom=new JSDOM('<canvas id="stock-kline"></canvas>',{runScripts:'outside-only'}),w=dom.window;try{
  w.document.getElementById('stock-kline').moneySourceMetadata={source:'Isolated alias fixture',sourceTime:Date.now(),dataStatus:'live'};w.MoneyChartAnalysis={evaluateChartStrategies:()=>({signals:[{index:3,strategy:'fixture',side:'buy',price:13}],statuses:{}}),buildStrategyChartPoints:input=>input.signals.map(s=>({...s,instrument:input.instrument}))};w.renderAdvancedChartStrategyControls=()=>{};w.renderChartResearchTools=()=>{};w.recordChartPointEvolution=p=>p;w.filterChartSignalLifecycle=p=>p;w.stockChartEventInstrumentId=()=> 'stock:us:AAPL';w.eval("var stockChartOverlayConfig={strategies:{}},currentStockKlinePeriod='5m',currentStockApiSymbol='AAPL.OQ',currentStockSymbol='usAAPL';");w.eval(fn.getText(ast));assert.equal(w.buildStockStrategySignals(bars)[0].instrument,'stock:us:AAPL');
 }finally{w.close();}
});
test('restricted point explanations include actual condition values for the existing evidence drawer',()=>{
 const result=api().evaluate(version(),bars,context());assert.match(result.points[0].condition,/13/);assert.match(result.points[0].condition,/12/);assert.doesNotMatch(result.points[0].condition,/undefined/);assert.match(result.points[0].condition,/未配置过滤条件/);
});
