require('ts-node/register/transpile-only');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {DataLakeCatalog}=require('../src/storage/data-lake');
const {createSavedStressSourceAdapters}=require('../src/features/saved-stress-source-adapters');

test('price adapter reads exact saved refs, canonicalizes identity, derives evidenced currency, and never creates refs',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stress-source-adapter-')),catalog=new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:path.join(root,'catalog.sqlite')});
 try{
  catalog.registerInstrument({type:'stock',venue:'us',symbol:'AAPL',title:'Apple',aliases:[]});
  catalog.registerProviderContract({id:'fixture',provider:'fixture',market:'stocks',datasets:['bars'],timezone:'UTC',units:{price:'USD',volume:'shares'},revisionPolicy:'point-in-time'});
  const rows=[{timestamp:'2026-10-01T00:00:00.000Z',open:10,high:12,low:9,close:11,volume:1}];
  await catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-10-01T12:00:00.000Z',rows,units:{price:'USD',volume:'shares'}});
  const saved=await catalog.queryBarsAsOf({market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:'2026-10-02T00:00:00.000Z'}),before=catalog.listSnapshots({market:'stocks',instrument:'AAPL',timeframe:'1d'}).length;
  const adapters=createSavedStressSourceAdapters({catalog,ledger:{get:()=>({positions:[],orders:[],startingCash:0,cash:0,realizedPnl:0,peakEquity:0,maxDrawdownPct:0})}});
  const snapshot=await adapters.loadSnapshot(saved.snapshot.id);
  assert.deepEqual({id:snapshot.id,hash:snapshot.contentHash,identity:snapshot.identity,market:snapshot.market,currency:snapshot.currency,price:snapshot.price},{id:saved.snapshot.id,hash:saved.snapshot.contentHash,identity:'stock:us:AAPL',market:'stocks',currency:'USD',price:11});
  assert.equal(snapshot.asOf,'2026-10-02T00:00:00.000Z');assert.equal(snapshot.stale,false);assert.equal(snapshot.freshUntil,undefined);
  catalog.registerProviderContract({id:'fixture',provider:'fixture',market:'stocks',datasets:['bars'],timezone:'UTC',units:{price:'EUR',volume:'shares'},revisionPolicy:'point-in-time'});
  const historical=await catalog.readSnapshotBarsExact(saved.snapshot);
  assert.equal(historical.currency,'USD');assert.equal(historical.sourceCapturedAt,null);assert.ok(historical.serverFetchedAt);
  assert.equal(catalog.listSnapshots({market:'stocks',instrument:'AAPL',timeframe:'1d'}).length,before);
  assert.equal(adapters.isRegisteredIdentity('stock:us:AAPL'),true);assert.equal(adapters.isRegisteredIdentity('AAPL'),false);assert.equal(await adapters.loadSnapshot('missing'),null);
 }finally{catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('option adapter exposes only catalog-validated saved chains and bounds snapshot lists',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stress-option-adapter-')),catalog=new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:path.join(root,'catalog.sqlite')});
 try{
  catalog.registerInstrument({type:'stock',venue:'us',symbol:'AAPL',title:'Apple',aliases:[]});
  const instrument='option:cboe:AAPL',fetchedAt='2026-10-02T14:00:00.000Z';
  const saved=catalog.saveOptionsChainSnapshot({market:'options',instrument,underlyingMarket:'stocks',source:'CBOE Delayed Quotes',fetchedAt,mode:'manual',snapshot:{source:'CBOE Delayed Quotes',market:'us_equity',asset:'AAPL',fetchedAt,spot:200,expiries:[{expiryMs:Date.UTC(2026,9,30,20),rows:[{instrumentName:'AAPL261030C00200000',strike:200,optionType:'call',bidPrice:1,askPrice:2}]}]}});
  const adapters=createSavedStressSourceAdapters({catalog,ledger:{get:()=>({positions:[],orders:[],startingCash:0,cash:0,realizedPnl:0,peakEquity:0,maxDrawdownPct:0})}});
  assert.equal(adapters.loadOptionSnapshot(saved.id).contentHash,saved.contentHash);
  assert.equal(adapters.listSavedOptionSnapshots('owner').length,1);
  assert.equal(adapters.loadOptionSnapshot('not-found'),null);
 }finally{catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('paper holdings include stable account-scoped IDs and never fetch or mutate marks',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stress-paper-adapter-')),catalog=new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:path.join(root,'catalog.sqlite')});
 try{
  catalog.registerInstrument({type:'stock',venue:'us',symbol:'AAPL',title:'Apple',aliases:[]});
  catalog.registerProviderContract({id:'fixture',provider:'fixture',market:'stocks',datasets:['bars'],timezone:'UTC',units:{price:'USD',volume:'shares'},revisionPolicy:'point-in-time'});
  await catalog.stageBars({market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',source:'fixture',publishedAt:'2026-10-01T12:00:00.000Z',rows:[{timestamp:'2026-10-01T00:00:00.000Z',open:10,high:11,low:9,close:10,volume:1}],units:{price:'USD',volume:'shares'}});
  const saved=await catalog.queryBarsAsOf({market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:'2026-10-02T00:00:00.000Z'});
  const ledger={positions:[{instrumentId:'stock:us:AAPL',instrumentType:'stock',title:'Apple',quantity:2,averageEntryPrice:100,currentPrice:110,openedAt:'2026-09-01T00:00:00Z',realizedPnl:0,currency:'USD',markUpdatedAt:'2026-10-01T00:00:00Z',markSource:'saved ledger mark'}],orders:[],startingCash:1000,cash:780,realizedPnl:0,peakEquity:1000,maxDrawdownPct:0,runnerAccounts:{'ai-runner:a':{accountId:'ai-runner:a',runnerId:'a',positions:[{instrumentId:'stock:us:AAPL',instrumentType:'stock',title:'Apple',quantity:1,averageEntryPrice:100,currentPrice:105,openedAt:'2026-09-02T00:00:00Z',realizedPnl:0,currency:'USD'}],orders:[],startingCash:1000,cash:895,realizedPnl:0,peakEquity:1000,maxDrawdownPct:0}}};
  let reads=0;const adapters=createSavedStressSourceAdapters({catalog,ledger:{get:()=>{reads++;return ledger;}}});const rows=adapters.loadPaperHoldings('admin');
  assert.equal(rows.length,2);assert.notEqual(rows[0].positionId,rows[1].positionId);assert.deepEqual(rows.map(row=>row.accountId).sort(),['ai-runner:a','unified-paper-ledger']);assert.equal(reads,1);assert.equal(rows[0].markSource,'saved ledger mark');assert.equal(rows[0].identity,'stock:us:AAPL');
  assert.deepEqual(rows[0].snapshotRefs,[saved.snapshot.id]);assert.equal((await adapters.loadSnapshot(rows[0].snapshotRefs[0])).price,10);
 }finally{catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});
