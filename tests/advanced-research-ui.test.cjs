const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');

test('advanced research workspace exposes compact read/preview flows and defaults the assistant to evidence mode',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-workspace="research-lab" data-market-scope="stocks" data-instrument="stock:us:AAPL"><div id="mm-research-lab"></div></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,calls=[];
 Object.defineProperty(w.document,'hidden',{value:false});w.mm_isLoggedIn=true;w.mm_isGuest=false;
 w.fetch=async(url,options={})=>{calls.push({url:String(url),options});return {ok:true,json:async()=>({success:true,market:'stocks',instrument:'stock:us:AAPL',dataStatus:'historical',source:'fixture',data:{mode:'evidence',modelCalls:0,estimatedCostUsd:0,answer:'Supported fact',contentHash:'a'.repeat(64)}})};};
 try{
  w.eval(fs.readFileSync('src/web/public/advanced-research-workspace.js','utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const panel=w.document.querySelector('[data-advanced-research]');assert.ok(panel);
  assert.equal(panel.querySelectorAll('details').length,7);
  assert.ok(panel.textContent.includes('跨币种需独立汇率证据'));
  assert.ok(panel.querySelector('input[type=file]'));
  const assistant=[...panel.querySelectorAll('details')].find(item=>item.querySelector('summary').textContent.includes('研究助手'));
  assistant.querySelector('textarea[name=question]').value='What is supported?';
  assistant.querySelector('textarea[name=evidenceRefs]').value='evidence-one';
  [...assistant.querySelectorAll('button')].find(item=>item.textContent.includes('纯证据摘要')).click();
  await new Promise(resolve=>setTimeout(resolve,20));
  const call=calls.find(item=>item.url==='/api/research/advanced/assistant');assert.ok(call);
  const body=JSON.parse(call.options.body);assert.equal(body.mode,'evidence');assert.deepEqual(body.evidenceRefs,['evidence-one']);assert.match(body.requestId,/^[a-f0-9-]{36}$/);
  assert.match(assistant.querySelector('[data-advanced-output]').textContent,/Supported fact/);
 }finally{dom.window.close();}
});

test('advanced research replay confirmation and advancement use frozen server versions',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-workspace="research-lab" data-market-scope="stocks" data-instrument="stock:us:AAPL"><div id="mm-research-lab"></div></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,calls=[];
 Object.defineProperty(w.document,'hidden',{value:false});w.mm_isLoggedIn=true;w.mm_isGuest=false;
 w.fetch=async(url,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({url:String(url),body});const revision=String(url).endsWith('/confirm')?2:String(url).endsWith('/advance')?3:1;return {ok:true,json:async()=>({success:true,data:{id:'replay_fixture',market:'stocks',revision,manifestHash:'a'.repeat(64),status:String(url).endsWith('/confirm')?'active':'completed',frames:[],decisions:[],reason:'fixture'}})};};
 try{
  w.eval(fs.readFileSync('src/web/public/advanced-research-workspace.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const panel=w.document.querySelector('[data-advanced-research]'),replay=[...panel.querySelectorAll('details')].find(item=>item.querySelector('summary').textContent.includes('全市场回放')),previewBody=JSON.stringify({market:'stocks',instrument:'stock:us:AAPL',asOf:'2026-01-02T00:00:00Z',requestId:'11111111-1111-4111-8111-111111111111',evidenceRefs:[]});
  replay.querySelector('textarea[name=replayBody]').value=previewBody;
  [...replay.querySelectorAll('button')].find(item=>item.textContent==='预览回放').click();await new Promise(resolve=>setTimeout(resolve,10));
  w.confirm=()=>true;[...replay.querySelectorAll('button')].find(item=>item.textContent==='确认回放预览').click();await new Promise(resolve=>setTimeout(resolve,10));
  [...replay.querySelectorAll('button')].find(item=>item.textContent==='推进一帧').click();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls[1].body.acknowledge,true);assert.equal(calls[1].body.revision,1);assert.equal(calls[2].body.revision,2);
  assert.match(replay.querySelector('[data-advanced-output]').textContent,/completed/);
 }finally{dom.window.close();}
});

test('advanced research aborts an in-flight request when market context changes',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-workspace="research-lab" data-market-scope="stocks" data-instrument="stock:us:AAPL"><div id="mm-research-lab"></div></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;let aborted=false;
 Object.defineProperty(w.document,'hidden',{value:false});w.mm_isLoggedIn=true;w.mm_isGuest=false;w.fetch=(url,options={})=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(new w.DOMException('Aborted','AbortError'));},{once:true});});
 try{
  w.eval(fs.readFileSync('src/web/public/advanced-research-workspace.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const panel=w.document.querySelector('[data-advanced-research]'),assistant=[...panel.querySelectorAll('details')].find(item=>item.querySelector('summary').textContent.includes('研究助手'));
  assistant.querySelector('textarea[name=question]').value='Question';assistant.querySelector('textarea[name=evidenceRefs]').value='evidence-one';[...assistant.querySelectorAll('button')].find(item=>item.textContent.includes('纯证据摘要')).click();
  w.document.getElementById('market-workspace-shell').dataset.marketScope='crypto';w.dispatchEvent(new w.Event('mm-workspace-context'));await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(aborted,true);assert.equal(panel.hidden,false);assert.equal(assistant.querySelector('[data-advanced-output]').textContent,'');
 }finally{dom.window.close();}
});
