const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const source=require('./helpers/dashboard-source.cjs').readDashboardSource();
test('expanded dense signal choices survive reordered redraws, retain exact point identity and close with Escape',()=>{
 const dom=new JSDOM('<div id="bn-chart-signal-markers"></div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 try{w.MoneyChartAnalysis=require('../src/web/public/chart-analysis');w.formatChartTime=String;
 const start=source.indexOf('function renderChartSignalMarkers('),end=source.indexOf('\nfunction recordChartPointEvolution',start);assert.ok(start>=0&&end>start);w.handleChartSignalSelection=()=>{};w.eval(source.slice(start,end));
 const p={id:'a',market:'crypto',instrument:'crypto:binance:BTCUSDT',timeframe:'5m',time:1,price:10,side:'buy',label:'放量突破',status:'confirmed'},b={...p,id:'b',label:'均线交叉'};
 const layer=w.document.getElementById('bn-chart-signal-markers'),render=points=>w.renderChartSignalMarkers(layer.id,points,()=>({x:50,y:50,minX:0,maxX:200,minY:0,maxY:200}));
 render([p,b]);layer.querySelector('[data-chart-signal-cluster]').click();const choice=layer.querySelectorAll('[data-chart-signal-choice]')[1];assert.equal(choice.dataset.chartSignalPointId,'b');choice.focus();
 render([b,{...p,price:11}]);assert.equal(layer.querySelectorAll('[data-chart-signal-choice]').length,2);assert.equal(w.document.activeElement.dataset.chartSignalPointId,'b');assert.match(layer.querySelector('[data-chart-signal-point-id="a"]').textContent,/11/);
 w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(layer.querySelectorAll('[data-chart-signal-choice]').length,0);
 render([p,b]);assert.equal(layer.querySelectorAll('[data-chart-signal-choice]').length,0,'closed expansion must not reopen');
 layer.querySelector('[data-chart-signal-cluster]').click();render([]);render([p,b]);assert.equal(layer.querySelectorAll('[data-chart-signal-choice]').length,0,'a vanished cluster must not reopen later');
 }finally{w.close();}
});
