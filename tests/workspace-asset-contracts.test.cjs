const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('one build-time workspace registry defines market ownership, lazy modules and existing permissions',()=>{
 const {workspaceAssetContracts}=require('../dist/features/market-workspace');assert.equal(typeof workspaceAssetContracts,'function');const contracts=workspaceAssetContracts();
 assert.deepEqual(contracts['stocks:stock-quotes'].modules,['charts']);assert.deepEqual(contracts['crypto:contracts'].modules,['charts','contracts','tables']);assert.equal(contracts['stocks:contracts'],undefined);assert.equal(contracts['crypto:guru-holdings'],undefined);assert.equal(contracts['stocks:paper'].requiresAdmin,true);
 assert.deepEqual(contracts['stocks:fundamentals'].modules,['stocks','tables']);assert.deepEqual(contracts['prediction:prediction-radar'].modules,['prediction']);
});
test('private action and experiment workspaces declare the same owner requirement as their server APIs',()=>{
 const {workspaceAssetContracts,resolveWorkspaceNavigation}=require('../dist/features/market-workspace'),contracts=workspaceAssetContracts();for(const id of ['action-center','research-lab']){assert.equal(contracts['stocks:'+id].requiresAdmin,true);assert.equal(resolveWorkspaceNavigation('stocks').flatMap(group=>group.items).find(row=>row.id===id).requiresAdmin,true);}
});
test('production loader receives generated contracts rather than a second hardcoded market-module map',()=>{
 const loader=fs.readFileSync('src/web/public/modules/workspace-loader.js','utf8'),builder=fs.readFileSync('scripts/copy-web-assets.js','utf8');assert.ok(loader.includes('manifest.workspaceContracts'));assert.ok(builder.includes('workspaceAssetContracts()'));assert.ok(!/id === 'stock-quotes' && market === 'stocks'/.test(loader));
});
