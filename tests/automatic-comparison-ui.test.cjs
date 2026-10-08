const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
test('automatic comparison panel loads only visible private workspace and filters current market',async()=>{
 const file=path.join(__dirname,'../src/web/public/automatic-comparison.js');assert.ok(fs.existsSync(file),'缺少自动对照工作区');
 const dom=new JSDOM('<div id="paper-tab" class="tab-content"><div id="ai-runners-list"></div></div>',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let requests=0;w.mm_isGuest=false;w.fetch=async()=>{requests++;return {ok:true,json:async()=>({success:true,featureEnabled:true,budget:{remaining:24},data:{enabled:false,notBefore:0,groups:[{market:'stocks',groupId:'g',model:'fixed/model',instruments:['AAPL'],excluded:[],paused:false},{market:'crypto',groupId:'g2',model:'fixed/model',instruments:['BTCUSDT'],excluded:[],paused:false}],history:[]}})};};
 w.eval(fs.readFileSync(file,'utf8'));await w.MoneyMoneyAutomaticComparison.refresh('stocks');assert.equal(requests,0);
 w.document.getElementById('paper-tab').classList.add('active');await w.MoneyMoneyAutomaticComparison.refresh('stocks');
 assert.equal(requests,1);assert.ok(w.document.getElementById('mm-automatic-comparison').textContent.includes('AAPL'));assert.ok(!w.document.getElementById('mm-automatic-comparison').textContent.includes('BTCUSDT'));
 w.mm_isGuest=true;await w.MoneyMoneyAutomaticComparison.refresh('stocks');assert.equal(requests,1);assert.equal(w.document.getElementById('mm-automatic-comparison'),null);dom.window.close();
});
test('switching market clears old group immediately while the new request is still pending',async()=>{
 const dom=new JSDOM('<div id="paper-tab" class="active"><div id="ai-runners-list"></div></div>',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.mm_isGuest=false;w.fetch=async()=>({ok:true,json:async()=>({success:true,featureEnabled:true,budget:{remaining:24},data:{enabled:false,groups:[{market:'stocks',groupId:'g',model:'m',instruments:['AAPL'],excluded:[],paused:false}],history:[]}})});
 w.eval(fs.readFileSync(path.join(__dirname,'../src/web/public/automatic-comparison.js'),'utf8'));
 await w.MoneyMoneyAutomaticComparison.refresh('stocks');let resolve;
 w.fetch=()=>new Promise(r=>resolve=r);const pending=w.MoneyMoneyAutomaticComparison.refresh('crypto');
 assert.ok(!w.document.getElementById('mm-automatic-comparison').textContent.includes('AAPL'),'old stock content must disappear before crypto reply');
 resolve({ok:true,json:async()=>({success:true,featureEnabled:true,budget:{remaining:24},data:{enabled:false,groups:[],history:[]}})});await pending;dom.window.close();
});
test('rebuild accepts an explicit fixed model without inheriting the standalone automatic router',async()=>{
 const dom=new JSDOM('<div id="paper-tab" class="active"><div id="ai-runners-list"></div></div>',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const payload={success:true,featureEnabled:true,budget:{remaining:24},data:{enabled:false,groups:[],history:[]}};let sent;
 w.mm_isGuest=false;w.confirm=()=>true;w.fetch=async(url,options)=>{if(options?.method==='POST')sent=JSON.parse(options.body);return {ok:true,json:async()=>payload};};
 w.eval(fs.readFileSync(path.join(__dirname,'../src/web/public/automatic-comparison.js'),'utf8'));
 await w.MoneyMoneyAutomaticComparison.refresh('stocks');
 const input=w.document.querySelector('[data-fixed-model]');assert.ok(input,'fixed model entry missing');input.value='provider/fixed-version';
 w.document.querySelector('[data-rebuild]').click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.model,'provider/fixed-version');assert.equal(sent.market,'stocks');dom.window.close();
});
