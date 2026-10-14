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
test('workspace contracts declare their own content and necessary read APIs without executing them',()=>{
 const contracts=require('../dist/features/market-workspace').workspaceAssetContracts();for(const contract of Object.values(contracts)){assert.equal(contract.contentOwner,contract.workspace);assert.ok(Array.isArray(contract.readEndpoints)&&contract.readEndpoints.length>0);assert.ok(contract.readEndpoints.every(endpoint=>endpoint.startsWith('/api/')));}assert.ok(contracts['stocks:fundamentals'].readEndpoints.includes('/api/stock/fundamentals/:symbol'));assert.ok(contracts['crypto:contracts'].readEndpoints.includes('/api/contracts/detail'));
});
test('private watchlist and position declarations match protected personal APIs',()=>{const contracts=require('../dist/features/market-workspace').workspaceAssetContracts();assert.equal(contracts['stocks:watchlist'].requiresAdmin,true);assert.equal(contracts['stocks:positions'].requiresAdmin,true);});
