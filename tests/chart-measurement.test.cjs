const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function chart(){const scope={window:{},document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(fs.readFileSync('src/web/public/trading-chart.js','utf8'),scope);return scope.window.MoneyTradingChart;}
const bars=[100,120,90,110].map((close,i)=>({time:1000+i*60000,open:close,high:close+1,low:close-1,close,volume:10}));
test('measurement uses exact time identities and reports close drawdown without changing rows',()=>{
 const api=chart();assert.equal(typeof api.measureRange,'function');const before=JSON.stringify(bars);
 const r=api.measureRange(bars,bars[0].time,bars[3].time);
 assert.equal(r.dataStatus,'historical');assert.equal(r.barCount,4);assert.equal(r.durationMs,180000);
 assert.ok(Math.abs(r.returnPct-10)<1e-10);assert.equal(r.maxCloseDrawdownPct,25);assert.equal(r.volume,40);
 assert.equal(JSON.stringify(bars),before);
 assert.equal(api.measureRange(bars,bars[3].time,bars[0].time).returnPct,r.returnPct);
});
test('measurement refuses absent endpoints and malformed candles; missing volume stays unknown',()=>{
 const api=chart();assert.equal(typeof api.measureRange,'function');
 assert.equal(api.measureRange(bars,999,bars[3].time).dataStatus,'unavailable');
 assert.equal(api.measureRange(bars.map((r,i)=>i===1?{...r,low:200}:r),bars[0].time,bars[3].time).dataStatus,'unavailable');
 const r=api.measureRange(bars.map((row,i)=>i===2?{...row,volume:null}:row),bars[0].time,bars[3].time);
 assert.equal(r.volume,null);assert.match(r.reason,/成交量/);
});
test('measurement interaction does not dispatch strategy clicks and clears on instrument changes',()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<div><canvas></canvas></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});
 try{
  w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const canvas=w.document.querySelector('canvas');
  w.MoneyTradingChart.render(canvas,bars,{identity:'AAPL|1m',interval:'1m'});
  const button=w.document.querySelector('[data-chart-measure]'),layer=w.document.querySelector('.mm-trading-crosshair');
  const width=canvas.width;layer.getBoundingClientRect=()=>({left:0,top:0,width,height:400});
  let clicks=0;canvas.addEventListener('click',()=>clicks++);button.click();
  assert.equal(canvas.parentElement.classList.contains('mm-trading-measuring'),true);
  layer.dispatchEvent(new w.MouseEvent('click',{clientX:65,clientY:100}));
  layer.dispatchEvent(new w.MouseEvent('click',{clientX:width-100,clientY:100}));
  assert.equal(clicks,0);assert.match(w.document.querySelector('[data-chart-measurement]').textContent,/测量.*收盘涨跌/);
  w.MoneyTradingChart.render(canvas,bars,{identity:'MU|1m',interval:'1m'});
  assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(w.document.querySelector('[data-chart-measurement]').textContent,'');
  assert.equal(canvas.parentElement.classList.contains('mm-trading-measuring'),false);
 }finally{w.close();}
});
