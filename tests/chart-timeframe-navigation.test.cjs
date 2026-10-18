const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('cross-period navigation pins only an explicitly closed same-identity candle at or before asOf',()=>{
 const dom=new JSDOM('<div><canvas></canvas></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.HTMLElement.prototype.getClientRects=()=>[{width:800,height:440}];w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:()=>({width:20})},{get:(t,k)=>t[k]||(()=>{})});
 try{w.eval(fs.readFileSync('src/web/public/trading-chart.js','utf8'));const c=w.MoneyTradingChart,canvas=w.document.querySelector('canvas'),rows=Array.from({length:25},(_,i)=>({time:i*300000,open:10,high:12,low:9,close:11,volume:5}));c.render(canvas,rows,{identity:'a',interval:'5m',syncContext:{market:'stocks',group:'stock:us:AAPL'}});
 assert.equal(typeof c.navigateClosedEvidence,'function');const request={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',time:rows[12].time,asOf:rows[13].time};assert.equal(c.navigateClosedEvidence(canvas,request),true);assert.equal(c.snapshotView(canvas).anchor,rows[12].time);assert.equal(c.snapshotView(canvas).follow,false);
 const before=JSON.stringify(c.snapshotView(canvas));for(const value of [{instrument:'stock:us:SNDK'},{market:'crypto'},{timeframe:'1d'},{asOf:rows[12].time},{time:rows.at(-1).time,asOf:rows.at(-1).time+300000}])assert.equal(c.navigateClosedEvidence(canvas,{...request,...value}),false);assert.equal(JSON.stringify(c.snapshotView(canvas)),before);
 }finally{w.close();}
});
