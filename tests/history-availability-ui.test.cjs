const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('historical observed query sends explicit cutoff and renders returned snapshot safely',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-workspace="research-lab" data-market-scope="stocks"><div id="mm-research-lab"></div></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,calls=[];
 Object.defineProperty(w.document,'hidden',{value:false});w.mm_isLoggedIn=true;w.mm_isGuest=false;
 w.fetch=async url=>{calls.push(String(url));const body=String(url).startsWith('/api/research/projects?')?{success:true,data:[{id:'p1',title:'项目',version:1}]}:String(url).startsWith('/api/data/corporate-actions?')?{success:true,dataStatus:'partial',reason:'历史不完整',versions:[{action:{id:'action-one',kind:'split',effectiveAt:'2025-01-01T00:00:00Z',source:'fixture'},recordedAt:'2025-01-02T00:00:00Z',contentHash:'b'.repeat(64)}]}:{success:true,dataStatus:'historical',rows:[{}],snapshot:{id:'snapshot_observed_test',contentHash:'a'.repeat(64)},availability:'observed'};return {ok:true,json:async()=>body};};
 w.eval(fs.readFileSync('src/web/public/research-evidence-governance-workspace.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const root=w.document.querySelector('[data-research-evidence-governance]');assert.ok(root);root.open=true;root.dispatchEvent(new w.Event('toggle'));await new Promise(r=>setTimeout(r,20));
 root.querySelector('[data-project]').value='p1';root.querySelector('[data-project]').dispatchEvent(new w.Event('change'));root.querySelector('[data-instrument]').value='stock:us:AAPL';root.querySelector('[data-timeframe]').value='1d';
 const time=root.querySelector('[data-asof]');assert.ok(time);time.value='2026-01-01T00:00:00Z';root.querySelector('[data-history-query]').click();await new Promise(r=>setTimeout(r,20));
 const url=new URL(calls.find(x=>x.startsWith('/api/data/as-of?')),'http://localhost');assert.equal(url.searchParams.get('availability'),'observed');assert.equal(url.searchParams.get('asOf'),'2026-01-01T00:00:00.000Z');assert.match(root.querySelector('[data-status]').textContent,/snapshot_observed_test/);const button=root.querySelector('[data-actions-asof]');assert.ok(button);button.click();await new Promise(r=>setTimeout(r,20));assert.match(root.querySelector('[data-output]').textContent,/action-one/);assert.match(root.querySelector('[data-status]').textContent,/历史不完整/);dom.window.close();
});
