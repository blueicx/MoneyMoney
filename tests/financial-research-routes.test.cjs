const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');

test('financial routes are mounted after auth with CSRF and the stock-only version desk is wired',()=>{
 const server=fs.readFileSync('src/web/server.ts','utf8'),ui=fs.readFileSync('src/web/public/professional-research.js','utf8');
 assert.match(server,/app\.use\('\/api\/research\/filings', createFinancialResearchRouter/);
 assert.match(server,/createFinancialResearchRouter\(\{[\s\S]{0,180}csrfValid: verifyCsrfRequest/);
 assert.ok(server.indexOf("app.use('/api/research/filings'")>server.indexOf('registerApiAuthProtection(app)'));
 for(const route of ['/search','/index','/compare','/sections','/annotations'])assert.match(ui,new RegExp(route));
 assert.match(ui,/data-filing-version-desk/);assert.match(ui,/If-Match/);assert.match(ui,/Idempotency-Key/);
 assert.match(ui,/current\.market !== 'stocks'/);assert.match(ui,/AbortController/);
});

test('financial research API enforces admin, CSRF, write keys and same-instrument comparison',async()=>{
 const {createFinancialResearchRouter}=require('../src/web/financial-research-routes');
 const {FinancialTextIndex}=require('../src/storage/financial-text-index');
 const express=require('express'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-filing-api-')),store=new FinancialTextIndex(path.join(dir,'state.sqlite'));
 let loads=0;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest',username:'fixture-admin'};next();});
 app.use('/api/research/filings',createFinancialResearchRouter({
  index:()=>store,
  csrfValid:req=>req.get('x-csrf-token')==='fixture-csrf',
  load:async(instrument,accession)=>{
   loads++;
   const base=accession==='0000320193-24-000001';
   return {
    instrument,accession:accession||'0000320193-25-000001',form:'10-K',
    sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/'+(base?'000032019324000001':'000032019325000001')+'/report.htm',
    publishedAt:base?'2024-01-01T00:00:00Z':'2025-01-01T00:00:00Z',retrievedAt:base?'2024-01-02T00:00:00Z':'2025-01-02T00:00:00Z',
    text:base?'Item 1. Business\n\nBase business.\n\nItem 1A. Risk Factors\n\nTariffs are a supply chain risk.':'Item 1. Business\n\nCurrent business.\n\nItem 1A. Risk Factors\n\nTariffs and shortages are a supply chain risk.',
   };
  },
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const baseUrl='http://127.0.0.1:'+server.address().port+'/api/research/filings';
 const admin={'content-type':'application/json','x-role':'admin'},csrf={...admin,'x-csrf-token':'fixture-csrf','idempotency-key':'index-request-0001'};
 try{
  assert.equal((await fetch(baseUrl+'?instrument=stock:us:AAPL')).status,403);
  assert.equal((await fetch(baseUrl+'/index',{method:'POST',headers:admin,body:JSON.stringify({instrument:'stock:us:AAPL'})})).status,403);
  assert.equal((await fetch(baseUrl+'/index',{method:'POST',headers:{...admin,'x-csrf-token':'fixture-csrf'},body:JSON.stringify({instrument:'stock:us:AAPL'})})).status,400);
  assert.equal((await fetch(baseUrl+'/index',{method:'POST',headers:csrf,body:JSON.stringify({instrument:'stock:us:AAPL',url:'http://localhost/'})})).status,400);
  assert.equal(loads,0);
  assert.equal((await fetch(baseUrl+'/index',{method:'POST',headers:csrf,body:JSON.stringify({instrument:'crypto:binance:BTCUSDT'})})).status,400);
  assert.equal((await fetch(baseUrl+'/index',{method:'POST',headers:csrf,body:JSON.stringify({instrument:'stock:us:AAPL',accession:'0000320193-24-000001'})})).status,201);
  assert.equal((await fetch(baseUrl+'/index',{method:'POST',headers:{...csrf,'idempotency-key':'index-request-0002'},body:JSON.stringify({instrument:'stock:us:AAPL'})})).status,201);
  const listed=await (await fetch(baseUrl+'?instrument=stock:us:AAPL',{headers:admin})).json();assert.equal(listed.data.length,2);
  const search=await (await fetch(baseUrl+'/search?instrument=stock:us:AAPL&q=tariffs&asOf=2026-01-01T00:00:00Z',{headers:admin})).json();
  assert.equal(search.data.length,2);assert.ok(search.data.every(row=>row.sectionKey==='item-1a-risk-factors'&&row.citation.includes(row.contentHash)));
  const base=listed.data.find(row=>row.accession.endsWith('24-000001')),current=listed.data.find(row=>row.accession.endsWith('25-000001'));
  const compared=await (await fetch(baseUrl+'/compare?'+new URLSearchParams({base:base.id,current:current.id}),{headers:admin})).json();
  assert.equal(compared.data.status,'comparable');assert.equal(compared.data.contentHash.length,64);assert.match(compared.data.sections[1].changes[0].currentCitation,new RegExp(current.id));
  const missing=await fetch(baseUrl+'/search?instrument=stock:us:MU&q=tariffs',{headers:admin});assert.equal((await missing.json()).dataStatus,'empty');
  const sections=await (await fetch(baseUrl+'/'+current.id+'/sections',{headers:admin})).json();const risk=sections.data.find(row=>row.sectionKey==='item-1a-risk-factors');assert.ok(risk);
  const annotationUrl=baseUrl+'/'+current.id+'/annotations';
  assert.equal((await fetch(annotationUrl,{method:'POST',headers:{...admin,'x-csrf-token':'fixture-csrf','idempotency-key':'annotation-request-0001'},body:JSON.stringify({sectionKey:risk.sectionKey,startParagraph:risk.endParagraph,endParagraph:risk.endParagraph,body:'Check supplier evidence.',expectedVersion:0})})).status,400);
  const annotationHeaders={...admin,'x-csrf-token':'fixture-csrf','idempotency-key':'annotation-request-0001','if-match':'"0"'};
  const annotationBody=JSON.stringify({sectionKey:risk.sectionKey,startParagraph:risk.endParagraph,endParagraph:risk.endParagraph,body:'Check supplier evidence.',expectedVersion:0});
  const first=await fetch(annotationUrl,{method:'POST',headers:annotationHeaders,body:annotationBody});assert.equal(first.status,201);const firstBody=await first.json();assert.equal(firstBody.data.revision,1);
  const repeated=await fetch(annotationUrl,{method:'POST',headers:annotationHeaders,body:annotationBody});assert.equal(repeated.status,201);assert.equal((await repeated.json()).data.revision,1);
  const history=await (await fetch(annotationUrl,{headers:admin})).json();assert.equal(history.data.length,1);assert.equal(history.instrument,'stock:us:AAPL');assert.match(history.data[0].citation,/p\d+$/);
 }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
