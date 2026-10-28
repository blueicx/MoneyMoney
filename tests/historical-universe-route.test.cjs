const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
require('ts-node/register/transpile-only');

test('historical universe routes enforce admin and CSRF while accepting only evidence references',async()=>{
 const {createHistoricalUniverseRouter}=require('../src/web/historical-universe-routes');let captures=0;
 const store={capture(input){captures++;return {...input,id:'fixture',members:[]};},list(){return [];},read(){return {id:'fixture',members:[]};}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={role:req.headers['x-test-role']||'guest'};next();});
 app.use('/universes',createHistoricalUniverseRouter(store,req=>req.headers['x-test-csrf']==='valid'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const call=(headers={},body={market:'stocks',evidenceId:'evidence',asOf:'2025-01-01T00:00:00Z',requestId:'request-id-00001'})=>fetch(base+'/universes',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/universes?asOf=2025-01-01T00:00:00Z')).status,403);
  assert.equal((await call({'x-test-role':'admin'})).status,403);
  assert.equal((await call({'x-test-role':'admin','x-test-csrf':'valid'},{market:'stocks',members:[]})).status,400);
  assert.equal(captures,0);
  assert.equal((await call({'x-test-role':'admin','x-test-csrf':'valid'})).status,201);assert.equal(captures,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
