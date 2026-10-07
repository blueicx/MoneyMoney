const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
test('committee offers only persisted evidence and stock scope normalizes canonical and legacy identities',()=>{
  const dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="decision-intelligence" data-instrument="stock:us:AAPL"></div><div id="host"></div>',{runScripts:'outside-only'});
  const w=dom.window;w.mm_isLoggedIn=true;w.mm_isGuest=false;w.decisionScopeInstrument=()=> 'AAPL';
  w.eval(fs.readFileSync('src/web/public/professional-research.js','utf8'));
  const base={market:'stocks',instrument:'AAPL',source:{name:'test'},dataStatus:'delayed',observedAt:new Date().toISOString()};
  w.MoneyMoneyProfessionalResearch.renderCommittee(w.document.getElementById('host'),[{...base,id:'stored',persisted:true},{...base,id:'temporary',persisted:false},{...base,id:'unknown'}]);
  assert.deepEqual([...w.document.querySelectorAll('[data-committee-evidence] input')].map(n=>n.value),['stored']);
  const html=fs.readFileSync('src/web/public/index.html','utf8'),source=html.match(/function decisionScopeInstrument\(\) \{[\s\S]*?\n\}/)[0];
  for(const currentInstrumentId of ['stock:us:AAPL','usAAPL','AAPL'])assert.equal(vm.runInNewContext(source+';decisionScopeInstrument()', {currentInstrumentId,activeMarketScope:'stocks',window:{}}),'AAPL');
  dom.window.close();
});
