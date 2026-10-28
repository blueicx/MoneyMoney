const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
require('ts-node/register/transpile-only');

function hash(value){
  const canonical=(item)=>Array.isArray(item)?item.map(canonical):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,field])=>[key,canonical(field)])):item;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function plainHash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

function stateFixture(fn,label='core'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),`mm-${label}-`)),{SQLiteStateStore}=require('../src/storage/sqlite-state'),state=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir);
  return Promise.resolve(fn(state)).finally(()=>{state.close();fs.rmSync(dir,{recursive:true,force:true});});
}

test('legacy blind manifests without availability remain readable as published records',async()=> {
  await stateFixture(async state=>{
    const {BlindSessionStore}=require('../src/features/blind-sessions');
    const from=Date.parse('2026-01-01T00:00:00Z'),interval=300000,now=from+50*interval;
    const rows=Array.from({length:40},(_,i)=>({market:'stocks',instrument:'AAPL',timeframe:'5m',source:'fixture',timestamp:new Date(from+i*interval).toISOString(),published_at:new Date(from+(i+1)*interval).toISOString(),open:10+i,high:11+i,low:9+i,close:10+i,volume:100,closed:true}));
    const history={dataStatus:'historical',source:'fixture',snapshot:{id:'snapshot-fixture',contentHash:'a'.repeat(64)},rows};
    const blindStore=new BlindSessionStore(state,{resolve:(market,id)=>market==='stocks'?{id:'stock:us:AAPL',symbol:'AAPL'}:null,load:async()=>history},()=>now);
    const input={market:'stocks',instrument:'AAPL',timeframe:'5m',asOf:new Date(now).toISOString(),from:new Date(from).toISOString(),count:40,requestId:'11111111-1111-4111-8111-111111111111'};
    const preview=await blindStore.preview(input);
    const raw=state.get('blind-session:'+preview.id);
    delete raw.manifest.availability;
    raw.requestHash=plainHash({market:input.market,instrument:'stock:us:AAPL',timeframe:input.timeframe,asOf:input.asOf,from:input.from,count:input.count});
    raw.manifestHash=plainHash(raw.manifest);
    state.set('blind-session:'+preview.id,raw);
    const reopened=await new BlindSessionStore(state,{resolve:(market,id)=>({id:'stock:us:AAPL',symbol:'AAPL'}),load:async()=>history},()=>now).preview(input);
    assert.equal(reopened.availability,'published');
    assert.equal(reopened.manifestHash,raw.manifestHash);
  },'blind-legacy');
});

test('market replay hides decisions until every cited evidence frame is revealed',async()=> {
  await stateFixture(async state=>{
    const {createEvidenceSnapshot}=require('../src/features/decision-intelligence'),{MarketReplayStore}=require('../src/features/market-replay');
    const first='2026-01-01T01:00:00Z',second='2026-01-01T02:00:00Z',asOf='2026-01-01T03:00:00Z';
    const snapshot=(id,observedAt)=>createEvidenceSnapshot({id,market:'options',instrument:'option:cboe:AAPL',workspace:'options-research',dataStatus:'historical',source:{id:'cboe',name:'CBOE'},observedAt,fetchedAt:first,fields:{mark:1}});
    const snapshots={first:snapshot('first',first),second:snapshot('second',second)};
    const store=new MarketReplayStore(state,{resolve:(market,instrument)=>market==='options'?{id:instrument,symbol:'AAPL'}:null,evidence:id=>snapshots[id]||null},()=>Date.parse(asOf));
    let view=await store.preview({market:'options',instrument:'option:cboe:AAPL',asOf,requestId:'22222222-2222-4222-8222-222222222222',evidenceRefs:['first','second'],decisions:[{source:'manual',direction:'up',thesis:'Wait for both frames',invalidation:'Either frame reverses',evidenceRefs:['first','second'],availableAt:first}]});
    view=store.confirm(view.id,view.revision,view.manifestHash,true);
    assert.equal(view.decisions.length,0,'a decision cannot leak before its second evidence frame is revealed');
    view=store.advance(view.id,view.revision);
    assert.equal(view.decisions.length,1);
    assert.deepEqual(view.decisions[0].evidenceRefs,['first','second']);
  },'replay');
});

