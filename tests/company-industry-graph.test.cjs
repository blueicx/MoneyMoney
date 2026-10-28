const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{JSDOM}=require('jsdom');
require('ts-node/register/transpile-only');

const now='2026-10-28T12:00:00.000Z';
function stateFixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-company-graph-')),{SQLiteStateStore}=require('../src/storage/sqlite-state'),state=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir);
  return Promise.resolve(fn(state,dir)).finally(()=>{state.close();fs.rmSync(dir,{recursive:true,force:true});});
}
function manifest(requestId='11111111-1111-4111-8111-111111111111'){
  const passed={market:'stocks',instrument:'stock:us:AAPL',kind:'company-relationship',source:'SEC fixture',publishedAt:'2026-01-01T00:00:00Z',observedAt:'2026-01-01T00:00:00Z',fetchedAt:'2026-01-02T00:00:00Z',contentHash:'a'.repeat(64),coverage:'complete',unknownReason:null};
  return {
    market:'stocks',requestId,asOf:now,
    nodes:[
      {id:'company:stock:us:AAPL',kind:'company',label:'Apple',instrument:'stock:us:AAPL'},
      {id:'company:stock:us:TSM',kind:'company',label:'TSMC',instrument:'stock:us:TSM'},
      {id:'company:private:display-partner',kind:'company',label:'Display partner'},
      {id:'industry:semiconductors',kind:'industry',label:'Semiconductors'},
    ],
    edges:[
      {id:'edge:supplier:tsm',from:'company:stock:us:AAPL',to:'company:stock:us:TSM',kind:'supplier',basis:'source-assertion',evidence:passed,effectiveFrom:'2026-01-01T00:00:00Z',exposurePct:60},
      {id:'edge:customer:display',from:'company:stock:us:AAPL',to:'company:private:display-partner',kind:'customer',basis:'research-inference',evidence:{...passed,source:'Research note'},effectiveFrom:'2026-01-01T00:00:00Z',exposurePct:40},
      {id:'edge:industry:semis',from:'company:stock:us:AAPL',to:'industry:semiconductors',kind:'industry-membership',basis:'source-assertion',evidence:{...passed,coverage:'partial',contentHash:null,fetchedAt:null,unknownReason:'历史抓取时间缺失'},effectiveFrom:'2026-01-01T00:00:00Z',exposurePct:10},
    ],
  };
}

test('company graph keeps inference and incomplete evidence out of concentration and confirms idempotently',async()=>{
  await stateFixture(async state=>{
    const {CompanyIndustryGraphStore}=require('../src/features/company-industry-graph'),store=new CompanyIndustryGraphStore(state,()=>Date.parse(now));
    const preview=store.preview(manifest());
    assert.equal(preview.status,'preview');
    assert.deepEqual(preview.summary,{companies:3,industries:1,events:0,edges:3,supportedEdges:1,inferredEdges:1,unverifiedEdges:1,edgesWithExposure:3});
    assert.equal(preview.edges.find(edge=>edge.id==='edge:customer:display').factStatus,'inferred');
    assert.equal(preview.edges.find(edge=>edge.id==='edge:industry:semis').factStatus,'unverified');
    const confirmation={expectedVersion:preview.revision,contentHash:preview.contentHash,acknowledge:true,confirmationKey:'company-confirm-0001',actor:'admin'};
    const confirmed=store.confirm(preview.id,confirmation);
    assert.equal(confirmed.status,'confirmed');
    assert.deepEqual(store.confirm(preview.id,confirmation),confirmed);
    assert.throws(()=>store.confirm(preview.id,{...confirmation,contentHash:'b'.repeat(64)}),/幂等键已用于不同/);
    const result=store.concentration({asOf:now,maxHops:2,positions:[{instrument:'stock:us:AAPL',weightPct:100}]});
    assert.equal(result.status,'calculated');
    assert.equal(result.indirectExposures.length,1);
    assert.equal(result.indirectExposures[0].instrument,'stock:us:TSM');
    assert.equal(result.indirectExposures[0].maxPathWeightPct,60);
    assert.equal(result.coverage.complete,false);
    assert.equal(result.coverage.exclusions.length,2);
    assert.ok(result.aggregateExposure.hhiLower>1);
    assert.equal(result.executionEnabled,false);
  });
});

test('company graph rejects future evidence ordering, unknown endpoints and tampered stored hashes',async()=>{
  await stateFixture(async state=>{
    const {CompanyIndustryGraphStore}=require('../src/features/company-industry-graph'),store=new CompanyIndustryGraphStore(state,()=>Date.parse(now));
    const reversed=manifest('22222222-2222-4222-8222-222222222222');
    reversed.edges[0].evidence={...reversed.edges[0].evidence,publishedAt:'2026-02-01T00:00:00Z',observedAt:'2026-01-01T00:00:00Z'};
    assert.throws(()=>store.preview(reversed),/时间顺序倒置/);
    const futureEvidence=manifest('55555555-5555-4555-8555-555555555555');
    futureEvidence.edges[0].evidence={...futureEvidence.edges[0].evidence,fetchedAt:'2026-11-01T00:00:00Z'};
    assert.throws(()=>store.preview(futureEvidence),/晚于关系图截止时间/);
    const missing=manifest('33333333-3333-4333-8333-333333333333');
    missing.edges[0].to='company:missing';
    assert.throws(()=>store.preview(missing),/节点不存在/);
    const preview=store.preview(manifest('44444444-4444-4444-8444-444444444444'));
    const raw=state.get('company-industry-graph:'+preview.id);
    raw.result.reason='tampered';
    state.set('company-industry-graph:'+preview.id,raw);
    assert.throws(()=>store.get(preview.id),/结果Hash不可核验/);
  });
});

