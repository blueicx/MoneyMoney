const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(){assert.ok(fs.existsSync('src/web/public/trading-chart.js'),'trading chart module must exist');const scope={window:{},document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(fs.readFileSync('src/web/public/trading-chart.js','utf8'),scope);return scope.window.MoneyTradingChart;}
const rows=Array.from({length:100},(_,i)=>({time:i*300000,open:10,high:12,low:9,close:11,volume:5}));
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