test('market replay rejects unsupported decisions without an evidence reference',async()=> {
  await stateFixture(async state=>{
    const {createEvidenceSnapshot}=require('../src/features/decision-intelligence'),{MarketReplayStore}=require('../src/features/market-replay');
    const first='2026-01-01T01:00:00Z',second='2026-01-01T02:00:00Z',asOf='2026-01-01T03:00:00Z';
    const snapshot=(id,observedAt)=>createEvidenceSnapshot({id,market:'options',instrument:'option:cboe:AAPL',workspace:'options-research',dataStatus:'historical',source:{id:'cboe',name:'CBOE'},observedAt,fetchedAt:first,fields:{mark:1}});
    const snapshots={first:snapshot('first',first),second:snapshot('second',second)};
    const store=new MarketReplayStore(state,{resolve:(market,instrument)=>market==='options'?{id:instrument,symbol:'AAPL'}:null,evidence:id=>snapshots[id]||null},()=>Date.parse(asOf));
    await assert.rejects(()=>store.preview({market:'options',instrument:'option:cboe:AAPL',asOf,requestId:'22222222-2222-4222-8222-222222222223',evidenceRefs:['first','second'],decisions:[{source:'manual',direction:'up',thesis:'Unsourced',invalidation:'None',evidenceRefs:[],availableAt:first}]}),/证据引用/);
  },'replay-evidence');
});

test('market replay canonicalizes Data Lake Date fields before persisting frame hashes',async()=> {
  await stateFixture(async state=>{
    const {MarketReplayStore}=require('../src/features/market-replay'),first=new Date('2026-01-01T01:00:00Z'),second=new Date('2026-01-01T02:00:00Z'),asOf='2026-01-04T00:00:00Z';
    const store=new MarketReplayStore(state,{resolve:(market,instrument)=>market==='stocks'?{id:instrument,symbol:'AAPL'}:null,evidence:()=>null,loadBars:async()=>({dataStatus:'historical',source:'fixture',snapshot:{id:'snapshot_observed_fixture',contentHash:'a'.repeat(64)},rows:[
      {market:'stocks',instrument:'AAPL',timeframe:'1d',source:'fixture',timestamp:first,published_at:first.toISOString(),availabilityObservedAt:first.toISOString(),open:100,high:102,low:99,close:101,volume:1},
      {market:'stocks',instrument:'AAPL',timeframe:'1d',source:'fixture',timestamp:second,published_at:second.toISOString(),availabilityObservedAt:second.toISOString(),open:101,high:103,low:100,close:102,volume:1},
    ]})},()=>Date.parse(asOf));
    const preview=await store.preview({market:'stocks',instrument:'stock:us:AAPL',asOf,requestId:'22222222-2222-4222-8222-222222222224',evidenceRefs:[],decisions:[]});
    assert.equal(preview.status,'preview');
    assert.equal(typeof state.get('market-replay:'+preview.id).frames[0].fields.timestamp,'string');
    assert.equal(store.view(preview.id).status,'preview');
  },'replay-date');
});

test('saved AI replay decisions come from the server record instead of editable client narrative',async()=> {
  await stateFixture(async state=>{
    const {createEvidenceSnapshot}=require('../src/features/decision-intelligence'),{MarketReplayStore}=require('../src/features/market-replay');
    const at='2026-01-01T01:00:00Z',next='2026-01-01T02:00:00Z',asOf='2026-01-01T03:00:00Z';
    const snapshot=(id,observedAt)=>createEvidenceSnapshot({id,market:'options',instrument:'option:cboe:AAPL',workspace:'options-research',dataStatus:'historical',source:{id:'cboe',name:'CBOE'},observedAt,fetchedAt:at,fields:{mark:1}});
    const snapshots={first:snapshot('first',at),second:snapshot('second',next)};
    const saved={id:'decision-fixture',market:'options',instrument:'option:cboe:AAPL',direction:'long',thesis:'Server thesis',counterEvidence:[],invalidation:{field:'mark',operator:'lt',value:0.5},horizonAt:asOf,evidenceIds:['first','second'],status:'open',createdAt:at};
    const store=new MarketReplayStore(state,{resolve:(market,instrument)=>market==='options'?{id:instrument,symbol:'AAPL'}:null,evidence:id=>snapshots[id]||null,decision:id=>id===saved.id?saved:null},()=>Date.parse(asOf));
    let view=await store.preview({market:'options',instrument:'option:cboe:AAPL',asOf,requestId:'33333333-3333-4333-8333-333333333333',evidenceRefs:['first','second'],decisions:[{source:'saved-ai',referenceId:saved.id,direction:'down',thesis:'Editable lie',invalidation:'Anything',evidenceRefs:['first','second'],availableAt:at}]});
    view=store.confirm(view.id,view.revision,view.manifestHash,true);
    assert.equal(view.decisions.length,0);
    view=store.advance(view.id,view.revision);
    assert.equal(view.decisions.length,1);
    assert.equal(view.decisions[0].direction,'up');
    assert.equal(view.decisions[0].thesis,'Server thesis');
    assert.match(view.decisions[0].invalidation,/mark lt 0\.5/);
  },'replay-saved-ai');
});

