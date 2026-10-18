const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('unchanged deep-link context does not write browser history but still synchronizes the workspace and event',()=>{
 const dom=new JSDOM('<main id="market-workspace-shell"></main>',{url:'https://test.invalid/?market=stocks&workspace=stock-quotes&instrument=AAPL&timeframe=1d',runScripts:'outside-only'}),w=dom.window;
 try{
  const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=source.indexOf('function syncWorkspaceContextUrl()'),end=source.indexOf('\nfunction setWorkspaceInstrument',start);
  w.activeMarketScope='stocks';w.activeWorkspaceId='stock-quotes';w.currentInstrumentId='AAPL';w.workspaceContext={};w.currentInstrumentFilterId=()=>w.currentInstrumentId;
  let writes=0,events=0;const replace=w.history.replaceState.bind(w.history);replace({saved:'keep'},'',w.location.href);w.history.replaceState=(...args)=>{writes++;return replace(...args);};w.addEventListener('mm-workspace-context',()=>events++);
  w.eval(source.slice(start,end));w.syncWorkspaceContextUrl();w.syncWorkspaceContextUrl();
  assert.equal(writes,0,'no-op replaceState can force synchronous layout and destroy navigation state');assert.equal(w.history.state.saved,'keep');assert.equal(events,2);assert.equal(w.document.querySelector('main').dataset.instrument,'AAPL');
  w.currentInstrumentId='SNDK';w.syncWorkspaceContextUrl();assert.equal(writes,1);assert.equal(new URL(w.location.href).searchParams.get('instrument'),'SNDK');assert.equal(events,3);
 }finally{w.close();}
});
