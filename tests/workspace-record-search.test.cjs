const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');

test('private command search includes single-market project summaries without leaking hypotheses or requiring an instrument',async()=>{
 const express=require('express'),{createWorkspaceRecordSearchRouter}=require('../src/web/workspace-record-search-routes');let reads=0;
 const app=express();app.use((req,res,next)=>{req.user={role:req.headers['x-owner']==='yes'?'admin':'guest'};next();});
 app.use(createWorkspaceRecordSearchRouter({experiments:()=>[],orders:()=>[],projects:market=>{reads++;assert.equal(market,'stocks');return [{id:'project_one',market:'stocks',title:'Capital revision project',updatedAt:'2026-01-01',question:'private hypothesis',budget:1000},{id:'project_other',market:'crypto',title:'Capital revision project'}];}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'?market=stocks&q=capital')).status,403);assert.equal(reads,0);const r=await fetch(base+'?market=stocks&q=capital',{headers:{'x-owner':'yes'}}),body=await r.json();assert.equal(body.data.length,1);assert.equal(body.data[0].kind,'project');assert.equal(body.data[0].title,'Capital revision project');assert.equal(body.data[0].instrument,null);assert.doesNotMatch(JSON.stringify(body),/private hypothesis|budget|project_other/);assert.match(r.headers.get('cache-control'),/no-store/);
 }finally{await new Promise(r=>server.close(r));}
});
test('command search includes registered current workspaces and removes private destinations for guests',()=>{
 const source=require('./helpers/dashboard-source.cjs').readDashboardSource(),fn=source.match(/function globalSearchCommands\(\) \{[\s\S]*?\n\}/)[0],vm=require('node:vm');
 const context={window:{mm_isGuest:true,mm_isLoggedIn:true},activeMarketScope:'stocks',workspaceNavigationState:new Map(),workspaceFallbackNavigation:()=>[{items:[{id:'guru-holdings',label:'大神持仓'},{id:'paper',label:'模拟盘',requiresAdmin:true}]}]};
 const rows=vm.runInNewContext(fn+';globalSearchCommands()',context);assert.ok(rows.some(r=>r.workspace==='guru-holdings'));assert.equal(rows.some(r=>['paper','journal','settings','alerts'].includes(r.tab)),false);assert.equal(rows.some(r=>r.workspace==='paper'),false);
});
test('record search is private, bounded, market-isolated and exposes no budgets or model inputs',async()=>{
 const fs=require('node:fs');assert.ok(fs.existsSync('src/web/workspace-record-search-routes.ts'),'private record search router missing');
 const {createWorkspaceRecordSearchRouter}=require('../src/web/workspace-record-search-routes'),express=require('express');let reads=0;
 const app=express();app.use((req,res,next)=>{req.user={role:req.headers['x-owner']==='yes'?'admin':'guest'};next();});
 app.use(createWorkspaceRecordSearchRouter({experiments:()=>{reads++;return [{id:'exp-1',market:'stocks',instrument:'stock:us:AAPL',strategyVersion:'v1',budget:900,prices:[1,2]}];},orders:()=>{reads++;return [{id:'order-1',market:'stocks',instrument:'stock:us:AAPL',status:'filled'},{id:'other',market:'crypto',instrument:'crypto:binance:BTCUSDT',status:'filled'}];}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'?market=stocks&q=AAPL')).status,403);assert.equal(reads,0);
 const r=await fetch(base+'?market=stocks&q=AAPL',{headers:{'x-owner':'yes'}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const body=await r.json();assert.equal(body.data.length,2);assert.equal(JSON.stringify(body).includes('budget'),false);assert.equal(JSON.stringify(body).includes('prices'),false);
 assert.equal((await fetch(base+'?market=stocks&q=x',{headers:{'x-owner':'yes'}})).status,400);
 assert.equal((await fetch(base+'?market=overview&q=AAPL',{headers:{'x-owner':'yes'}})).status,400);
 }finally{await new Promise(r=>server.close(r));}
});
