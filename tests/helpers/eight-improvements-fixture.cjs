// Only run in an explicitly isolated test data directory.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.match(process.env.MONEYMONEY_DATA_DIR||'',/mm-eight-browser-/);
const {dataLakeCatalog:c}=require('../../dist/storage/data-lake');
const {researchRepository}=require('../../dist/features/research-repository');
const {stateStore}=require('../../dist/storage/sqlite-state');
(async()=>{
 c.registerInstrument({type:'stock',venue:'us',symbol:'AAPL',title:'ISOLATED FIXTURE',aliases:[]});
 c.registerProviderContract({id:'seven-fixture',provider:'seven-fixture',market:'stocks',datasets:['bars'],timezone:'UTC',units:{price:'USD',volume:'shares'},revisionPolicy:'point-in-time'});
 const references=[];
 for(let i=0;i<2;i++){
  const day=20+i,stamp=`2026-10-${day}T00:00:00.000Z`;
  await c.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'seven-fixture',adjustment:'unadjusted',publishedAt:`2026-10-${day}T12:00:00.000Z`,rows:[{timestamp:stamp,open:100,high:120,low:90,close:100+i*10,volume:100}],units:{price:'USD',volume:'shares'}});
  references.push((await c.queryBarsAsOf({market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:`2026-10-${day}T23:00:00.000Z`})).snapshot.id);
 }
 const fetchedAt=new Date().toISOString(),expiryMs=Date.UTC(2026,11,25,20);
 const chain=c.saveOptionsChainSnapshot({market:'options',instrument:'option:cboe:AAPL',underlyingMarket:'stocks',source:'CBOE Delayed Quotes',fetchedAt,mode:'manual',snapshot:{source:'CBOE Delayed Quotes',asset:'AAPL',market:'us_equity',fetchedAt,spot:100,expiries:[{expiryMs,rows:[100,110].map(strike=>({instrumentName:`AAPL261225C${String(strike*1000).padStart(8,'0')}`,strike,optionType:'call',bidPrice:4,askPrice:5,spreadPct:5,volume:10,openInterest:10,impliedVolPct:40,quoteTime:fetchedAt}))}]}});
 researchRepository.saveSourceHealth('stocks',{updatedAt:fetchedAt,items:[{id:'fixture-saved-source',name:'ISOLATED SAVED SOURCE',ok:false,status:'unavailable',checkedAt:fetchedAt,detail:'Offline fixture, not a real provider acceptance'}]});
 const ledger={startingCash:1000,cash:800,positions:[{instrumentId:'stock:us:AAPL',instrumentType:'stock',title:'ISOLATED AAPL',quantity:2,averageEntryPrice:100,currentPrice:100,openedAt:'2026-10-20T00:00:00Z',realizedPnl:0,currency:'USD'}],orders:[],realizedPnl:0,peakEquity:1000,maxDrawdownPct:0};
 stateStore.set('paper-ledger',ledger);
 const interval=300000,barTime=Math.floor(Date.now()/interval)*interval-interval;
 await c.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'5m',source:'seven-fixture',publishedAt:new Date().toISOString(),units:{price:'USD',volume:'shares'},rows:[{timestamp:new Date(barTime).toISOString(),open:99,high:101,low:98,close:100,volume:10}]});
 const {AiForecastLab}=require('../../dist/features/ai-forecast-lab');
 const lab=new AiForecastLab(stateStore,{resolve:(market,id)=>c.resolveInstrument(market,id),load:input=>c.queryBarsAsOf(input),configured:()=>false,request:()=>{throw Error('fixture never calls a model');}});
 const forecast=await lab.preview({market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',horizonBars:20,model:'fixture/frozen-model',requestId:require('node:crypto').randomUUID(),callLimit:1});
 const {ResearchProjectStore}=require('../../dist/features/research-projects'),{createProjectReferenceResolver}=require('../../dist/features/research-project-references');
 const projects=new ResearchProjectStore(stateStore,createProjectReferenceResolver({evidence:()=>null,verifyEvidence:()=>false,partition:id=>c.listPartitions().find(p=>p.id===id)||null,experiment:id=>researchRepository.getExperiment(id),decision:()=>null,signal:()=>null}));
 let project=projects.create({market:'stocks',title:'ISOLATED eight research',question:'Fixed evidence?',hypothesis:'Frozen source remains comparable',counterEvidence:'Missing metadata',acceptance:'Saved data and reasons only'});
 project=projects.link(project.id,project.version,{kind:'partition',id:c.getSnapshot(references[0]).partitionId});
 const baseInput={context:{market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',dataSnapshotHash:project.links[0].hash},prices:[100,110],signals:[]},experiment={id:'fixture_saved_experiment',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:new Date().toISOString(),parameters:{feeRate:.005},dataSnapshotHash:project.links[0].hash};
 const savedExperiment={input:baseInput,experiment,backtest:{metrics:{tradesCount:2}},inputHash:require('node:crypto').createHash('sha256').update(JSON.stringify(baseInput)).digest('hex')};
 researchRepository.saveExperimentOnce(experiment.id,savedExperiment);
 fs.writeFileSync(path.join(process.env.MONEYMONEY_DATA_DIR,'fixture.json'),JSON.stringify({references,optionSnapshotId:chain.id,fetchedAt,forecastId:forecast.id,projectId:project.id,projectVersion:project.version,linkId:project.links[0].linkId,experimentId:experiment.id}));
 c.close();stateStore.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
