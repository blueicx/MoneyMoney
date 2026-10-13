const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('paper and order deep links activate their own tabs, not the market cockpit',()=>{
 const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=source.indexOf('function workspaceTabFor(id)'),end=source.indexOf('\nfunction currentInstrumentFilterId(',start);
 const context=vm.createContext({activeMarketScope:'stocks',defaultTabForMarketScope:()=> 'stocks',marketRadarTab:()=> 'radar'});vm.runInContext(source.slice(start,end),context);
 assert.equal(context.workspaceTabFor('paper'),'paper');assert.equal(context.workspaceTabFor('orders'),'orders');assert.equal(context.workspaceTabFor('overview'),'command');
});

test('opening stock fundamentals loads its shared financial research module on demand',()=>{
 const source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=source.indexOf('window.openWorkspace = function(id)'),end=source.indexOf('\n(function initWorkspaceSidebar',start),loaded=[];
 const context=vm.createContext({activeMarketScope:'stocks',activeWorkspaceId:'overview',currentInstrumentId:null,currentStockSymbol:'AAPL',workspaceNavigationState:new Map(),workspaceFallbackNavigation:()=>[{items:[{id:'fundamentals'},{id:'events'}]}],
   syncWorkspaceContextUrl(){},renderWorkspaceMenu(){},applyWorkspaceView(){},updateStockLibraryCurrent(){},workspaceTabFor:()=>null,closeWorkspaceDrawer(){},loadEventTimelineWorkspace(){},document:{querySelector:()=>null},
   window:{MoneyWorkspaceModules:{ensure:group=>{loaded.push(group);return Promise.resolve();}}}});
 vm.runInContext(source.slice(start,end),context);context.window.openWorkspace('events');assert.deepEqual(loaded,[]);
 context.window.openWorkspace('fundamentals');assert.deepEqual(loaded,['research']);
});

test('shared registry declares existing paper/order workspaces as private and supports all four markets',()=>{
 require('ts-node/register/transpile-only');const registry=require('../src/features/market-workspace');
 for(const market of ['stocks','options','crypto','prediction']){
   for(const id of ['paper','orders']){
     assert.equal(registry.isWorkspaceAllowed(market,id),true);
     const entry=registry.resolveWorkspaceNavigation(market).flatMap(g=>g.items).find(item=>item.id===id);assert.equal(entry.requiresAdmin,true);
   }
 }
});
