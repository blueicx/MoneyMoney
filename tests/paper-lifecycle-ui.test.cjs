const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source='src/web/public/paper-lifecycle-workspace.js';
function setup(){const dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="paper"></div><div id="paper-tab"></div>',{url:'https://isolated.test',runScripts:'outside-only',pretendToBeVisual:true});dom.window.mm_isLoggedIn=true;dom.window.mm_isGuest=false;return dom;}
test('account lifecycle is manually read, private, scoped, and reconciliation requires explicit confirmation',async()=>{
 const dom=setup(),w=dom.window,calls=[];try{
  w.confirm=()=>false;w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({success:true,market:'stocks',data:{events:[],receivables:[{instrumentId:'stock:us:AAPL',amount:2.5,currency:'USD',status:'awaiting-payment-date',reason:'缺少付款日',source:'Issuer'}],pendingOptionSettlements:[],performance:{corporateIncome:0}}})};};
  assert.ok(fs.existsSync(source),'existing paper workspace needs a lifecycle action');w.eval(fs.readFileSync(source,'utf8'));w.MoneyPaperLifecycle.install();
  assert.equal(calls.length,0);await w.document.querySelector('[data-lifecycle-read]').onclick();assert.equal(calls.length,1);assert.match(calls[0].url,/market=stocks/);assert.match(w.document.querySelector('[data-lifecycle-output]').textContent,/缺少付款日/);
  await w.document.querySelector('[data-lifecycle-reconcile]').onclick();assert.equal(calls.length,1);
  w.confirm=()=>true;await w.document.querySelector('[data-lifecycle-reconcile]').onclick();assert.equal(calls[1].options.method,'POST');assert.deepEqual(JSON.parse(calls[1].options.body),{market:'stocks'});
  w.document.getElementById('market-workspace-shell').dataset.marketScope='crypto';w.dispatchEvent(new w.Event('mm-workspace-context'));assert.equal(w.document.querySelector('[data-paper-lifecycle]').hidden,true);assert.equal(w.document.querySelector('[data-lifecycle-output]').textContent,'');
 }finally{w.close();}
});
test('late lifecycle responses cannot populate a different workspace and guest install never fetches',async()=>{
 const dom=setup(),w=dom.window;try{let resolve;w.fetch=()=>new Promise(r=>resolve=r);w.eval(fs.readFileSync(source,'utf8'));w.MoneyPaperLifecycle.install();const pending=w.document.querySelector('[data-lifecycle-read]').onclick();w.document.getElementById('market-workspace-shell').dataset.workspace='overview';w.dispatchEvent(new w.Event('mm-workspace-context'));resolve({ok:true,json:async()=>({success:true,market:'stocks',data:{events:[{reason:'stale private result'}]}})});await pending;assert.equal(w.document.querySelector('[data-lifecycle-output]').textContent,'');w.mm_isGuest=true;w.mm_isLoggedIn=false;w.MoneyPaperLifecycle.install();assert.equal(w.document.querySelector('[data-paper-lifecycle]').hidden,true);}finally{w.close();}
});
