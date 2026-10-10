const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const mod = () => require('../src/features/portfolio-tail-risk');
const series = n => Array.from({length:n}, (_,i) => ({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),value:-(i+1)/1000}));
const row = (instrument, points=series(100), extra={}) => ({market:'stocks',instrument,quantity:1,price:100,currency:'USD',datedReturns:points,...extra});
test('tail risk exists and historical ES averages only the worst probability mass', () => {
  const {portfolioTailRisk} = mod();
  const rows=[row('stock:us:AAPL')], before=JSON.stringify(rows);
  const r=portfolioTailRisk(rows,{asOf:'2026-01-01T00:00:00Z'});
  assert.equal(r.dataStatus,'historical');assert.equal(r.samples,100);
  assert.ok(Math.abs(r.varPct-9.5)<1e-9);assert.ok(Math.abs(r.expectedShortfallPct-9.8)<1e-9);
  assert.ok(Math.abs(r.expectedShortfallAmount-9.8)<1e-9);assert.equal(r.currency,'USD');assert.equal(r.executionEnabled,false);
  assert.equal(JSON.stringify(rows),before);
});
test('date intersection rather than array positions drives covariance and fixed-weight returns', () => {
  const {portfolioTailRisk}=mod(); const a=series(150),b=a.slice(30).reverse().map(p=>({...p,value:p.value*2}));
  const r=portfolioTailRisk([row('stock:us:AAPL',a),row('stock:us:MU',b)],{asOf:'2026-01-01T00:00:00Z'});
  assert.equal(r.samples,120);assert.equal(r.windowStart,a[30].date);assert.equal(r.correlations[0][1],1);
  assert.ok(Math.abs(r.covariance[0][1]-2*r.covariance[0][0])<1e-12);
  assert.equal(r.windows.recent.samples,60);assert.equal(r.windows.previous.samples,60);
});
test('missing currency/history and nonlinear markets produce explicit unavailable states, never zero risk', () => {
  const {portfolioTailRisk}=mod();
  for(const rows of [[],[row('stock:us:AAPL',[])],[row('stock:us:AAPL',series(20))],[row('stock:us:AAPL'),row('stock:hk:00700',series(100),{currency:'HKD'})],[row('option:cboe:AAPL-C',{},{market:'options'})]]){
    const r=portfolioTailRisk(rows,{asOf:'2026-01-01T00:00:00Z'});assert.equal(r.varPct,null);assert.equal(r.expectedShortfallPct,null);assert.ok(r.reason);
  }
});
test('cross-market identities, duplicate/invalid dates and invalid prices fail closed', () => {
  const {portfolioTailRisk}=mod();
  assert.throws(()=>portfolioTailRisk([row('crypto:binance:BTCUSDT')]),/市场|身份/);
  assert.throws(()=>portfolioTailRisk([row('stock:us:AAPL',series(100),{price:NaN})]),/估值/);
  assert.throws(()=>portfolioTailRisk([row('stock:us:AAPL',[...series(100),series(100)[0]])]),/重复/);
  assert.throws(()=>portfolioTailRisk([row('stock:us:AAPL',[{date:'2025-02-30',value:0.1}])]),/日期/);
  assert.throws(()=>portfolioTailRisk([row('stock:us:AAPL')],{confidence:1}),/置信/);
});
test('asOf excludes the unfinished day and future observations without inventing missing returns', () => {
  const {portfolioTailRisk}=mod();const points=series(100),cut=points[80].date;
  const r=portfolioTailRisk([row('stock:us:AAPL',points)],{asOf:cut+'T12:00:00Z'});
  assert.equal(r.samples,80);assert.equal(r.windowEnd,points[79].date);
});
test('invalid legacy return units disable tail estimates without aborting the existing portfolio summary',()=>{
  const {analyzePortfolio}=require('../src/features/decision-intelligence');
  const data=analyzePortfolio([row('stock:us:AAPL',[{date:'2025-01-01',value:-10}])]);
  assert.equal(data.totalValue,100);assert.equal(data.tailRisk.varPct,null);assert.match(data.tailRisk.reason,/收益|口径/);
});
test('portfolio analytics and workspace render the same tail-risk result with source and warning labels',()=>{
  const fs=require('fs');
  assert.match(fs.readFileSync('src/features/decision-intelligence.ts','utf8'),/tailRisk:\s*portfolioTailRisk\(rows/);
  assert.match(require('./helpers/dashboard-source.cjs').readDashboardSource(),/MoneyMoneyProfessionalResearch\?\.renderTailRisk/);
  const server=fs.readFileSync('src/web/server.ts','utf8');
  assert.match(server,/map\(row\s*=>\s*\(\{\.\.\.row,\s*datedReturns:\s*undefined/);
  assert.match(server,/tailRisk\s*=\s*\{\s*\.\.\.data\.tailRisk,\s*source:/);
});
