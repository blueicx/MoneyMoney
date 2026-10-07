const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
test('financial routes are mounted after auth and a stock-only contextual UI is wired',()=>{
 const server=fs.readFileSync('src/web/server.ts','utf8'),ui=fs.readFileSync('src/web/public/professional-research.js','utf8');
 assert.match(server,/app\.use\('\/api\/research\/filings', createFinancialResearchRouter/);
 assert.ok(server.indexOf("app.use('/api/research/filings'")>server.indexOf('registerApiAuthProtection(app)'));
 assert.match(ui,/\/api\/research\/filings\/search/);assert.match(ui,/\/api\/research\/filings\/index/);
 assert.match(ui,/current\.market !== 'stocks'/);assert.match(ui,/AbortController/);
});
test('financial research API blocks guests, rejects arbitrary URLs and queries only the selected instrument',async()=>{
 const {createFinancialResearchRouter}=require('../src/web/financial-research-routes');const express=require('express');
 const {FinancialTextIndex}=require('../src/storage/financial-text-index');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-filing-api-'));const store=new FinancialTextIndex(path.join(dir,'state.sqlite'));let loads=0;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest'};next();});
 app.use('/api/research/filings',createFinancialResearchRouter({index:()=>store,load:async(instrument)=>{loads++;return {instrument,accession:'0000320193-25-000001',form:'10-K',sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/x.htm',publishedAt:'2025-01-01T00:00:00Z',retrievedAt:'2025-01-02T00:00:00Z',text:'Tariffs are a supply chain risk.'};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/research/filings';
 try{
 assert.equal((await fetch(base+'?instrument=stock:us:AAPL')).status,403);
 const headers={'content-type':'application/json','x-role':'admin'};
 assert.equal((await fetch(base+'/index',{method:'POST',headers,body:JSON.stringify({instrument:'stock:us:AAPL',url:'http://localhost/'})})).status,400);assert.equal(loads,0);
 assert.equal((await fetch(base+'/index',{method:'POST',headers,body:JSON.stringify({instrument:'crypto:binance:BTCUSDT'})})).status,400);
 assert.equal((await fetch(base+'/index',{method:'POST',headers,body:JSON.stringify({instrument:'stock:us:AAPL'})})).status,201);
 const r=await fetch(base+'/search?instrument=stock:us:AAPL&q=tariffs&asOf=2025-03-01T00:00:00Z',{headers});assert.equal(r.status,200);const b=await r.json();assert.equal(b.data.length,1);assert.equal(b.market,'stocks');assert.ok(b.evidenceRefs.length);
 const missing=await fetch(base+'/search?instrument=stock:us:MU&q=tariffs',{headers});assert.equal((await missing.json()).dataStatus,'empty');
 }finally{await new Promise(r=>server.close(r));store.close();}
});
