const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('changing workspace aborts four-period requests and prevents stale chart data from rendering',async()=>{
 const dom=new JSDOM('<section id="mm-stock-multi-chart"><article data-mm-multi-period="5m"><span data-mm-multi-status></span><canvas></canvas></article></section>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window;let signal,draws=0,selected='usAAPL';
 w.MoneyMoneyChartBridge={getContext:()=>({symbol:selected,apiSymbol:selected.slice(2),asOf:''}),draw:()=>draws++};w.fetch=(_,options)=>{signal=options?.signal;return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(new w.DOMException('aborted','AbortError')),{once:true}));};
 try{w.eval(fs.readFileSync('src/web/public/experience-enhancements.js','utf8'));const pending=w.MoneyMoneyExperience.loadMultiChart();assert.ok(signal,'multi-period requests must have an abort signal');selected='usMSFT';w.dispatchEvent(new w.CustomEvent('mm-workspace-context',{detail:{market:'stocks',workspace:'fundamentals'}}));assert.equal(signal.aborted,true);await pending;assert.equal(draws,0);assert.match(w.document.querySelector('[data-mm-multi-status]').textContent,/上下文/);}finally{w.close();}
});
test('deferred chart mount installs the four-period action after modules are ready without duplicate controls',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window;
 try{w.eval(fs.readFileSync('src/web/public/experience-enhancements.js','utf8'));await new Promise(r=>setTimeout(r,0));
  w.document.getElementById('root').innerHTML='<section data-stock-chart-companion><div class="stock-chart-companion-toolbar"></div></section>';
  for(let i=0;i<2;i++){w.dispatchEvent(new w.CustomEvent('mm-workspace-modules-ready',{detail:{group:'charts'}}));await Promise.resolve();}
  assert.equal(w.document.querySelectorAll('[data-mm-multi-chart-toggle]').length,1);
 }finally{w.close();}
});
