const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('gaps, retrospective and recovery enforce private scoped reads and reject client evidence',async()=>{
 const express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-test-role']};next();});let reads=0,writes=0;
 const row={id:'fixture',market:'stocks',links:[],updatedAt:'2026-01-01T00:00:00Z'};
 app.use('/forward',require('../src/web/restricted-forward-routes').createRestrictedForwardRouter({read:()=>row,gaps:()=>{reads++;return {ordersCreated:0};}},()=>{}));
 app.use('/projects',require('../src/web/research-project-routes').createResearchProjectRouter({read:()=>row,retrospective:(_id,ids)=>{reads++;assert.deepEqual(ids,['a','b']);return {ordersCreated:0};}}));
 app.use('/data',require('../src/web/data-asset-routes').createDataAssetRouter({}, {health:()=>{reads++;return {failures:[]};},preview:()=>{reads++;return {hash:'fixture'};},confirm:()=>{writes++;throw Error('internal physical path must never leak');}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const base='http://127.0.0.1:'+server.address().port,get=(url,role='admin')=>fetch(base+url,{headers:{'x-test-role':role}}),post=(url,body)=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json','x-test-role':'admin'},body:JSON.stringify(body)});
 for(const url of ['/forward/fixture/gaps?market=stocks','/projects/fixture/retrospective?market=stocks&linkIds=a,b','/data/recovery?market=options&instrument=option:cboe:AAPL']){assert.equal((await get(url,'guest')).status,403);const r=await get(url);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);}
 assert.equal(reads,3);assert.equal(writes,0);
 for(const url of ['/forward/fixture/gaps?market=crypto','/forward/fixture/gaps?market=stocks&trades=100','/projects/fixture/retrospective?market=crypto&linkIds=a,b','/projects/fixture/retrospective?market=stocks&linkIds=a,b&winner=a'])assert.equal((await get(url)).status,400);
 assert.equal(reads,3);assert.equal((await post('/data/recovery/preview',{market:'options',instrument:'option:cboe:AAPL',path:'/etc/secret'})).status,400);assert.equal(reads,3);
 const denied=await post('/data/recovery/confirm',{market:'options',instrument:'option:cboe:AAPL',snapshotId:'id',backupId:'backup',hash:'stale',previewedAt:1});assert.equal(denied.status,409);assert.doesNotMatch(JSON.stringify(await denied.json()),/physical path/);assert.equal(writes,1);
 }finally{await new Promise(r=>server.close(r));}
});
