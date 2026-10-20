const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');require('ts-node/register/transpile-only');process.env.MONEYMONEY_DATA_DIR ||=fs.mkdtempSync(path.join(os.tmpdir(),'mm-project-reference-'));
test('event references resolve only the exact verified stored event evidence, never a similarly named snapshot',()=>{
 const {createProjectReferenceResolver}=require('../src/features/research-project-references');const e={id:'event-evidence-news-1',workspace:'event-intelligence',market:'stocks',instrument:'stock:us:AAPL',hash:'c'.repeat(64),dataStatus:'historical',fetchedAt:'2026-01-02T00:00:00Z'};
 const sources={evidence:id=>id===e.id?e:null,verifyEvidence:()=>true,partition:()=>null,experiment:()=>null,decision:()=>null,signal:()=>null},resolve=createProjectReferenceResolver(sources);
 assert.equal(resolve({kind:'event',id:'news-1'})?.hash,e.hash);assert.equal(resolve({kind:'event',id:e.id}),null);e.workspace='other';assert.equal(resolve({kind:'event',id:'news-1'}),null);e.workspace='event-intelligence';sources.verifyEvidence=()=>false;assert.equal(resolve({kind:'event',id:'news-1'}),null);
});
test('project reference adapter preserves native signal timestamps and rejects unverified or cross-kind records',()=>{
 let create;try{create=require('../src/features/research-project-references').createProjectReferenceResolver;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}assert.equal(typeof create,'function','project references require one explicit existing-store adapter');
 const at=Date.parse('2026-01-01T00:00:00Z'),signal={id:'s1',market:'stocks',instrument:'stock:us:AAPL',triggeredAt:at,expiresAt:at+3600000,source:'isolated'};
 const resolve=create({evidence:()=>null,verifyEvidence:()=>false,partition:()=>null,experiment:()=>null,decision:()=>null,signal:id=>id==='s1'?signal:null},()=>at+7200000);
 const result=resolve({kind:'signal',id:'s1'});assert.equal(result.updatedAt,'2026-01-01T00:00:00.000Z');assert.equal(result.expired,true);assert.match(result.hash,/^[a-f0-9]{64}$/);assert.equal(resolve({kind:'decision',id:'s1'}),null);assert.equal(resolve({kind:'account',id:'s1'}),null);
 const fake=create({evidence:()=>({id:'e1',market:'stocks',hash:'a'.repeat(64),fetchedAt:'2026-01-01'}),verifyEvidence:()=>false,partition:()=>null,experiment:()=>null,decision:()=>null,signal:()=>null});assert.equal(fake({kind:'evidence',id:'e1'}),null);
});
test('immutable partition refs report only explicit overlapping nonfuture revision descendants',()=>{
 const {createProjectReferenceResolver}=require('../src/features/research-project-references');const base={market:'stocks',instrument:'AAPL',dataset:'bars',timeframe:'1d',periodStart:'2026-01-01',periodEnd:'2026-01-31',status:'committed',fetchedAt:'2026-02-01T00:00:00Z',publishedAt:'2026-02-01T00:00:00Z'};
 const partitions=[{...base,id:'p-old',contentHash:'a'.repeat(64)},{...base,id:'p-new',contentHash:'b'.repeat(64),publishedAt:'2026-02-10T00:00:00Z'}],revisions=partitions.map((p,i)=>({id:'r-'+i,market:p.market,instrument:p.instrument,dataset:p.dataset,timeframe:p.timeframe,partitionId:p.id,contentHash:p.contentHash,publishedAt:p.publishedAt,...(i?{supersedes:'r-0'}:{})}));
 const sources={evidence:()=>null,verifyEvidence:()=>false,experiment:()=>null,decision:()=>null,signal:()=>null,partition:id=>partitions.find(p=>p.id===id),revisions:()=>revisions,partitions:()=>partitions};const ref={kind:'partition',id:'p-old'};
 assert.equal(createProjectReferenceResolver(sources,()=>Date.parse('2026-02-05'))(ref).revisionHash,undefined);const revised=createProjectReferenceResolver(sources,()=>Date.parse('2026-02-15'))(ref);assert.equal(revised.hash,'a'.repeat(64));assert.equal(revised.revisionHash,'b'.repeat(64));
 partitions[1].periodStart='2026-02-01';partitions[1].periodEnd='2026-02-10';assert.equal(createProjectReferenceResolver(sources,()=>Date.parse('2026-02-15'))(ref).revisionHash,undefined);
});
