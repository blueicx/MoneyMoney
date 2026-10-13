const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM}=require('jsdom');
test('watchlist editor loads only on demand, escapes labels and submits selected canonical identities with revision',async()=>{
 const dom=new JSDOM('<div id="panel"></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;
 const state={revision:3,groups:[{id:'research',name:'<研究>'}],items:{'stock:us:AAPL':{groupId:null,tags:['财报'],reason:'现金流',observeOn:null,pinned:false,order:0}},history:[]};let calls=[];
 w.fetch=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({success:true,data:state})};};
 w.eval(fs.readFileSync('src/web/public/watchlist-metadata.js','utf8'));
 w.MoneyWatchMetadata.mount(w.document.getElementById('panel'));
 assert.equal(calls.length,0);const details=w.document.querySelector('details');details.open=true;details.dispatchEvent(new w.Event('toggle'));
 await new Promise(r=>setTimeout(r,20));assert.equal(calls.length,1);assert.equal(w.document.querySelector('[data-meta-group=research]').textContent,'<研究>');
 w.document.querySelector('[data-meta-id]').checked=true;
 w.document.querySelector('[name=groupId]').value='research';
 w.document.querySelector('[data-meta-save]').click();await new Promise(r=>setTimeout(r,20));
 const write=calls.find(c=>c.init?.method==='POST');assert.ok(write);assert.deepEqual(JSON.parse(write.init.body),{revision:3,changes:[{instrument:'stock:us:AAPL',groupId:'research'}]});
 dom.window.close();
});

test('late metadata response cannot repopulate a workspace after context cancellation',async()=>{
 const dom=new JSDOM('<div id="panel"></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;let release;
 w.fetch=()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({success:true,data:{revision:0,groups:[],items:{'stock:us:AAPL':{tags:[],reason:'旧请求'}},history:[]}})});});
 w.eval(fs.readFileSync('src/web/public/watchlist-metadata.js','utf8'));w.MoneyWatchMetadata.mount(w.document.getElementById('panel'));
 const details=w.document.querySelector('details');details.open=true;details.dispatchEvent(new w.Event('toggle'));await new Promise(r=>setTimeout(r,10));
 w.dispatchEvent(new w.Event('mm-workspace-context'));release();await new Promise(r=>setTimeout(r,20));assert.doesNotMatch(w.document.getElementById('panel').textContent,/旧请求/);dom.window.close();
});