test('rolling strategy pipeline selects on training and keeps the sealed window unevaluated',()=> {
  const {runStrategyPipeline}=require('../src/features/strategy-pipeline');
  const start=Date.parse('2026-01-01T00:00:00Z');
  const bars=Array.from({length:30},(_,index)=>({time:start+index*86400000,open:100+index,high:102+index,low:99+index,close:101+index,volume:1000,publishedAt:start+index*86400000+3600000}));
  const calls=[];
  const result=runStrategyPipeline({bars,candidates:[{id:'a',hash:'a'.repeat(64),version:{}},{id:'b',hash:'b'.repeat(64),version:{}}],parameterBudget:2,trainBars:6,validationBars:3,sealedBars:5,
    evaluate:(candidate,phase,subset)=>{calls.push({candidate:candidate.id,phase,from:subset[0].time,to:subset.at(-1).time});return candidate.id==='a'?2:1;}});
  assert.ok(result.results.length>=1);
  assert.equal(result.sealedWindow.evaluated,false);
  assert.equal(result.sealedWindow.bars,5);
  assert.ok(calls.some(call=>call.phase==='training')&&calls.some(call=>call.phase==='validation'));
  assert.equal(Math.max(...calls.map(call=>call.to)),bars[24].time,'sealed bars never enter the evaluator');
  assert.ok(result.results.every(fold=>fold.selectedCandidateId==='a'));
});

test('option surface keeps missing IV and quotes as holes and never interpolates',()=> {
  const {buildOptionVolatilitySurface}=require('../src/features/options-volatility-surface');
  const fetchedAt='2026-01-01T12:00:00.000Z',expiryMs=Date.parse('2026-02-01T21:00:00.000Z');
  const row=(strike,iv,bid=1,ask=1.2)=>({instrumentName:`AAPL-${expiryMs}-${strike}-C`,strike,optionType:'call',markPrice:null,premiumUsd:null,impliedVolPct:iv,bidPrice:bid,askPrice:ask,spreadPct:10,volume:1,volumeUsd:null,openInterest:1,quoteTime:fetchedAt,contractCurrency:'USD',multiplier:100,quoteQuality:{status:'quoted',label:'quoted',referenceAsk:ask,referenceBid:bid}});
  const snapshot={source:'CBOE Delayed Quotes',asset:'AAPL',market:'us_equity',fetchedAt,spot:100,expiries:[{expiryMs,rows:[row(90,20),row(100,null),row(110,20,0,0)]}]};
  const data=buildOptionVolatilitySurface({id:'chain',market:'options',instrument:'option:cboe:AAPL',underlyingMarket:'stocks',source:'CBOE Delayed Quotes',fetchedAt,tradeDate:'2026-01-01',mode:'manual',contentHash:hash(snapshot),snapshot});
  assert.equal(data.status,'partial');
  assert.equal(data.nodes.length,1);
  assert.equal(data.coverage.sourceNodes,3);
  assert.deepEqual([...new Set(data.missing.map(item=>item.reason))].sort(),['来源IV缺失或超出0–400%','缺少有效双边报价或报价质量证据'].sort());
  assert.equal(data.interpolation,'none');
});

