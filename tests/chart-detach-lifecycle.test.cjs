const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('removing rendered charts releases global context handlers, source references and resize observers',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let observes=0,disconnects=0;const listeners=new Set(),add=w.addEventListener.bind(w),remove=w.removeEventListener.bind(w);
 w.addEventListener=(type,fn,...args)=>{if(type==='mm-workspace-context')listeners.add(fn);return add(type,fn,...args);};w.removeEventListener=(type,fn,...args)=>{if(type==='mm-workspace-context')listeners.delete(fn);return remove(type,fn,...args);};w.mm_isLoggedIn=true;w.mm_isGuest=false;w.ResizeObserver=class{observe(){observes++;}disconnect(){disconnects++;}};
 w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:()=>({width:30})},{get:(t,k)=>t[k]||(()=>{})});w.HTMLElement.prototype.getClientRects=()=>[{width:800,height:440}];
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));await new Promise(r=>setTimeout(r,5));const base=listeners.size;
  for(let i=0;i<20;i++){const host=w.document.createElement('div'),canvas=w.document.createElement('canvas');host.append(canvas);w.document.querySelector('main').append(host);w.MoneyTradingChart.render(canvas,[{time:1000,open:10,high:12,low:9,close:11,volume:1}],{identity:'cycle-'+i,interval:'5m',paperLayer:false,alertContext:{market:'stocks',instrument:'stock:us:AAPL'}});host.remove();await new Promise(r=>setTimeout(r,0));}
  assert.ok(listeners.size<=base+1,'detached charts must not accumulate global callbacks: '+listeners.size);assert.equal(disconnects,20,'every removed chart disconnects its observer');assert.equal(observes,60);
 }finally{w.close();}
});
