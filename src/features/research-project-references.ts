import {createHash} from 'node:crypto';
import type {EvidenceSnapshot,DecisionRecord,SignalOutcome} from './decision-intelligence';
import type {DatasetPartition,DataRevision} from '../storage/data-lake';
import {buildResearchRevisionImpact} from './research-revision-impact';
import type {ProjectReference,ProjectReferenceState} from './research-projects';
import type {MarketId} from './research-contracts';
import type {ResearchJob} from './research-contracts';
import type {StrategyCandidate} from './strategy-candidates';
import type {UnifiedPaperRunnerAccount} from './unified-paper-trading';
import type {AiRunner} from './ai-paper-runner';

interface Sources {
 evidence:(id:string)=>EvidenceSnapshot|null;verifyEvidence:(e:EvidenceSnapshot)=>boolean;
 partition:(id:string)=>DatasetPartition|null;experiment:(id:string)=>any;
 decision:(id:string)=>DecisionRecord|null;signal:(id:string)=>SignalOutcome|null;
 revisions?:(market:MarketId)=>DataRevision[];partitions?:()=>DatasetPartition[];
 strategy?:(id:string)=>StrategyCandidate|null;task?:(id:string)=>ResearchJob|null;
 study?:(id:string)=>ProjectReferenceState|null;
 conditionHit?:(id:string)=>ProjectReferenceState|null;
 account?:(id:string)=>{account:UnifiedPaperRunnerAccount;runner:Pick<AiRunner,'id'|'accountId'|'universe'|'createdAt'>}|null;
}
/** Read-only adapters: no nearest-time matching, upstream fetch, task creation or account mutation. */
export function createProjectReferenceResolver(sources:Sources,now=Date.now){
 return (ref:ProjectReference):ProjectReferenceState|null=>{
  if(ref.kind==='study')return sources.study?.(ref.id)||null;
  if(ref.kind==='condition-hit'){
   if(!/^tshit_[a-f0-9]{64}$/.test(ref.id)||!sources.conditionHit)return null;
   return sources.conditionHit(ref.id);
  }
  if(ref.kind==='account'){
   const source=sources.account?.(ref.id);if(!source)return null;
   const {account:a,runner:r}=source,m=r.universe?.market;
   if(!m||!['stocks','options','crypto','prediction'].includes(m)||r.accountId!==ref.id||a.accountId!==ref.id||a.runnerId!==r.id||!/^[a-f0-9]{64}$/.test(r.universe?.hash||'')||!Number.isFinite(a.cash)||!Array.isArray(a.positions)||!Array.isArray(a.orders))return null;
   const type={stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'}[m];
   const universe=r.universe!;
   if(!['single','watchlist'].includes(universe.kind)||!Array.isArray(universe.instruments)||!universe.instruments.length||universe.instruments.length>5||(universe.kind==='single'&&universe.instruments.length!==1)||!Number.isFinite(Date.parse(universe.frozenAt)))return null;
   const venue={stocks:'Stocks',options:'Options',crypto:'Binance',prediction:'Predict.fun'}[m];
   if(universe.instruments.some(i=>!i||i.venue!==venue||typeof i.symbolOrMarketId!=='string'||!i.symbolOrMarketId||i.symbolOrMarketId!==i.symbolOrMarketId.trim().toUpperCase()))return null;
   // Same version-1 identity serialization as freezeAiRunnerUniverse; never normalize stored runners here.
   const identity={version:1,kind:universe.kind,market:m,sourceWatchlistId:universe.sourceWatchlistId||null,instruments:universe.instruments.map(({venue,symbolOrMarketId})=>({venue,symbolOrMarketId}))};
   if(createHash('sha256').update(JSON.stringify(identity)).digest('hex')!==universe.hash)return null;
   const prefix={stocks:'stock:us:',options:'option:deribit:',crypto:'crypto:binance:',prediction:'prediction:predictfun:'}[m];
   const ids=new Set(universe.instruments.map(i=>prefix+i.symbolOrMarketId));if(ids.size!==universe.instruments.length)return null;
   if([...a.positions,...a.orders].some(row=>row.instrumentType!==type||!ids.has(row.instrumentId)))return null;
   const times=[r.createdAt,a.valuationUpdatedAt,...a.orders.map(row=>row.timestamp)].filter((v):v is string=>v!==undefined).map(v=>Date.parse(v));
   if(!times.length||times.some(v=>!Number.isFinite(v)))return null;
   return {market:m,hash:createHash('sha256').update(JSON.stringify({account:a,runnerId:r.id,universeHash:r.universe!.hash})).digest('hex'),updatedAt:new Date(Math.max(...times)).toISOString(),status:a.valuationStatus||'unknown',expired:['stale','unavailable'].includes(a.valuationStatus||'')};
  }
  if(ref.kind==='evidence'||ref.kind==='event'){
   const evidenceId=ref.kind==='event'?`event-evidence-${ref.id}`:ref.id;
   const e=sources.evidence(evidenceId);if(!e||e.id!==evidenceId||!sources.verifyEvidence(e)||(ref.kind==='event'&&e.workspace!=='event-intelligence'))return null;
   return {market:e.market,instrument:e.instrument,hash:e.hash,updatedAt:e.fetchedAt,expired:['failed','unavailable','empty','unsupported'].includes(e.dataStatus)};
  }
  if(ref.kind==='partition'){
   const p=sources.partition(ref.id);if(!p||p.id!==ref.id||p.status!=='committed')return null;
   const sameScope=(row:{market:string;instrument:string;timeframe:string})=>row.market===p.market&&row.instrument===p.instrument&&row.timeframe===p.timeframe;
   const revisions=(sources.revisions?.(p.market)||[]).filter(sameScope),partitions=(sources.partitions?.()||[p]).filter(sameScope);
   const impact=buildResearchRevisionImpact({market:p.market,instrument:p.instrument,timeframe:p.timeframe,asOf:new Date(now()).toISOString(),revisions,partitions,records:[{id:p.id,kind:'experiment',market:p.market,instrument:p.instrument,timeframe:p.timeframe,createdAt:p.publishedAt,partitionRefs:[{partitionId:p.id,hash:p.contentHash}]}]});
   const latest=impact.rows[0]?.findings.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0];
   return {market:p.market,instrument:p.instrument,hash:p.contentHash,updatedAt:p.fetchedAt,...(latest?{revisionHash:latest.newHash}:{})};
  }
  const saved=ref.kind==='experiment'?sources.experiment(ref.id):null;
  const row=ref.kind==='experiment'?saved?.experiment:ref.kind==='decision'?sources.decision(ref.id):ref.kind==='signal'?sources.signal(ref.id):ref.kind==='strategy'?sources.strategy?.(ref.id):ref.kind==='task'?sources.task?.(ref.id):null;
  if(!row||row.id!==ref.id||!['stocks','options','crypto','prediction'].includes(row.market))return null;
  if(ref.kind==='strategy'&&(typeof row.version!=='string'||!row.version.trim()))return null;
  if(ref.kind==='task'&&(!['queued','running','paused','cancelling','succeeded','failed','cancelled'].includes(row.status)||!Number.isFinite(row.progress)||row.progress<0||row.progress>100))return null;
  const time=row.updatedAt??row.createdAt??row.triggeredAt;
  if(typeof time!=='string'&&typeof time!=='number')return null;
  const updatedAt=new Date(time);if(!Number.isFinite(updatedAt.getTime()))return null;
  const fields=ref.kind==='decision'?['direction','thesis','horizonAt','status','review']:ref.kind==='signal'?['action','entryPrice','triggeredAt','status','exitPrice','exitAt','realizedPnlPct','forwardObservation']:ref.kind==='experiment'?['strategyId','strategyVersion','timeframe','dataSource','from','to','sampleCount']:ref.kind==='strategy'?['version','status']:['status','progress'];
  const summary:Record<string,unknown>={};for(const key of fields){const value=row[key];if(typeof value==='string')summary[key]=value.slice(0,2000);else if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')summary[key]=value;}
  if(ref.kind==='experiment'&&saved.backtest?.metrics){
   const modelResult:Record<string,unknown>={kind:'theoretical-backtest',reason:'已保存历史模型结果；不是实际成交或事前验证，不自动排名或晋级'};
   for(const key of ['tradesCount','totalReturnPct','maxDrawdownPct']){const value=saved.backtest.metrics[key];if(typeof value==='number'&&Number.isFinite(value))modelResult[key]=value;else if(value===null)modelResult[key]=null;}
   for(const key of ['feeRate','slippage'])if(typeof row[key]==='number'&&Number.isFinite(row[key]))modelResult[key]=row[key];
   for(const key of ['totalFees','totalSlippage','startingBalance'])if(typeof saved.backtest[key]==='number'&&Number.isFinite(saved.backtest[key]))modelResult[key]=saved.backtest[key];
   if(Array.isArray(saved.backtest.equityCurve)&&saved.backtest.equityCurve.length<=2000&&saved.backtest.equityCurve.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)))modelResult.equityCurve=[...saved.backtest.equityCurve];
   if(row.parameters&&typeof row.parameters==='object')summary.parameters=row.parameters;
   summary.modelResult=modelResult;
   if(Array.isArray(saved.gate?.reasons))summary.pendingReasons=saved.gate.reasons.filter((s:unknown)=>typeof s==='string').slice(0,6).map((s:string)=>s.slice(0,1000));
  }
  if(ref.kind==='decision'&&row.review)summary.review={at:row.review.at,invalidationBreached:row.review.invalidationBreached};
  if(ref.kind==='signal'&&row.forwardObservation?.horizons){const horizons=row.forwardObservation.horizons;summary.outcomes=[1,3,5,20].map(n=>({bars:n,mature:horizons[n]?.mature===true,returnPct:Number.isFinite(horizons[n]?.returnPct)?horizons[n].returnPct:null}));}
  return {market:row.market as MarketId,instrument:row.instrument,hash:createHash('sha256').update(JSON.stringify(saved||row)).digest('hex'),updatedAt:updatedAt.toISOString(),summary,expired:ref.kind==='signal'&&Number.isFinite(row.expiresAt)&&row.expiresAt<=now(),...(['strategy','task'].includes(ref.kind)?{status:row.status}:{}),...(ref.kind==='task'?{progress:row.progress}:{})};
 };
}