test('portfolio import preserves raw source, is idempotent and appends an explicit rollback version',async()=> {
  await stateFixture(async state=>{
    const {PortfolioImportLedgerStore}=require('../src/features/portfolio-import-ledger');
    const now=Date.parse('2026-01-03T00:00:00Z'),store=new PortfolioImportLedgerStore(state,{resolve:(market,instrument)=>market==='stocks'&&instrument==='AAPL'?{id:'stock:us:AAPL',symbol:'AAPL'}:null,
      companyActions:()=>({records:[{action:{id:'split',kind:'split',effectiveAt:'2026-01-02T00:00:00Z',factor:2},recordedAt:'2026-01-02T00:00:00Z',contentHash:'c'.repeat(64)}],coverage:'partial',reason:'fixture'})},()=>now);
    const content=JSON.stringify([{market:'stocks',instrument:'AAPL',currency:'USD',quantity:2,averageCost:80,price:90,fees:1,asOf:'2026-01-02T00:00:00Z',accountSource:'manual-file',accountId:'main'}]);
    const preview=await store.preview({fileName:'positions.json',format:'json',content,accountSource:'manual-file',accountId:'main',expectedVersion:0,acknowledge:true});
    assert.equal(preview.accepted.length,1);
    const requestId='33333333-3333-4333-8333-333333333333';
    const first=store.commit({previewId:preview.id,previewHash:preview.previewHash,expectedVersion:0,requestId,acknowledge:true});
    assert.equal(first.source.content,content);
    assert.equal(first.companyActions['stock:us:AAPL'].length,1);
    assert.deepEqual(store.commit({previewId:preview.id,previewHash:preview.previewHash,expectedVersion:0,requestId,acknowledge:true}),first);
    const rollback=store.rollback({accountSource:'manual-file',accountId:'main',targetVersionId:first.id,expectedVersion:1,requestId:'44444444-4444-4444-8444-444444444444',acknowledge:true});
    assert.equal(rollback.number,2);
    assert.equal(rollback.action,'rollback');
    assert.equal(rollback.source.content,content);
    assert.throws(()=>store.rollback({accountSource:'manual-file',accountId:'main',targetVersionId:first.id,expectedVersion:2,requestId:'55555555-5555-4555-8555-555555555555',acknowledge:true,extra:true}),/回滚|字段/);
    assert.equal(store.versions('manual-file','main').length,2);
    assert.equal(store.versions('manual-file','main')[0].source.content,undefined);
  },'portfolio-import');
});

test('company and macro research separates revisions, association, causation and scenario assumptions',async()=> {
  await stateFixture(async state=>{
    const {createEvidenceSnapshot}=require('../src/features/decision-intelligence'),{CompanyMacroResearchStore}=require('../src/features/company-macro-research');
    const at='2026-01-02T00:00:00.000Z',later='2026-01-02T01:00:00.000Z',asOf='2026-01-03T00:00:00.000Z';
    const first=createEvidenceSnapshot({id:'company-first',market:'stocks',instrument:'stock:us:AAPL',workspace:'company-research',dataStatus:'historical',source:{id:'sec',name:'SEC EDGAR'},observedAt:at,fetchedAt:at,fields:{revenue:100,marginPct:20}});
    const second=createEvidenceSnapshot({id:'company-second',market:'stocks',instrument:'stock:us:AAPL',workspace:'company-research',dataStatus:'historical',source:{id:'sec',name:'SEC EDGAR'},observedAt:later,fetchedAt:later,fields:{revenue:110,marginPct:22}});
    const snapshots={[first.id]:first,[second.id]:second},store=new CompanyMacroResearchStore(state,{evidence:id=>snapshots[id]||null},()=>Date.parse(asOf));
    const row=await store.preview({market:'stocks',instrument:'stock:us:AAPL',asOf,requestId:'66666666-6666-4666-8666-666666666666',evidenceRefs:[first.id,second.id],
      hypotheses:[{statement:'Revenue increased',relation:'observed',evidenceRefs:[first.id,second.id]},{statement:'Margin causes demand',relation:'causal',evidenceRefs:[first.id,second.id]}],
      scenarios:[{id:'base',label:'Base',evidenceRef:'company-second',baseField:'revenue',growthPct:10,years:2,operatingMarginPct:20,multiple:8}]});
    assert.equal(row.revisions[0].changes.find(item=>item.field==='revenue').after.value,110);
    assert.equal(row.hypotheses[0].inferenceClass,'direct-observation');
    assert.equal(row.hypotheses[1].inferenceClass,'causal-not-established');
    assert.equal(row.scenarios[0].status,'calculated');
    assert.ok(Math.abs(row.scenarios[0].projectedValue-133.1)<1e-9);
    assert.equal(row.modelCalls,0);
    const confirmed=store.confirm(row.id,row.revision,row.resultHash,true);
    assert.equal(confirmed.status,'confirmed');
  },'company-macro');
});

