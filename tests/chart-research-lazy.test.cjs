const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
test('chart bundle defers research implementation until explicit interaction',()=>{
 const build=fs.readFileSync(path.join(root,'scripts/copy-web-assets.js'),'utf8');
 const charts=build.slice(build.indexOf('modules.charts.push('),build.indexOf('modules.comparison.push('));
 assert.doesNotMatch(charts,/path.join\(source, 'chart-research(?:-controls)?\.js'\)/);
 assert.match(charts,/chart-research-lazy\.js/);
 assert.match(build,/modules\.chartResearch\.push\(/);
});
function setup(){
 const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only'}),w=dom.window,host=w.document.querySelector('#host'),calls=[];
 let resolve,reject,loads=0;
 const real={render:options=>calls.push(['render',options]),openPointLifecycle:options=>calls.push(['lifecycle',options])};
 w.MoneyWorkspaceModules={ensure:()=>{loads++;return new Promise((yes,no)=>{resolve=()=>{w.MoneyChartResearchControls=real;yes();};reject=no;});}};
 w.eval(fs.readFileSync(path.join(root,'src/web/public/chart-research-lazy.js'),'utf8'));
 const lazy=w.MoneyChartResearchControls;
 return {dom,w,host,calls,lazy,real,get loads(){return loads;},resolve:()=>resolve(),reject:()=>reject(Error('offline'))};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('collapsed research is inert; opening uses latest options and one load',async()=>{
 const s=setup();try{
 s.lazy.render({host:s.host,key:'A',getInput:()=>{throw Error('must not read until explicit analysis');}});
 assert.equal(s.loads,0);const panel=s.host.querySelector('[data-chart-research]');assert.ok(panel);assert.equal(panel.open,false);
 panel.open=true;panel.dispatchEvent(new s.w.Event('toggle'));assert.equal(s.loads,1);
 const latest={host:s.host,key:'A',isCurrent:()=>true,marker:'latest'};s.lazy.render(latest);
 panel.dispatchEvent(new s.w.Event('toggle'));assert.equal(s.loads,1);
 s.resolve();await tick();assert.equal(s.calls.length,1);assert.equal(s.calls[0][1],latest);assert.equal(s.host.querySelector('[data-chart-research-lazy]'),null);
 }finally{s.dom.window.close();}
});
test('late research load never applies to changed or hidden context',async()=>{
 const s=setup();try{
 s.lazy.render({host:s.host,key:'A',isCurrent:()=>true});const panel=s.host.firstElementChild;panel.open=true;panel.dispatchEvent(new s.w.Event('toggle'));
 s.lazy.render({host:s.host,key:'B',isCurrent:()=>false});s.resolve();await tick();assert.equal(s.calls.length,0);
 assert.match(s.host.textContent,/上下文/);
 }finally{s.dom.window.close();}
});
test('failed load exposes retry; lifecycle respects context after loading',async()=>{
 const s=setup();try{
 s.lazy.render({host:s.host,key:'A'});const panel=s.host.firstElementChild;panel.open=true;panel.dispatchEvent(new s.w.Event('toggle'));s.reject();await tick();
 const retry=s.host.querySelector('button');assert.ok(retry);retry.click();assert.equal(s.loads,2);s.resolve();await tick();assert.equal(s.calls.length,1);
 }finally{s.dom.window.close();}
 const s2=setup();try{let current=true;const pending=s2.lazy.openPointLifecycle({host:s2.host,isCurrent:()=>current});current=false;s2.resolve();await pending;assert.equal(s2.calls.length,0);}finally{s2.dom.window.close();}
});
test('loaded proxy removes stale placeholder on the next render and preserves synchronous controls',async()=>{
 const s=setup();try{
 s.lazy.render({host:s.host,key:'A'});const panel=s.host.firstElementChild;panel.open=true;panel.dispatchEvent(new s.w.Event('toggle'));
 s.lazy.render({host:s.host,key:'B',isCurrent:()=>false});s.resolve();await tick();
 assert.equal(s.w.MoneyChartResearchControls,s.lazy);
 s.w.MoneyChartResearchControls.render({host:s.host,key:'B',isCurrent:()=>true});
 assert.equal(s.host.querySelector('[data-chart-research-lazy]'),null);assert.equal(s.calls.length,1);
 await s.lazy.openPointLifecycle({host:s.host,isCurrent:()=>true});assert.equal(s.calls[1][0],'lifecycle');assert.equal(s.loads,1);
 }finally{s.dom.window.close();}
});
test('keyboard expansion retains focus on the mounted research summary',async()=>{
 const s=setup();try{
 s.real.render=()=>{const panel=s.w.document.createElement('details'),summary=s.w.document.createElement('summary');panel.dataset.chartResearch='';panel.append(summary);s.host.append(panel);};
 s.lazy.render({host:s.host,key:'A'});const panel=s.host.firstElementChild;panel.querySelector('summary').focus();panel.open=true;panel.dispatchEvent(new s.w.Event('toggle'));s.resolve();await tick();
 assert.equal(s.w.document.activeElement,s.host.querySelector('summary'));
 }finally{s.dom.window.close();}
});
