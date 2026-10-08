const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(){assert.ok(fs.existsSync('src/web/public/trading-chart.js'),'trading chart module must exist');const scope={window:{},document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(fs.readFileSync('src/web/public/trading-chart.js','utf8'),scope);return scope.window.MoneyTradingChart;}
const rows=Array.from({length:100},(_,i)=>({time:i*300000,open:10,high:12,low:9,close:11,volume:5}));
test('paper marker placement rejects incomplete lineage, other instruments and replay future fills',()=>{
 const c=load();assert.equal(typeof c.paperMarkersFor,'function','paper projection missing');
 const marker={orderId:'o',signalId:'s',snapshotId:'d',accountId:'a',market:'stocks',instrument:'stock:us:AAPL',time:rows[50].time+1000,price:11,side:'BUY'};
 const result=c.paperMarkersFor([marker,{...marker,orderId:'legacy',signalId:null},{...marker,orderId:'other',instrument:'stock:us:MU'},{...marker,orderId:'future',time:rows[60].time}],rows.slice(40,55),'stocks','stock:us:AAPL','5m',rows[54].time);
 assert.equal(result.length,1);assert.equal(result[0].index,10);assert.equal(result[0].orderId,'o');
});
test('adjustment control exposes source metadata and disables unverified conversions',()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div><canvas></canvas></div>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));w.MoneyTradingChart.render(w.document.querySelector('canvas'),rows,{identity:'stock:test',interval:'5m',adjustment:{actual:'unknown',conversionEnabled:false,reason:'来源未声明口径'},coverage:{records:100,from:0,to:rows.at(-1).time}});
 const control=w.document.querySelector('[data-chart-adjustment]');assert.ok(control,'adjustment disclosure control missing');assert.equal(control.querySelector('[value="forward"]').disabled,true);assert.equal(control.querySelector('[value="backward"]').disabled,true);assert.match(control.title,/来源未声明/);
 }finally{w.close();}
});
test('paper chart loads only on selection and rejects late responses after instrument changes',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main id="market-workspace-shell" data-market-scope="stocks" data-instrument="stock:us:AAPL"><div><canvas></canvas></div></main>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let calls=0,finish;
 w.mm_isLoggedIn=true;w.mm_isGuest=false;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});w.fetch=()=>{calls++;return new Promise(resolve=>finish=resolve);};
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');w.MoneyTradingChart.render(canvas,rows,{identity:'AAPL|5m',interval:'5m'});assert.equal(calls,0);
 const toggle=w.document.querySelector('[data-paper-chart-layer]');assert.ok(toggle);toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));assert.equal(calls,1);
 w.document.querySelector('main').dataset.instrument='stock:us:MU';finish({ok:true,json:async()=>({success:true,market:'stocks',instrument:'stock:us:AAPL',data:{markers:[{orderId:'old-private',accountId:'a',signalId:'s',snapshotId:'d',side:'BUY',price:11}],unlinked:[]}})});await new Promise(resolve=>setTimeout(resolve,10));
 assert.doesNotMatch(w.document.querySelector('.mm-trading-chart details').textContent,/old-private/);
 }finally{w.close();}
});
test('an old paper response cannot clear a newer instrument response',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main id="market-workspace-shell" data-market-scope="stocks" data-instrument="stock:us:AAPL"><div><canvas></canvas></div></main>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,pending=[];
 w.mm_isLoggedIn=true;w.mm_isGuest=false;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});w.fetch=()=>new Promise(resolve=>pending.push(resolve));
 const result=instrument=>({ok:true,json:async()=>({success:true,market:'stocks',instrument,data:{markers:[],unlinked:[{orderId:instrument,reason:'未关联'}]}})});
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');w.MoneyTradingChart.render(canvas,rows,{identity:'AAPL|5m',interval:'5m'});const toggle=w.document.querySelector('[data-paper-chart-layer]');toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));
 w.document.querySelector('main').dataset.instrument='stock:us:MU';w.MoneyTradingChart.render(canvas,rows,{identity:'MU|5m',interval:'5m'});pending[1](result('stock:us:MU'));await new Promise(resolve=>setTimeout(resolve,10));pending[0](result('stock:us:AAPL'));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(w.document.querySelector('details').hidden,false);assert.match(w.document.querySelector('details').textContent,/stock:us:MU/);
 }finally{w.close();}
});
test('a new paper context removes previous unlinked details while loading',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main id="market-workspace-shell" data-market-scope="stocks" data-instrument="stock:us:AAPL"><canvas></canvas></main>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let calls=0;
 w.mm_isLoggedIn=true;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});w.fetch=()=>++calls===1?Promise.resolve({ok:true,json:async()=>({success:true,market:'stocks',instrument:'stock:us:AAPL',data:{markers:[],unlinked:[{orderId:'old-unlinked',reason:'未关联'}]}})}):new Promise(()=>{});
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');w.MoneyTradingChart.render(canvas,rows,{identity:'AAPL|5m',interval:'5m'});const toggle=w.document.querySelector('[data-paper-chart-layer]');toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setTimeout(resolve,10));assert.match(w.document.querySelector('details').textContent,/old-unlinked/);
 Object.defineProperty(w.document.querySelector('.mm-trading-chart'),'getClientRects',{value:()=>[{}]});w.document.querySelector('main').dataset.instrument='stock:us:MU';w.MoneyTradingChart.render(canvas,rows,{identity:'MU|5m',interval:'5m'});assert.doesNotMatch(w.document.querySelector('details').textContent,/old-unlinked/);assert.match(w.document.querySelector('details').textContent,/正在读取/);
 }finally{w.close();}
});
test('replay refreshes the paper detail list and removes future fills without another request',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main id="market-workspace-shell" data-market-scope="stocks" data-instrument="stock:us:AAPL"><div><canvas></canvas></div></main>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.mm_isLoggedIn=true;w.mm_isGuest=false;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});let calls=0;
 w.fetch=async()=>{calls++;return {ok:true,json:async()=>({success:true,market:'stocks',instrument:'stock:us:AAPL',data:{markers:[{market:'stocks',instrument:'stock:us:AAPL',orderId:'future-order',signalId:'s',snapshotId:'d',accountId:'a',time:rows[80].time,price:11,side:'BUY'}],unlinked:[]}})};};
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');w.MoneyTradingChart.render(canvas,rows,{identity:'AAPL|5m',interval:'5m'});const toggle=w.document.querySelector('[data-paper-chart-layer]');toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setTimeout(resolve,10));assert.match(w.document.querySelector('details').textContent,/future-order/);
 Object.defineProperty(w.document.querySelector('.mm-trading-chart'),'getClientRects',{value:()=>[{}]});
 w.MoneyTradingChart.decorate(canvas,{identity:'AAPL|5m',canvas,full:rows.slice(0,60),rows:rows.slice(0,60),interval:'5m',interactive:false,ma:[],geometry:{W:600,H:440,padL:52,padR:88,padT:20,priceH:280,minP:9,maxP:12},redraw(){}});
 assert.doesNotMatch(w.document.querySelector('details').textContent,/future-order/);assert.equal(calls,1);
 toggle.checked=false;toggle.dispatchEvent(new w.Event('change'));toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));assert.equal(calls,2,'re-enable must restore cleared markers');
 }finally{w.close();}
});
test('connection, freshness and candle state are independent; closed requires evidence',()=>{
  const c=load(),now=1300000;
  let s=c.statusFor({interactive:true,interval:'5m',sourceTime:now-1000,connection:'disconnected'}, {time:1200000},now);
  assert.equal(s.connection,'disconnected');assert.equal(s.freshness,'fresh');assert.equal(s.candle,'forming');
  s=c.statusFor({interactive:true,interval:'5m',sourceTime:now-120000,staleAfterMs:60000}, {time:900000},now);
  assert.equal(s.freshness,'stale');assert.equal(s.candle,'completed');assert.equal(s.session,'waiting');
  assert.equal(c.statusFor({interactive:false},rows[0],now).candle,'historical');
  assert.equal(c.statusFor({interactive:true,sessionEvidence:{state:'closed',source:'exchange',at:now}},rows[0],now).session,'closed');
  assert.equal(c.statusFor({interactive:true,sessionEvidence:{state:'closed'}},rows[0],now).session,'waiting');
});
test('viewport preferences validate untrusted storage and preserve anchored history',()=>{
  const c=load(),s=c.restoreView({count:80,follow:false,anchor:24000000,timeZone:'America/New_York'});
  assert.equal(s.count,80);assert.equal(s.follow,false);assert.equal(s.anchor,24000000);
  assert.equal(c.restoreView({count:99999,anchor:'bad',follow:false,timeZone:'invalid'}).count,300);
  assert.equal(c.restoreView({follow:false,anchor:'bad'}).follow,true);
  assert.equal(c.restoreView({timeZone:'invalid'}).timeZone,'local');
});
test('frame scheduling coalesces pointer updates and never paints hidden pages',()=>{
  const c=load(),queue=[],m={};let paints=0,hidden=false;
  const schedule=()=>c.scheduleFrame(m,()=>paints++,()=>hidden,fn=>queue.push(fn));
  schedule();schedule();schedule();assert.equal(queue.length,1);queue.shift()();assert.equal(paints,1);
  schedule();hidden=true;queue.shift()();assert.equal(paints,1);schedule();assert.equal(queue.length,0);
});
test('price scaling is bounded, centred and can return to automatic range',()=>{
  const c=load(),s=c.createView();c.scalePrice(s,200);const range=c.priceRange(s,90,110);
  assert.equal((range.minP+range.maxP)/2,100);assert.ok(range.maxP-range.minP>20);
  for(let n=0;n<100;n++)c.scalePrice(s,-200);assert.ok(c.priceRange(s,90,110).maxP-c.priceRange(s,90,110).minP>=5-1e-8);
  c.resetPrice(s);assert.equal(c.priceRange(s,90,110).minP,90);
});
test('default chart follows the latest 60 bars without replacing source history',()=>{const c=load(),s=c.createView();assert.equal(c.windowFor(rows,s).start,40);assert.equal(c.windowFor(rows.concat({...rows[99],time:30000000}),s).start,41);assert.equal(rows.length,100);});
test('drag freezes a timestamp anchor across incoming candles and latest restores it',()=>{const c=load(),s=c.createView();c.pan(rows,s,10);const before=c.windowFor(rows,s);assert.equal(s.follow,false);assert.equal(before.start,30);assert.equal(c.windowFor(rows.slice(1).concat({...rows[99],time:30000000}),s).rows.at(-1).time,before.rows.at(-1).time);c.latest(s);assert.equal(c.windowFor(rows,s).start,40);});
test('zoom is bounded and candle countdown never restarts an expired bar',()=>{const c=load(),s=c.createView();for(let i=0;i<100;i++)c.zoom(s,-1);assert.equal(s.count,15);for(let i=0;i<100;i++)c.zoom(s,1);assert.equal(s.count,300);assert.equal(c.countdown({time:1000000},'5m',1120000),'03:00');assert.equal(c.countdown({time:1000000},'5m',1300000),'等待新数据');assert.equal(c.countdown({time:1000000},'1d',1120000),'周期非短线');});
test('volume visibility and subpanel viewport use the rendered candle window',()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div><canvas></canvas></div>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let fills=0,viewport;
 w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({fillRect(){fills++;}},{get:(target,key)=>key in target?target[key]:()=>{}});
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');w.MoneyTradingChart.render(canvas,rows,{identity:'contract:test',interval:'5m',showVolume:false,onViewport:value=>viewport=value});
 assert.equal(fills,60,'hidden volume must not be painted');assert.ok(viewport,'shared viewport callback missing');assert.equal(viewport.rows[0].time,rows[40].time);assert.equal(viewport.rows.at(-1).time,rows.at(-1).time);
 }finally{w.close();}
});
