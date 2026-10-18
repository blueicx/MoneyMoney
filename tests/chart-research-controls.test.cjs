const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');

test('research tables retain readable columns and scroll inside their panel on narrow screens',()=>{
 const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/web/public/modules/dashboard-base.css'),'utf8');
 assert.match(css,/\.chart-research-panel \.mm-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
 assert.match(css,/\.chart-research-panel table\s*\{[^}]*min-width:\s*560px/);
});

test('coverage and calendar checks are click-only, scoped and late calendar replies cannot overwrite a different chart',async()=>{
 const {render}=require('../src/web/public/chart-research-controls'),dom=new JSDOM('<div id="host"></div>');let calls=0,resolve,current=true;
 const input={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',source:'saved',bars:[0,3600000].map(time=>({time,open:100,high:101,low:99,close:100}))};
 try{const host=dom.window.document.querySelector('#host');render({host,key:'one',isCurrent:()=>current,getInput:()=>input,onSessionAudit:async request=>{calls++;assert.equal(request.instrument,input.instrument);return new Promise(r=>resolve=r);}});assert.equal(calls,0);
 const pending=host.querySelector('[data-research-audit]').onclick();assert.equal(calls,1);current=false;render({host,key:'two',getInput:()=>({...input,instrument:'stock:us:MU'})});resolve({...input,asOf:null,gaps:[]});await pending;assert.doesNotMatch(host.querySelector('[data-research-output]').textContent,/stock:us:AAPL|逐日覆盖/);
 current=true;render({host,key:'three',getInput:()=>input});await host.querySelector('[data-research-audit]').onclick();assert.match(host.textContent,/逐日覆盖|UTC/);assert.match(host.textContent,/1970-01-01/);
 }finally{dom.window.close();}
});

test('gap repair is an explicit scoped preview and never runs on mount, analysis or a late context',async()=>{
 const {render}=require('../src/web/public/chart-research-controls'),dom=new JSDOM('<div id="host"></div>');let calls=0,current=true;
 try{const host=dom.window.document.querySelector('#host'),input={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',bars:[0,180000].map(time=>({time,open:100,high:101,low:99,close:100,volume:1}))};
 render({host,key:'a',isCurrent:()=>current,getInput:()=>input,onBackfill:async preview=>{calls++;assert.equal(preview.request.instrument,'AAPL');return {reason:'fixture queued'};}});
 assert.equal(calls,0);await host.querySelector('[data-research-audit]').onclick();assert.equal(calls,0);
 const button=host.querySelector('[data-gap-backfill]');assert.ok(button);await button.onclick();assert.equal(calls,1);assert.match(host.textContent,/fixture queued/);
 current=false;await button.onclick();assert.equal(calls,1);
 }finally{dom.window.close();}
});
test('deep diagnostics and replay are opt-in controls in the existing panel and preserve scoped inputs',async()=>{
 const {render}=require('../src/web/public/chart-research-controls.js'),dom=new JSDOM('<div id="host"></div>');let reads=0;
 const input={market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',source:'saved',bars:[],points:[],requestTiming:{waitMs:420,decodeMs:2},providerTelemetry:{cacheMode:'cache',providerLatencyMs:800}};
 try{const host=dom.window.document.querySelector('#host');render({host,key:'a',getInput:()=>{reads++;return input;}});assert.equal(reads,0);
 for(const name of ['diagnostics','audit','regimes','redundancy','counterfactual'])assert.ok(host.querySelector('[data-research-'+name+']'),name);
 await host.querySelector('[data-research-diagnostics]').onclick();assert.match(host.querySelector('[data-research-output]').textContent,/420\.00/);assert.match(host.textContent,/旧采集/);
 assert.ok(host.querySelector('[data-chart-support-download]'));assert.match(host.textContent,/不自动上传/);assert.doesNotMatch(host.querySelector('[data-research-output] pre').textContent,/saved/);
 await host.querySelector('[data-research-audit]').onclick();assert.match(host.textContent,/没有记录/);
 await host.querySelector('[data-research-counterfactual]').onclick();assert.match(host.textContent,/事后情景/);
 assert.equal(reads,3);assert.equal(host.querySelectorAll('[data-chart-research]').length,1);
 }finally{dom.window.close();}
});

test('changing instrument aborts an outstanding calendar request without launching a replacement automatically',async()=>{
 const {render}=require('../src/web/public/chart-research-controls'),dom=new JSDOM('<div id="host"></div>');let signal,resolve;
 try{const host=dom.window.document.querySelector('#host'),input={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',bars:[0,3600000].map(time=>({time,open:100,high:101,low:99,close:100}))};
 render({host,key:'a',getInput:()=>input,onSessionAudit:(input,options)=>{signal=options.signal;return new Promise(r=>resolve=r);}});
 const pending=host.querySelector('[data-research-audit]').onclick();assert.equal(signal.aborted,false);render({host,key:'b',getInput:()=>({...input,instrument:'stock:us:MU'})});assert.equal(signal.aborted,true);resolve(null);await pending;
 }finally{dom.window.close();}
});
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