test('research assistant defaults to deterministic evidence mode and blocks unconfigured model calls',async()=> {
  await stateFixture(async state=>{
    const {createEvidenceSnapshot}=require('../src/features/decision-intelligence'),{EvidenceResearchAssistant}=require('../src/features/evidence-research-assistant');
    const at='2026-01-02T00:00:00.000Z',asOf='2026-01-03T00:00:00.000Z';
    const evidence=createEvidenceSnapshot({id:'assistant-evidence',market:'stocks',instrument:'stock:us:AAPL',workspace:'research-assistant',dataStatus:'historical',source:{id:'sec',name:'SEC EDGAR'},observedAt:at,fetchedAt:at,fields:{revenue:100}});
    const assistant=new EvidenceResearchAssistant(state,{evidence:id=>id===evidence.id?evidence:null},()=>Date.parse(asOf));
    const base={market:'stocks',instrument:'stock:us:AAPL',asOf,question:'What is supported?',evidenceRefs:[evidence.id]};
    const output=await assistant.run({...base,mode:'evidence',requestId:'77777777-7777-4777-8777-777777777777'});
    assert.equal(output.modelCalls,0);
    assert.equal(output.estimatedCostUsd,0);
    assert.match(output.answer,/SEC EDGAR/);
    await assert.rejects(()=>assistant.run({...base,mode:'model',requestId:'88888888-8888-4888-8888-888888888888',model:{provider:'openrouter',model:'fixture/model',maxCostUsd:0.2,feeAcknowledged:true}}),/未配置/);
  },'assistant');
});

test('portfolio configurations keep currency groups separate and compute correlation only from complete comparable curves',async()=> {
  await stateFixture(async state=>{
    const {PortfolioConfigurationStore}=require('../src/features/portfolio-configurations');
    const simA='psim_'+'a'.repeat(64),simB='psim_'+'b'.repeat(64);
    const view=(id,equity,currency='USD')=>({id,market:'stocks',currency,manifestHash:(id.endsWith('a'.repeat(64))?'d':'e').repeat(64),source:'fixture-source',evidenceRefs:['snapshot-'+id],shared:{performance:{startingCash:1000,equity,totalReturnPct:(equity/1000-1)*100,maxDrawdownPct:8,dataStatus:'complete'},equityCurve:[1000,1010,995,1020],orders:[{}]}});
    const views={[simA]:view(simA,1020),[simB]:view(simB,1040)},store=new PortfolioConfigurationStore(state,{simulation:id=>views[id]||null},()=>Date.parse('2026-01-03T00:00:00Z'));
    const constraints={maxPositions:5,maxInvestedPct:80,maxSinglePositionPct:30,maxDrawdownPct:20,feeBps:5,slippageBps:3};
    const first=store.save({market:'stocks',name:'Balanced',requestId:'99999999-9999-4999-8999-999999999999',simulationIds:[simA,simB],weights:{[simA]:50,[simB]:50},constraints});
    assert.equal(first.aggregate.underweightPct,0);
    assert.equal(first.correlation.status,'computed');
    assert.deepEqual(store.save({market:'stocks',name:'Balanced',requestId:'99999999-9999-4999-8999-999999999999',simulationIds:[simA,simB],weights:{[simA]:50,[simB]:50},constraints}),first);
    assert.throws(()=>store.save({market:'stocks',name:'Changed',requestId:'99999999-9999-4999-8999-999999999999',simulationIds:[simA,simB],weights:{[simA]:50,[simB]:50},constraints}),/请求ID/);
    assert.equal(store.list('stocks').length,1);
    views[simB]=view(simB,1040,'USDT');
    assert.throws(()=>store.save({market:'stocks',name:'Mixed',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',simulationIds:[simA,simB],constraints}),/币种/);
  },'portfolio-config');
});
