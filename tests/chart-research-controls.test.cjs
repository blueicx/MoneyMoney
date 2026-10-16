const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
test('a hidden or changed workspace cannot analyze or display the previous instrument',async()=>{
 const {render}=require('../src/web/public/chart-research-controls.js'),dom=new JSDOM('<div id="host"></div>');let reads=0;
 try{const host=dom.window.document.querySelector('#host');render({host,key:'a',isCurrent:()=>false,getInput:()=>{reads++;return {};}});await host.querySelector('[data-research-quality]').onclick();assert.equal(reads,0);assert.match(host.textContent,/上下文/);}finally{dom.window.close();}
});
test('research controls are opt-in, preserve nodes and never run analysis just by mounting',async()=>{
 const {render}=require('../src/web/public/chart-research-controls.js'),dom=new JSDOM('<div id="host"></div>');
 let read=0;const host=dom.window.document.querySelector('#host');
 try{const options={host,key:'stocks:AAPL:1d',getInput:()=>{read++;return {points:[],bars:[],market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d'};}};
 render(options);assert.equal(read,0);const panel=host.querySelector('[data-chart-research]');assert.ok(panel);assert.equal(panel.open,false);
 render(options);assert.equal(host.querySelectorAll('[data-chart-research]').length,1);assert.equal(host.querySelector('[data-chart-research]'),panel);
 await host.querySelector('[data-research-quality]').onclick();assert.equal(read,1);assert.match(host.textContent,/暂无.*确认点位/);
 }finally{dom.window.close();}
});
test('quality cells open exact existing point IDs and text is not interpreted as HTML',async()=>{
 const {render}=require('../src/web/public/chart-research-controls.js'),dom=new JSDOM('<div id="host"></div>');let selected=null;
 const point={id:'exact',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',time:1,side:'buy',strategy:'<img src=x>',strategyVersion:'v1',status:'confirmed',outcomes:[{horizon:1,status:'matured',returnPct:2,netReturnPct:null,mfePct:3,maePct:-1}]};
 try{const host=dom.window.document.querySelector('#host');render({host,key:'one',getInput:()=>({...point,points:[point]}),onSelect:id=>selected=id});await host.querySelector('[data-research-quality]').onclick();assert.equal(host.querySelector('img'),null);host.querySelector('[data-research-point]').click();assert.equal(selected,'exact');assert.match(host.textContent,/少于20/);
 render({host,key:'two',getInput:()=>({points:[]})});assert.equal(host.querySelector('[data-research-point]'),null);
 }finally{dom.window.close();}
});
