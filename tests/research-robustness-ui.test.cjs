const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('robustness UI only requests a saved experiment on manual click and rejects late private results',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="research-lab" data-instrument="stock:us:AAPL"></div><div id="host"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.mm_isLoggedIn=true;w.mm_isGuest=false;w.eval(fs.readFileSync('src/web/public/professional-research.js','utf8'));let calls=0,release;
 w.MoneyMoneyProfessionalResearch.renderRobustness(w.document.getElementById('host'),[{id:'exp-a'}],()=>{calls++;return new Promise(r=>release=r);});
 assert.equal(calls,0);w.document.querySelector('[data-robustness-run]').click();assert.equal(calls,1);
 w.document.getElementById('market-workspace-shell').dataset.workspace='events';release({data:{reason:'private result',dataHash:'abc',configurationHash:'def',seed:42,controls:null,regimes:[],warnings:[]}});
 await new Promise(r=>setTimeout(r,10));assert.equal(w.document.querySelector('[data-robustness-output]').textContent,'');w.close();
});
