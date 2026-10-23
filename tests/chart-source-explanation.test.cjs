const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(){const scope={window:{},document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(fs.readFileSync('src/web/public/trading-chart.js','utf8'),scope);return scope.window.MoneyTradingChart;}
test('axis labels respect interval, selected timezone, day and year boundaries',()=>{
 const c=load(),first=Date.parse('2026-12-31T23:30:00Z'),next=Date.parse('2027-01-01T00:30:00Z');
 const info={interval:'1d',exchangeTimeZone:'America/New_York'},state={timeZone:'UTC'};
 assert.match(c.axisLabel(next,info,state,first),/2027/);
 assert.doesNotMatch(c.axisLabel(first,info,state,first),/:/);
 assert.match(c.axisLabel(first,{...info,interval:'5m'},state,first),/23:30/);
 assert.match(c.axisLabel(next,{...info,interval:'5m'},state,first),/01.*01.*00:30/);
 assert.equal(c.axisLabel(first,{...info,interval:'1y'},state,first),'2026');
 assert.match(c.axisLabel(next,info,{timeZone:'exchange'},first),/12.*31/);
});
test('source explanations keep source, server fetch and browser receipt distinct, and never infer a closed session',()=>{
 const c=load(),now=1792770000000,source=now-120000;
 const result=c.explainSource({source:'Provider',sourceTime:source,fetchedAt:now-2000,retrievedAt:now-1000,dataStatus:'cached',providerTelemetry:{cacheMode:'cache'},interactive:true,interval:'1d'}, {time:source,closed:false},now);
 assert.equal(result.sourceTime,source);assert.equal(result.fetchedAt,now-2000);assert.equal(result.receivedAt,now-1000);
 assert.equal(result.session,'unknown');assert.equal(result.dataState,'cached');assert.equal(result.freshness,'stale');
 assert.equal(c.explainSource({dataStatus:'empty'},null,now).dataState,'empty');
 assert.equal(c.explainSource({dataStatus:'failed'},null,now).dataState,'failed');
 assert.equal(c.explainSource({updatedAt:now},null,now).sourceTime,null,'fetch time must not become source observation time');
 assert.equal(c.explainSource({sessionEvidence:{state:'closed',source:'exchange',at:now}},null,now).session,'closed');
});
test('non-candle markets explain independent source timestamps without HTML injection',()=>{
 const {JSDOM}=require('jsdom'),ts=require('typescript'),source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),ast=ts.createSourceFile('runtime.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='renderMarketSourceExplanation');
 assert.ok(node,'shared source explanation for options and prediction');
 const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only'});try{dom.window.eval(source.slice(node.getStart(ast),node.end));dom.window.renderMarketSourceExplanation(dom.window.document.getElementById('host'),{source:'<img src=x onerror=alert(1)>',fetchedAt:'2026-10-24T00:00:00Z',identity:'options:AAPL'});assert.equal(dom.window.document.querySelector('img'),null);assert.match(dom.window.document.getElementById('host').textContent,/源数据时间：未提供/);assert.match(dom.window.document.getElementById('host').textContent,/服务器抓取时间：2026/);}finally{dom.window.close();}
});
