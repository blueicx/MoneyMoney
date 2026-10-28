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
test('stable filing sections align only same-form documents and preserve both paragraph citations',()=>{
 const s=store();try{
 const base=s.index(input({accession:'0000320193-24-000001',sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019324000001/report.htm',publishedAt:'2024-01-01T12:00:00Z',retrievedAt:'2024-01-02T12:00:00Z',text:'Item 1. Business\n\nWe sell devices and services.\n\nItem 1A. Risk Factors\n\nTariffs and supply chain disruptions could affect our business.\n\nItem 7. Management\'s Discussion and Analysis\n\nRevenue increased due to demand.'}));
 const current=s.index(input({text:'Item 1. Business\n\nWe sell devices, services and software.\n\nItem 1A. Risk Factors\n\nTariffs, component shortages and supply chain disruptions could affect our business.\n\nItem 7. Management\'s Discussion and Analysis\n\nRevenue increased due to demand and services.'}));
 const sectionRows=s.sections(base.id);assert.deepEqual(sectionRows.map(row=>row.sectionKey),['item-1-business','item-1a-risk-factors','item-7-management-discussion-and-analysis']);
 assert.match(sectionRows[1].citation,new RegExp(base.id+':'+base.contentHash+':item-1a-risk-factors:p\\*'));
 const hit=s.search({instrument:'stock:us:AAPL',query:'tariffs',asOf:'2026-02-01T00:00:00Z'})[0];
 assert.equal(hit.sectionKey,'item-1a-risk-factors');assert.match(hit.sectionHeading,/Risk Factors/);assert.match(hit.citation,/p4$/);
 const compared=s.compare(base.id,current.id);assert.equal(compared.status,'comparable');assert.equal(compared.accountingScope,'annual-financial-statements');assert.equal(compared.summary.alignedSections,3);
 const risk=compared.sections.find(row=>row.sectionKey==='item-1a-risk-factors');assert.equal(risk.status,'aligned');assert.equal(risk.changes[0].kind,'changed');assert.match(risk.changes[0].baseCitation,new RegExp(base.id+':'+base.contentHash));assert.match(risk.changes[0].currentCitation,new RegExp(current.id+':'+current.contentHash));assert.equal(compared.contentHash.length,64);
 }finally{s.close();}
});
test('filing comparison marks form-scope and identity mismatches incomparable instead of forcing alignment',()=>{
 const s=store();try{
 const annual=s.index(input({text:'Item 1. Business\n\nAnnual business evidence.\n\nItem 1A. Risk Factors\n\nAnnual risk evidence.'}));
 const quarterly=s.index(input({accession:'0000320193-25-000002',sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019325000002/report.htm',form:'10-Q',publishedAt:'2025-05-01T00:00:00Z',retrievedAt:'2025-05-02T00:00:00Z',text:'Item 1. Financial Statements\n\nQuarterly statements.\n\nItem 2. Management\'s Discussion and Analysis\n\nQuarterly discussion.'}));
 const mismatch=s.compare(annual.id,quarterly.id);assert.equal(mismatch.status,'incomparable');assert.match(mismatch.reasons.join(' '),/表单口径不同/);assert.deepEqual(mismatch.sections,[]);
 const otherInstrument=s.index(input({instrument:'stock:us:MSFT',accession:'0000789019-25-000001',sourceUrl:'https://www.sec.gov/Archives/edgar/data/789019/000078901925000001/report.htm',text:'Item 1. Business\n\nOther issuer business.\n\nItem 1A. Risk Factors\n\nOther issuer risk.'}));
 assert.match(s.compare(annual.id,otherInstrument.id).reasons.join(' '),/身份不一致/);
 }finally{s.close();}
});
test('versioned annotations are append-only, section-bounded, hash-bound and idempotent',()=>{
 const s=store();try{
 const document=s.index(input({text:'Item 1. Business\n\nWe sell devices.\n\nItem 1A. Risk Factors\n\nTariffs and supply chain disruptions could affect our business.\n\nItem 7. Management\'s Discussion and Analysis\n\nRevenue increased due to demand.'}));
 const first=s.annotate({documentId:document.id,sectionKey:'item-1a-risk-factors',startParagraph:4,endParagraph:4,body:'Need supplier concentration evidence.',author:'admin',expectedVersion:0,idempotencyKey:'annotation:first:0001',createdAt:'2025-01-03T00:00:00Z'});
 const repeated=s.annotate({documentId:document.id,sectionKey:'item-1a-risk-factors',startParagraph:4,endParagraph:4,body:'Need supplier concentration evidence.',author:'admin',expectedVersion:0,idempotencyKey:'annotation:first:0001',createdAt:'2025-01-03T00:00:00Z'});
 assert.deepEqual(repeated,first);assert.equal(first.revision,1);assert.equal(first.contentHash,document.contentHash);assert.match(first.citation,/item-1a-risk-factors:p4/);
 assert.throws(()=>s.annotate({documentId:document.id,sectionKey:'item-1a-risk-factors',startParagraph:4,endParagraph:4,body:'Changed body',author:'admin',expectedVersion:0,idempotencyKey:'annotation:first:0001'}),/幂等键已用于不同/);
 assert.throws(()=>s.annotate({documentId:document.id,sectionKey:'item-1a-risk-factors',startParagraph:3,endParagraph:5,body:'Wrong range',author:'admin',expectedVersion:1,idempotencyKey:'annotation:wrong:0001'}),/段落范围/);
 assert.throws(()=>s.annotate({documentId:document.id,sectionKey:'item-1a-risk-factors',startParagraph:4,endParagraph:4,body:'Stale',author:'admin',expectedVersion:0,idempotencyKey:'annotation:stale:0001'}),/版本冲突/);
 const second=s.annotate({documentId:document.id,sectionKey:'item-1a-risk-factors',startParagraph:4,endParagraph:4,body:'Supplier evidence checked.',author:'admin',expectedVersion:1,idempotencyKey:'annotation:second:0002',createdAt:'2025-01-04T00:00:00Z'});
 assert.equal(second.revision,2);assert.deepEqual(s.annotations(document.id).map(row=>row.revision),[1,2]);
 }finally{s.close();}
});
