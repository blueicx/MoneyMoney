const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');require('ts-node/register/transpile-only');
test('session gap route is admin-only, no-store and validates bounded scope without querying providers',async()=>{
 const {createSessionGapRouter}=require('../src/web/session-gap-routes');let role='guest';const app=express();app.use((req,res,next)=>{req.user={role};next();});app.use('/api/stock/session/gaps',createSessionGapRouter());const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{const url='http://127.0.0.1:'+server.address().port+'/api/stock/session/gaps';let r=await fetch(url);assert.equal(r.status,403);assert.match(r.headers.get('cache-control'),/no-store/);role='admin';
 const params=new URLSearchParams({market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',gaps:JSON.stringify([{from:Date.parse('2026-10-15T14:00Z'),to:Date.parse('2026-10-15T15:00Z')}])});r=await fetch(url+'?'+params);assert.equal(r.status,200);const data=await r.json();assert.equal(data.data.instrument,'stock:us:AAPL');assert.equal(data.data.gaps[0].missingBars,null);assert.equal(data.data.orderChanges,0);
 params.set('instrument','crypto:binance:BTCUSDT');assert.equal((await fetch(url+'?'+params)).status,400);
 params.set('gaps','x'.repeat(6001));assert.equal((await fetch(url+'?'+params)).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
