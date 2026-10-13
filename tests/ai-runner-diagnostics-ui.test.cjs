const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('AI archived replay never repopulates hidden workspace after a same-market context switch',async()=>{
 const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=source.indexOf('async function loadAiRunnerDiagnosticsUi('),end=source.indexOf('async function loadAiRunnerHistory(',start);
 const dom=new JSDOM('<div id="ai-runner-history-a"></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;
 w.eval("var activeMarketScope='stocks';");w.safeNewsText=x=>String(x??'').replace(/[<>&"']/g,'');let release;
 w.fetch=async url=>url.endsWith('/diagnostics')?{ok:true,json:async()=>({success:true,data:{groups:[],rows:[{decisionId:'d',at:'time',instrument:'AAPL',action:'NONE',reason:'等待',dataGate:{dataStatus:'delayed',reason:'合格'},model:{status:'success',reason:'已记录'},blockedChecks:[]}]}})}:new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({success:true,reason:'旧回放',data:{decision:'secret'}})});});
 w.eval(source.slice(start,end));await w.loadAiRunnerDiagnosticsUi('a');w.document.querySelector('[data-ai-round-replay]').click();
 w.dispatchEvent(new w.CustomEvent('mm-workspace-context',{detail:{market:'stocks',workspace:'events'}}));release();await new Promise(r=>setTimeout(r,15));
 assert.equal(w.document.querySelector('[data-ai-round-output]').textContent,'');dom.window.close();
});
