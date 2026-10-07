const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
const input=(extra={})=>({instrument:'stock:us:AAPL',accession:'0000320193-25-000001',form:'10-K',sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/report.htm',publishedAt:'2025-01-01T12:00:00Z',retrievedAt:'2025-01-02T12:00:00Z',text:'Item 1A Risk Factors. Tariffs and supply chain disruptions could affect our business.\n\nItem 7 Management discussion. Revenue increased due to demand.',...extra});
function store(){const {FinancialTextIndex}=require('../src/storage/financial-text-index');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-filings-'));return new FinancialTextIndex(path.join(dir,'state.sqlite'));}
test('official filing paragraphs are persisted with deterministic hash and idempotent indexing',()=>{
 const s=store();try{const a=s.index(input()),b=s.index(input());assert.equal(a.id,b.id);assert.equal(a.contentHash,b.contentHash);assert.equal(s.list('stock:us:AAPL').length,1);
 const r=s.search({instrument:'stock:us:AAPL',query:'tariffs',asOf:'2025-02-01T00:00:00Z'});assert.equal(r.length,1);assert.match(r[0].text,/Tariffs/);assert.equal(r[0].sourceUrl,input().sourceUrl);assert.equal(r[0].paragraph,1);assert.equal(r[0].page,null);
 }finally{s.close();}
});
test('FTS search is instrument-scoped, publication-bounded and not SQL/FTS code execution',()=>{
 const s=store();try{s.index(input());s.index(input({instrument:'stock:us:MU',accession:'0000723125-25-000001',sourceUrl:'https://www.sec.gov/Archives/edgar/data/723125/000072312525000001/report.htm',text:'Tariffs affect memory suppliers.'}));
 assert.equal(s.search({instrument:'stock:us:AAPL',query:'tariffs',asOf:'2024-12-31T23:59:59Z'}).length,0);
 assert.equal(s.search({instrument:'stock:us:SNDK',query:'tariffs',asOf:'2025-02-01T00:00:00Z'}).length,0);
 assert.equal(s.search({instrument:'stock:us:AAPL',query:'tariffs OR memory',asOf:'2025-02-01T00:00:00Z'}).length,0);
 assert.throws(()=>s.search({instrument:'crypto:binance:BTCUSDT',query:'tariffs'}),/美国股票/);
 assert.throws(()=>s.index(input({text:input().text+' revised'})),/变化|修订/);
 }finally{s.close();}
});
test('index rejects nonofficial URLs, inconsistent accession and unknown publication chronology',()=>{
 const s=store();try{
 for(const extra of [{sourceUrl:'http://127.0.0.1/a'},{sourceUrl:'https://www.sec.gov.evil.test/Archives/edgar/data/1/000032019325000001/x.htm'},{sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019325000002/x.htm'},{publishedAt:'2026-01-01T00:00:00Z'},{text:''},{form:'paid-transcript'}])assert.throws(()=>s.index(input(extra)));
 }finally{s.close();}
});
test('filing HTML extraction strips executable/hidden blocks without rendering fetched markup',()=>{
 const {filingHtmlText}=require('../src/storage/financial-text-index');
 const text=filingHtmlText('<script>alert(1)</script><style>.a{}</style><ix:header>hidden XBRL</ix:header><p>Risk &amp; revenue</p><p>Tariffs &#38; costs</p>');
 assert.match(text,/Risk & revenue/);assert.match(text,/Tariffs & costs/);assert.doesNotMatch(text,/alert|hidden XBRL|<p>|\.a/);
});
