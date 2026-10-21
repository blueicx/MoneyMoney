const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('portfolio panel mounts only inside private research, does not auto fetch and clears stale market results',async()=>{
 const path='src/web/public/portfolio-simulation-workspace.js';assert.ok(fs.existsSync(path),'portfolio panel missing');
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="research-lab"></div><div id="mm-research-lab"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 try{w.mm_isLoggedIn=true;w.mm_isGuest=false;let calls=0;w.fetch=async()=>{calls++;return {ok:true,json:async()=>({success:true,market:'stocks',data:[]})};};w.eval(fs.readFileSync(path,'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,10));
 const panel=w.document.querySelector('[data-portfolio-simulation]');assert.ok(panel);assert.equal(calls,0);assert.equal(panel.querySelectorAll('form').length>0,true);panel.querySelector('[data-portfolio-list]').click();await new Promise(r=>setTimeout(r,5));assert.equal(calls,1);
 const result=panel.querySelector('[data-portfolio-output]');result.textContent='private';w.document.getElementById('market-workspace-shell').dataset.marketScope='crypto';await new Promise(r=>setTimeout(r,5));assert.equal(result.textContent,'');w.mm_isGuest=true;w.dispatchEvent(new w.Event('mm-workspace-context'));assert.equal(panel.hidden,true);
 }finally{dom.window.close();}
});