test('company graph API requires admin, CSRF, If-Match and idempotency while keeping concentration read-only',async()=>{
  await stateFixture(async state=>{
    const express=require('express'),{CompanyIndustryGraphStore}=require('../src/features/company-industry-graph'),{createCompanyIndustryGraphRouter}=require('../src/web/company-industry-graph-routes');
    const store=new CompanyIndustryGraphStore(state,()=>Date.parse(now)),app=express();
    app.use(express.json());
    app.use((req,res,next)=>{req.user={role:req.get('x-role')==='admin'?'admin':'guest',username:'fixture-admin'};next();});
    app.use('/api/research/company-graph',createCompanyIndustryGraphRouter(store,{adminOnly:(req,res)=>{if(req.user.role==='admin')return true;res.status(403).json({success:false});return false;},csrfValid:req=>req.get('x-csrf-token')==='fixture-csrf'}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/api/research/company-graph',admin={'content-type':'application/json','x-role':'admin'},csrf={...admin,'x-csrf-token':'fixture-csrf'};
    try{
      assert.equal((await fetch(base+'?instrument=stock%3Aus%3AAAPL')).status,403);
      const body={...manifest(),requestId:undefined};delete body.requestId;
      assert.equal((await fetch(base+'/preview',{method:'POST',headers:admin,body:JSON.stringify(body)})).status,403);
      const previewResponse=await fetch(base+'/preview',{method:'POST',headers:{...csrf,'idempotency-key':'company-preview-0001'},body:JSON.stringify(body)});
      const previewPayload=await previewResponse.json();
      assert.equal(previewResponse.status,201,previewPayload.reason);
      const preview=previewPayload.data;
      const confirmBody=JSON.stringify({expectedVersion:preview.revision,contentHash:preview.contentHash,acknowledge:true});
      assert.equal((await fetch(base+'/'+preview.id+'/confirm',{method:'POST',headers:{...csrf,'idempotency-key':'company-confirm-0001'},body:confirmBody})).status,400);
      const confirmed=await fetch(base+'/'+preview.id+'/confirm',{method:'POST',headers:{...csrf,'idempotency-key':'company-confirm-0001','if-match':'"'+preview.revision+'"'},body:confirmBody});
      assert.equal(confirmed.status,200);
      const concentration=await (await fetch(base+'/concentration',{method:'POST',headers:csrf,body:JSON.stringify({asOf:now,positions:[{instrument:'stock:us:AAPL',weightPct:100}]})})).json();
      assert.equal(concentration.success,true);
      assert.equal(concentration.data.ordersCreated,0);
      assert.equal(store.concentration({asOf:now,positions:[{instrument:'stock:us:AAPL',weightPct:100}]}).modelCalls,0);
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
});

test('company graph UI cancels stale context requests and escapes saved record text',async()=>{
  const source=fs.readFileSync('src/web/public/company-industry-graph.js','utf8');
  assert.match(source,/Idempotency-Key/);assert.match(source,/If-Match/);assert.match(source,/AbortController/);assert.match(source,/research\/company-graph\/concentration/);
  const dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="fundamentals" data-instrument="stock:us:AAPL"><section data-workspace-id="fundamentals"><div class="collapse-body"></div></section></div>',{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.mm_isLoggedIn=true;w.mm_isGuest=false;
  let finish,signal;
  w.fetch=async(_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});};
  try{
    w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const oldPanel=w.document.getElementById('company-industry-graph'),pending=oldPanel.querySelector('[data-graph-list]').onclick();
    const shell=w.document.getElementById('market-workspace-shell');
    shell.dataset.instrument='stock:us:MSFT';w.dispatchEvent(new w.Event('mm-workspace-context'));
    const panel=w.document.getElementById('company-industry-graph');
    assert.equal(panel,oldPanel);assert.match(panel.textContent,/stock:us:MSFT/);assert.equal(signal.aborted,true);
    finish({ok:true,json:async()=>({success:true,data:[{id:'stale',asOf:'2026-10-28T00:00:00Z',status:'<img src=x onerror=alert(1)>',revision:1,contentHash:'<script>alert(2)<\/script>',manifestHash:'a'.repeat(64),instruments:['stock:us:AAPL'],summary:{edges:1,supportedEdges:1,inferredEdges:0,unverifiedEdges:0},confirmedAt:null,updatedAt:now}]})});
    await pending;assert.doesNotMatch(panel.textContent,/stale/);
    w.fetch=async()=>({ok:true,json:async()=>({success:true,data:[{id:'visible',asOf:'2026-10-28T00:00:00Z',status:'<img src=x onerror=alert(1)>',revision:1,contentHash:'<script>alert(2)<\/script>',manifestHash:'a'.repeat(64),instruments:['stock:us:MSFT'],summary:{edges:1,supportedEdges:1,inferredEdges:0,unverifiedEdges:0},confirmedAt:null,updatedAt:now}]})});
    await panel.querySelector('[data-graph-list]').onclick();
    assert.equal(panel.querySelector('img,script'),null);
    assert.match(panel.querySelector('[data-graph-records]').textContent,/<img src=x onerror=alert\(1\)>/);
  }finally{dom.window.close();}
});
