const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');require('ts-node/register/transpile-only');
const {DataSourceRouter}=require('../src/features/data-source-router');
test('isolated source timeout, transport loss and restored connection retain honest source state',async()=>{
 let mode='live',calls=0;const sockets=new Set();const server=http.createServer((req,res)=>{calls++;if(mode==='timeout')return;if(mode==='reset'){req.socket.destroy();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({price:123}));});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url='http://127.0.0.1:'+server.address().port,router=new DataSourceRouter();router.register('isolated-source',{markets:['stocks'],capabilities:['quote'],retry:{maxAttempts:1},circuit:{failureThreshold:20,openMs:0},fetchLive:async()=>{const r=await fetch(url,{signal:AbortSignal.timeout(200)});return r.json();}});const request=()=>router.fetch('isolated-source',{marketId:'stocks',capability:'quote',symbol:'AAPL',forceRefresh:true});
  assert.equal((await request()).capability.status,'live');mode='timeout';const timed=await request();assert.equal(timed.data,null);assert.equal(timed.capability.status,'unavailable');mode='reset';assert.equal((await request()).capability.status,'unavailable');mode='live';const restored=await request();assert.equal(restored.capability.status,'live');assert.deepEqual(restored.data,{price:123});assert.ok(calls>=4);
 }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});
