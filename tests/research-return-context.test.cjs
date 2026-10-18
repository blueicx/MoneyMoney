const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function setup(){
 const dom=new JSDOM('<main id="market-workspace-shell" data-market-scope="stocks" data-workspace="research-lab" data-instrument="stock:us:MU"><div id="center-workspace"><button id="origin">图表日期</button><button data-research-tab="comparison" aria-selected="true">比较</button><button data-research-tab="history">历史</button><div data-comparison-options><input type="checkbox" value="stock:us:MU" checked></div><input id="mm-experiment-all" type="checkbox" checked></div></main>',{url:'https://test.invalid/?workspace=research-lab&market=stocks',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,shell=w.document.querySelector('main'),center=w.document.getElementById('center-workspace');
 w.scrollTo=()=>{};w.setMarketScope=m=>shell.dataset.marketScope=m;w.setWorkspaceInstrument=id=>shell.dataset.instrument=id;w.openWorkspace=id=>shell.dataset.workspace=id;w.MoneyMoneyChartBridge={locateDay:async()=>1};
 for(const button of w.document.querySelectorAll('[data-research-tab]'))button.onclick=()=>{for(const node of w.document.querySelectorAll('[data-research-tab]'))node.setAttribute('aria-selected',String(node===button));};
 w.history.replaceState({navigation:'preserve'},'',w.location.href);center.scrollTop=240;w.document.getElementById('origin').focus();w.eval(fs.readFileSync('src/web/public/workflow-polish.js','utf8'));
 return {dom,w,shell,center};
}
test('nested chart date jumps return to the original research tab, selection, central scroll and history state',async()=>{
 const {dom,w,shell,center}=setup();try{
  await w.MoneyMoneyWorkflow.locate('2026-10-01','stock:us:MU');
  center.scrollTop=10;w.document.querySelector('[data-research-tab="history"]').click();w.document.querySelector('[data-comparison-options] input').checked=false;w.document.getElementById('mm-experiment-all').checked=false;
  await w.MoneyMoneyWorkflow.locate('2026-10-02','stock:us:MU');
  w.document.getElementById('mm-return-to-research').click();await new Promise(r=>setTimeout(r,35));
  assert.equal(shell.dataset.workspace,'research-lab');assert.equal(center.scrollTop,240);assert.equal(w.document.querySelector('[data-research-tab="comparison"]').getAttribute('aria-selected'),'true');assert.equal(w.document.querySelector('[data-comparison-options] input').checked,true);assert.equal(w.document.getElementById('mm-experiment-all').checked,true);assert.equal(w.history.state.navigation,'preserve');assert.equal(w.document.activeElement.id,'origin');
 }finally{dom.window.close();}
});
test('a delayed date lookup does not publish a stale no-data toast after changing market',async()=>{
 const {dom,w,shell}=setup();try{let finish,toasts=0;w.MoneyMoneyChartBridge.locateDay=()=>new Promise(r=>finish=r);w.showToast=()=>toasts++;const pending=w.MoneyMoneyWorkflow.locate('2026-10-01','stock:us:MU');shell.dataset.marketScope='crypto';finish(null);await pending;assert.equal(toasts,0);}finally{dom.window.close();}
});
test('return restores saved history state after the navigation journal finishes its context microtask',async()=>{
 const {dom,w}=setup();try{const open=w.openWorkspace;w.openWorkspace=id=>{open(id);w.queueMicrotask(()=>w.history.replaceState({navigation:'journal'},'',w.location.href));};await w.MoneyMoneyWorkflow.locate('2026-10-01','stock:us:MU');w.document.getElementById('mm-return-to-research').click();await new Promise(r=>setTimeout(r,35));assert.equal(w.history.state.navigation,'preserve');}finally{dom.window.close();}
});
