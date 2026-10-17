const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),fs=require('node:fs');
test('built startup contains workspace history before dashboard initialization without another script request',()=>{
 const manifest=JSON.parse(fs.readFileSync('dist/web/public/asset-manifest.json','utf8')),file=Object.keys(manifest).find(name=>name.includes('dashboard-startup-runtime.'));assert.ok(file);
 const built=fs.readFileSync('dist/web/public'+file,'utf8');assert.match(built,/\.MoneyWorkspaceHistory\s*=/);assert.ok(built.indexOf('MoneyWorkspaceHistory')<built.indexOf('mm_dashboardReady'));
});
test('browser navigation coalesces intermediate context changes, restores popstate and never pushes while restoring',async()=>{
 assert.ok(fs.existsSync('src/web/public/workspace-history.js'),'browser workspace history implementation missing');
 const {install}=require('../src/web/public/workspace-history'),dom=new JSDOM('<main></main>',{url:'https://test.invalid/?market=stocks&workspace=stock-quotes'}),w=dom.window;
 let current={market:'stocks',workspace:'stock-quotes',instrument:'stock:us:AAPL'},restored=[];w.scrollTo=()=>{};
 try{const api=install({window:w,current:()=>current,restore:async entry=>{restored.push(entry);current={market:entry.market,workspace:entry.workspace,instrument:entry.instrument};w.dispatchEvent(new w.Event('mm-workspace-context'));},canRestore:entry=>entry.workspace!=='paper'});
 const first=w.history.state.mmWorkspace;assert.equal(first.market,'stocks');
 current={...current,workspace:'events'};w.history.replaceState({},'','?market=stocks&workspace=events');w.dispatchEvent(new w.Event('mm-workspace-context'));
 current={...current,workspace:'fundamentals'};w.history.replaceState({},'','?market=stocks&workspace=fundamentals');w.dispatchEvent(new w.Event('mm-workspace-context'));await new Promise(r=>setImmediate(r));assert.equal(w.history.length,2);
 w.dispatchEvent(new w.PopStateEvent('popstate',{state:{mmWorkspace:first}}));await new Promise(r=>setImmediate(r));assert.equal(restored.length,1);assert.equal(restored[0].workspace,'stock-quotes');assert.equal(w.history.length,2);
 w.dispatchEvent(new w.PopStateEvent('popstate',{state:{mmWorkspace:{...first,workspace:'paper'}}}));w.dispatchEvent(new w.PopStateEvent('popstate',{state:{mmWorkspace:{...first,url:'https://other.invalid/'}}}));await new Promise(r=>setImmediate(r));assert.equal(restored.length,1);
 w.dispatchEvent(new w.PopStateEvent('popstate',{state:{mmWorkspace:{...first,url:'?market=crypto&workspace=paper'}}}));await new Promise(r=>setImmediate(r));assert.equal(restored.length,1,'restored URL must agree with the permission-checked context');
 api.dispose();
 }finally{w.close();}
});
test('device preference history is allowlisted, bounded and cannot undo over a concurrent tab or record credentials',()=>{
 const {createPreferenceJournal}=require('../src/web/public/workspace-history');assert.equal(typeof createPreferenceJournal,'function');
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},journal=createPreferenceJournal(storage),key='mm-chart-overlays:stocks:AAPL';
 assert.throws(()=>journal.record('mm_token',{value:'secret'},{market:'stocks'}),/允许|范围/);assert.equal(values.has('mm_token'),false);
 journal.record(key,{strategyParameters:{macdCross:{fast:8,slow:21}}},{market:'stocks',workspace:'stock-quotes'});
 const first=journal.list('stocks')[0];assert.ok(first.canUndo);assert.equal(first.kind,'local-preference');
 storage.setItem(key,JSON.stringify({strategyParameters:{macdCross:{fast:12,slow:26}}}));assert.throws(()=>journal.undo(first.id),/变化|后续/);
 journal.record(key,{strategyParameters:{macdCross:{fast:10,slow:26}}},{market:'stocks',workspace:'stock-quotes'});const latest=journal.list('stocks')[0];journal.undo(latest.id);assert.match(storage.getItem(key),/"fast":12/);assert.equal(journal.list('crypto').length,0);
 assert.doesNotMatch(JSON.stringify(journal.list()),/"before"|"after"/);
});
