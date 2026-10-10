const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');const html=require('./helpers/dashboard-source.cjs').readDashboardSource();
test('canonical crypto and options selections pass symbols, not identity strings, to existing loaders',()=>{
 const source=html.slice(html.indexOf('function loadActiveWorkspaceInstrument()'),html.indexOf('window.openWorkspace = function(id)'));
 for(const [market,id,workspace,symbol] of [['crypto','crypto:binance:ETHUSDT','crypto-quotes','ETHUSDT'],['options','option:cboe:SPY','option-chain','SPY']]){
  const dom=new JSDOM('<input id="option-symbol">',{runScripts:'outside-only'});dom.window.eval(`let activeMarketScope=${JSON.stringify(market)},currentInstrumentId=${JSON.stringify(id)},activeWorkspaceId=${JSON.stringify(workspace)},bnCurrentSymbol='';function loadBinanceDashboard(){window.loadedSymbol=bnCurrentSymbol;}function loadOptions(){window.loadedSymbol=document.getElementById('option-symbol').value;} ${source} loadActiveWorkspaceInstrument();`);assert.equal(dom.window.loadedSymbol,symbol);dom.window.close();
 }
});
