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
test('AI saved evidence graph is structured, accessible, escaped and keeps raw payload collapsed',()=>{
 const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8');
 const start=source.indexOf('function renderAiDecisionEvidence('),end=source.indexOf('async function loadAiRunnerDiagnosticsUi(',start);
 assert.ok(start>=0,'structured evidence renderer is wired');
 const dom=new JSDOM('<section id="host"></section>',{runScripts:'outside-only'}),w=dom.window;
 w.eval(source.slice(start,end));const host=w.document.getElementById('host');
 w.renderAiDecisionEvidence(host,{reason:'保存记录',evidenceGraph:{nodes:[{id:'d',kind:'decision',recordId:'<script>not-run</script>',label:'决策',status:'recorded',reason:'<img src=x onerror=bad()>',at:'2026-10-01'}],edges:[]},data:{decision:{id:'d'}}});
 assert.equal(host.querySelectorAll('ol[aria-label] li').length,1);
 assert.equal(host.querySelectorAll('script,img').length,0);
 assert.match(host.textContent,/not-run/);assert.equal(host.querySelector('details').open,false);
 assert.match(host.textContent,/不调用模型|只读/);assert.match(source.slice(end,source.indexOf('async function loadAiRunnerHistory(',end)),/renderAiDecisionEvidence\(output,replay/);
 dom.window.close();
});
test('fixed model evidence can be explicitly frozen without changing its saved model or invoking it',async()=>{
 const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=source.indexOf('function renderAiDecisionEvidence('),end=source.indexOf('async function loadAiRunnerDiagnosticsUi(',start);
 const dom=new JSDOM('<section id="host"></section>',{runScripts:'outside-only'}),w=dom.window;w.eval(source.slice(start,end));let captured;w.confirm=()=>true;
 w.renderAiDecisionEvidence(w.document.getElementById('host'),{data:{decision:{id:'d',modelEvidence:{requestedModel:'fixed/v1',promptVersion:'intent-v1'}}}},async config=>{captured=config;return {data:{id:'saved-fixture'}};});
 const button=w.document.querySelector('[data-ai-sandbox-save]');assert.ok(button,'explicit save control');button.click();await new Promise(r=>setTimeout(r,10));
 assert.equal(captured.model,'fixed/v1');assert.equal(captured.promptVersion,'intent-v1');assert.deepEqual(Array.from(captured.decisionIds),['d']);assert.match(w.document.body.textContent,/saved-fixture/);dom.window.close();
});
test('rejected path is labeled hypothetical, separates missing horizons and never renders a success ranking',()=>{
 const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=source.indexOf('function renderAiDecisionEvidence('),end=source.indexOf('async function loadAiRunnerDiagnosticsUi(',start);
 const dom=new JSDOM('<section id="host"></section>',{runScripts:'outside-only'}),w=dom.window;w.eval(source.slice(start,end));
 w.renderAiDecisionEvidence(w.document.getElementById('host'),{reason:'只读',rejectedPath:{reason:'不证明成交',coverageReason:'保留采样',horizons:[{minutes:15,dataStatus:'historical',grossReturnPct:1,netReturnPct:.5,reason:'假设'},{minutes:60,dataStatus:'pending',reason:'观察期限未成熟'}]}});
 assert.match(w.document.body.textContent,/假设路径/);assert.match(w.document.body.textContent,/未成熟/);assert.match(w.document.body.textContent,/0.50/);assert.equal(w.document.querySelectorAll('tbody tr').length,2);
 const table=w.document.querySelector('table');assert.equal(table.style.minWidth,'640px','mobile columns scroll instead of overlapping');assert.equal(table.parentElement.style.overflowX,'auto');dom.window.close();
});
