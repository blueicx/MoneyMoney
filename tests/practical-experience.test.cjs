const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
test('metric composer remains inside alerts, binds current instrument and renders venue capabilities',async()=>{
 const dom=new JSDOM('<main id="market-workspace-shell" data-market-scope="stocks" data-workspace="guru-holdings" data-instrument="stock:us:SNDK"><section id="alerts-tab"></section><section id="market-change-digest"></section></main>',{url:'https://test.invalid',runScripts:'outside-only'});
 const win=dom.window;win.mm_isLoggedIn=true;win.mm_isGuest=false;win.fetch=async()=>({ok:true,json:async()=>({success:true,fields:['price','rsi'],data:[]})});win.openWorkspace=()=>{};
 win.eval(fs.readFileSync('src/web/public/practical-experience.js','utf8'));win.document.dispatchEvent(new win.Event('DOMContentLoaded'));await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(win.document.querySelector('#mm-metric-composer').closest('#alerts-tab')?.id,'alerts-tab');
 assert.equal(win.document.querySelectorAll('[data-metric-field] option').length,0,'hidden alerts do not fetch capabilities');
 win.document.getElementById('market-workspace-shell').dataset.workspace='alerts';
 win.dispatchEvent(new win.Event('mm-workspace-context'));await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(win.document.querySelector('[data-metric-instrument]').textContent,'stock:us:SNDK');assert.equal(win.document.querySelectorAll('[data-metric-field] option').length,2);
 win.mm_isGuest=true;win.dispatchEvent(new win.Event('mm-workspace-context'));assert.equal(win.document.querySelector('#mm-metric-composer').hidden,true);dom.window.close();
});
test('history chart preserves gaps, supports keyboard inspection and safe export',()=>{
 const chart=require('../src/web/public/interactive-history.js');assert.deepEqual(chart.segments([{date:'a',value:1},{date:'b',value:null},{date:'c',value:2}]).map(row=>row.length),[1,1]);assert.match(chart.csv([['=WEBSERVICE("secret")']]),/"'=WEBSERVICE/);
 const dom=new JSDOM('<div id="chart"></div>',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync('src/web/public/interactive-history.js','utf8'));const host=dom.window.document.getElementById('chart');dom.window.MoneyMoneyHistoryChart.render(host,[{label:'AAPL',points:[{date:'2026-01-01',value:1},{date:'2026-01-02',value:null},{date:'2026-01-03',value:2}]}]);
 assert.equal(host.querySelectorAll('polyline').length,0);assert.equal(host.querySelectorAll('circle').length,2);host.querySelector('svg').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.match(host.querySelector('output').textContent,/2026-01-02.*数据缺口/);dom.window.close();
});
