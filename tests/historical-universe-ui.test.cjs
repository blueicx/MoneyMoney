const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('historical universe panel submits only the evidence reference and discards stale replies',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-workspace="research-lab" data-market-scope="stocks"><div id="mm-research-lab"></div></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,calls=[];
 Object.defineProperty(w.document,'hidden',{value:false});w.mm_isLoggedIn=true;w.mm_isGuest=false;w.crypto.randomUUID=()=> '11111111-1111-4111-8111-111111111111';
 w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({success:true,data:{id:'saved',reason:'观察'}})};};
 try{
  w.eval(fs.readFileSync('src/web/public/historical-universe-workspace.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const panel=w.document.querySelector('[data-historical-universe]');assert.ok(panel);panel.querySelector('[data-evidence-id]').value='ev_saved';panel.querySelector('[data-asof]').value='2025-02-01T00:00:00Z';
  panel.querySelector('[data-capture]').click();await new Promise(resolve=>setTimeout(resolve,10));
  const body=JSON.parse(calls[0].options.body);assert.equal(body.evidenceId,'ev_saved');assert.equal(body.market,'stocks');assert.ok(!('members' in body));assert.match(panel.textContent,/观察/);
  w.document.querySelector('#market-workspace-shell').dataset.marketScope='crypto';w.dispatchEvent(new w.Event('mm-workspace-context'));assert.equal(panel.hidden,true);assert.equal(panel.querySelector('[data-output]').textContent,'');await new Promise(resolve=>setTimeout(resolve,0));
 }finally{dom.window.close();}
});
