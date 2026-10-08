const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(){assert.ok(fs.existsSync('src/web/public/trading-chart.js'),'trading chart module must exist');const scope={window:{},document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(fs.readFileSync('src/web/public/trading-chart.js','utf8'),scope);return scope.window.MoneyTradingChart;}
const rows=Array.from({length:100},(_,i)=>({time:i*300000,open:10,high:12,low:9,close:11,volume:5}));
test('history pages merge only older actual candles without rewriting current rows or losing live refresh history',()=>{
 const c=load();assert.equal(typeof c.mergeHistory,'function');const current=rows.slice(50),older=rows.slice(40,51).map(row=>({...row,close:10}));
 const joined=c.mergeHistory(current,older,current[0].time);assert.equal(joined.length,60);assert.equal(joined[10].close,11);assert.equal(joined[0].time,rows[40].time);
 const refreshed=c.mergeHistory(joined,[{...rows[99],close:12}]);assert.equal(refreshed.length,60);assert.equal(refreshed.at(-1).close,12);assert.equal(c.mergeHistory(joined,[{...rows[39],low:20}],current[0].time).length,60);
});
test('history control is explicit and serial, and late completion cannot overwrite another chart context',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div><canvas></canvas></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});let calls=0,finish;
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');const options={identity:'AAPL|5m',interval:'5m',loadEarlier:()=>{calls++;return new Promise(resolve=>finish=resolve);}};w.MoneyTradingChart.render(canvas,rows,options);
 const button=w.document.querySelector('[data-chart-history]');assert.ok(button);assert.equal(calls,0);button.click();button.click();assert.equal(calls,1);assert.equal(button.disabled,true);
 w.MoneyTradingChart.render(canvas,rows,{identity:'MU|5m',interval:'5m'});finish('old AAPL source unavailable');await new Promise(resolve=>setTimeout(resolve,10));assert.doesNotMatch(w.document.querySelector('.mm-trading-status').textContent,/old AAPL/);assert.equal(button.hidden,true);
 }finally{w.close();}
});
test('clearing a chart aborts an in-flight history page and hides its control',()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div><canvas></canvas></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});let signal;
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');w.MoneyTradingChart.render(canvas,rows,{identity:'AAPL|5m',interval:'5m',loadEarlier:s=>{signal=s;return new Promise(()=>{});}});w.document.querySelector('[data-chart-history]').click();w.MoneyTradingChart.clear(canvas);assert.equal(signal.aborted,true);assert.equal(w.document.querySelector('[data-chart-history]').hidden,true);}finally{w.close();}
});
test('returning to the same instrument does not revive a cancelled page response',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div><canvas></canvas></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});let finish;
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');const options={identity:'AAPL|5m',interval:'5m',loadEarlier:()=>new Promise(resolve=>finish=resolve)};
 w.MoneyTradingChart.render(canvas,rows,options);w.document.querySelector('[data-chart-history]').click();w.MoneyTradingChart.render(canvas,rows,{identity:'MU|5m',interval:'5m'});w.MoneyTradingChart.render(canvas,rows,options);finish('cancelled AAPL source');await new Promise(resolve=>setTimeout(resolve,10));assert.doesNotMatch(w.document.querySelector('.mm-trading-status').textContent,/cancelled AAPL/);
 }finally{w.close();}
});
test('cancelled history callback cannot report successful loading',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div><canvas></canvas></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));w.MoneyTradingChart.render(w.document.querySelector('canvas'),rows,{identity:'AAPL|5m',interval:'5m',loadEarlier:async()=>undefined});w.document.querySelector('[data-chart-history]').click();await new Promise(resolve=>setTimeout(resolve,10));assert.doesNotMatch(w.document.querySelector('.mm-trading-status').textContent,/已载入/);assert.match(w.document.querySelector('.mm-trading-status').textContent,/取消|变化/);}finally{w.close();}
});
test('paper marker placement rejects incomplete lineage, other instruments and replay future fills',()=>{
 const c=load();assert.equal(typeof c.paperMarkersFor,'function','paper projection missing');
 const marker={orderId:'o',signalId:'s',snapshotId:'d',accountId:'a',market:'stocks',instrument:'stock:us:AAPL',time:rows[50].time+1000,price:11,side:'BUY'};
 const result=c.paperMarkersFor([marker,{...marker,orderId:'legacy',signalId:null},{...marker,orderId:'other',instrument:'stock:us:MU'},{...marker,orderId:'future',time:rows[60].time}],rows.slice(40,55),'stocks','stock:us:AAPL','5m',rows[54].time);
 assert.equal(result.length,1);assert.equal(result[0].index,10);assert.equal(result[0].orderId,'o');
});
test('prediction chart markers require an explicit matching YES/NO outcome',()=>{
 const c=load(),base={orderId:'prediction-order',signalId:'s',snapshotId:'d',accountId:'a',market:'prediction',instrument:'prediction:predictfun:EVENT-1',time:rows[50].time,price:.4,side:'YES',outcome:'YES'};
 assert.equal(c.paperMarkersFor([base],rows,'prediction',base.instrument,'5m').length,1);
 assert.equal(c.paperMarkersFor([{...base,outcome:'NO'}],rows,'prediction',base.instrument,'5m').length,0);
 assert.equal(c.paperMarkersFor([{...base,side:'SELL',outcome:undefined}],rows,'prediction',base.instrument,'5m').length,0);
 assert.equal(c.paperMarkersFor([{...base,side:'SELL',outcome:'NO'}],rows,'prediction',base.instrument,'5m').length,1);
});
test('paper snapshot evidence is scoped to its exact marker and predates the fill',()=>{
 const c=load();assert.equal(typeof c.verifyPaperEvidenceEnvelope,'function','snapshot evidence verifier missing');
 const marker={market:'stocks',instrument:'stock:us:MU',snapshotId:'rs_'+'a'.repeat(64),time:Date.parse('2026-10-08T10:01:00Z')};
 const evidence={success:true,market:marker.market,instrument:marker.instrument,data:{id:marker.snapshotId,hash:'a'.repeat(64),at:'2026-10-08T10:00:00Z',fields:{market:'stocks',status:'delayed',source:'test',dataAt:'2026-10-08T10:00:00Z',price:100}}};
 assert.equal(c.verifyPaperEvidenceEnvelope(marker,evidence),true);
 for(const mutate of [d=>d.market='crypto',d=>d.instrument='stock:us:AAPL',d=>d.data.id='rs_'+'b'.repeat(64),d=>d.data.hash='b'.repeat(64),d=>d.data.at='2026-10-08T10:02:00Z',d=>d.data.fields.dataAt='2026-10-08T10:02:00Z']){
  const changed=structuredClone(evidence);mutate(changed);assert.equal(c.verifyPaperEvidenceEnvelope(marker,changed),false);
 }
});
test('linked execution evidence verifies all lineage identifiers and rejects decision or quote data after the fill',()=>{
 const c=load();assert.equal(typeof c.verifyPaperExecutionEvidenceEnvelope,'function','execution evidence verifier missing');
 const marker={market:'stocks',instrument:'stock:us:MU',accountId:'ai-runner:r1',runnerId:'r1',orderId:'o1',signalId:'s1',snapshotId:'rs_'+'a'.repeat(64),side:'BUY',time:Date.parse('2026-10-08T10:01:00Z')};
 const at='2026-10-08T10:00:00Z',hash='a'.repeat(64),body={success:true,market:marker.market,instrument:marker.instrument,data:{market:marker.market,instrument:marker.instrument,accountId:marker.accountId,orderId:marker.orderId,signalId:marker.signalId,snapshotId:marker.snapshotId,
  decision:{id:marker.signalId,runnerId:marker.runnerId,orderId:marker.orderId,market:marker.market,instrument:'MU',at,action:'BUY',snapshotHash:hash,signals:[],riskChecks:[]},
  snapshot:{id:marker.snapshotId,hash,at,fields:{market:marker.market,instrument:'MU',status:'delayed',dataAt:at,quote:{fetchedAt:at},evidence:[{dataAt:at,retrievedAt:at}]}}}};
 assert.equal(c.verifyPaperExecutionEvidenceEnvelope(marker,body),true);
 for(const mutate of [d=>d.data.orderId='other',d=>d.data.accountId='other',d=>d.data.signalId='other',d=>d.data.snapshotId='rs_'+'b'.repeat(64),d=>d.data.decision.snapshotHash='b'.repeat(64),d=>d.data.decision.at='2026-10-08T10:02:00Z',d=>d.data.snapshot.fields.quote.fetchedAt='2026-10-08T10:02:00Z',d=>d.data.snapshot.fields.evidence[0].retrievedAt='2026-10-08T10:02:00Z']){
  const changed=structuredClone(body);mutate(changed);assert.equal(c.verifyPaperExecutionEvidenceEnvelope(marker,changed),false);
 }
});
test('prediction execution evidence binds the YES/NO outcome in both directions and closes',()=>{
 const c=load(),at='2026-10-08T10:00:00Z',time=Date.parse('2026-10-08T10:01:00Z'),instrument='prediction:predictfun:EVENT-1',hash='c'.repeat(64),snapshotId='rs_'+hash;
 const marker={market:'prediction',instrument,accountId:'ai-runner:r',runnerId:'r',orderId:'o',signalId:'s',snapshotId,time,side:'YES',outcome:'YES'};
 const body={success:true,market:'prediction',instrument,data:{market:'prediction',instrument,accountId:marker.accountId,orderId:'o',signalId:'s',snapshotId,decision:{id:'s',runnerId:'r',orderId:'o',market:'prediction',instrument:'EVENT-1',at,action:'BUY',side:'YES',snapshotHash:hash,signals:[],riskChecks:[]},snapshot:{id:snapshotId,hash,at,fields:{market:'prediction',instrument:'EVENT-1',dataAt:at}}}};
 assert.equal(c.verifyPaperExecutionEvidenceEnvelope(marker,body),true);
 assert.equal(c.verifyPaperExecutionEvidenceEnvelope({...marker,side:'NO',outcome:'NO'},body),false);
 const close=structuredClone(body);close.data.decision.action='SELL';close.data.decision.side='NO';const closeMarker={...marker,side:'SELL',outcome:'NO'};
 assert.equal(c.verifyPaperExecutionEvidenceEnvelope(closeMarker,close),true);
 assert.equal(c.verifyPaperExecutionEvidenceEnvelope({...closeMarker,outcome:'YES'},close),false);
});
test('chart evidence action shows the linked decision, risk checks and source details as text only',async()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-instrument="stock:us:MU"><canvas></canvas></div>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.mm_isLoggedIn=true;w.mm_isGuest=false;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});
 const time=Date.parse('2026-10-08T10:01:00Z'),marker={orderId:'o1',signalId:'s1',snapshotId:'rs_'+'a'.repeat(64),accountId:'ai-runner:r1',runnerId:'r1',market:'stocks',instrument:'stock:us:MU',time,price:11,side:'BUY',feeUsd:0.1,slippageUsd:0.2},at=new Date(time-1000).toISOString();
 const evidence={success:true,market:'stocks',instrument:marker.instrument,data:{market:marker.market,instrument:marker.instrument,orderId:marker.orderId,accountId:marker.accountId,signalId:marker.signalId,snapshotId:marker.snapshotId,decision:{id:marker.signalId,runnerId:marker.runnerId,orderId:marker.orderId,market:marker.market,instrument:'MU',at,action:'BUY',snapshotHash:'a'.repeat(64),strategyVersion:'rsi-v2',reason:'依据已核验报价模拟买入',signals:['RSI14 超卖'],riskChecks:[{name:'fresh quote',passed:true,reason:'报价未过期'}],dataStatus:'delayed',source:'Yahoo',dataAt:at,evidence:[{dataset:'bars',source:'Yahoo 1m',status:'delayed',dataAt:at,retrievedAt:at}]},snapshot:{id:marker.snapshotId,hash:'a'.repeat(64),at,fields:{market:marker.market,instrument:'MU',status:'delayed',source:'<img src=x onerror=alert(1)>',dataAt:at,price:11,quote:{bestBid:10.9,bestAsk:11.1,fetchedAt:at},rsi14:31,sma10:10.2}}}};const requests=[];
 w.fetch=async url=>{requests.push(String(url));return String(url).includes('/api/paper/execution-evidence?')?{ok:true,json:async()=>evidence}:{ok:true,json:async()=>({success:true,market:'stocks',instrument:marker.instrument,data:{markers:[marker],unlinked:[]},reason:null})};};
 try{
  w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');w.MoneyTradingChart.render(canvas,rows,{identity:marker.instrument+'|5m',interval:'5m'});
  const toggle=w.document.querySelector('[data-paper-chart-layer]');toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,0));const button=w.document.querySelector('[data-paper-evidence]');assert.ok(button,'linked fill should offer its source snapshot');
  button.click();await new Promise(resolve=>setTimeout(resolve,0));
  const detail=w.document.querySelector('[data-paper-evidence-details]');assert.ok(detail&&!detail.hidden);assert.match(detail.textContent,/<img src=x onerror=alert\(1\)>/);assert.match(detail.textContent,/依据已核验报价模拟买入/);assert.match(detail.textContent,/fresh quote 通过/);assert.match(detail.textContent,/Yahoo 1m/);assert.match(detail.textContent,/RSI14：31/);assert.match(detail.textContent,/买一 10.9 · 卖一 11.1/);assert.ok(requests.some(url=>url.includes('/api/paper/execution-evidence?')));
  assert.equal(w.document.querySelector('[data-paper-evidence-details] img'),null);
 }finally{w.close();}
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
