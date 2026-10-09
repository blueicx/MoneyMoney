import { createHash } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import type { AiRunnerDecisionRecord } from './ai-paper-runner';
import type { MarketId } from './research-contracts';
import type { PaperChartSignalReference, PaperChartSnapshotReference } from './paper-chart-lineage';
import type { UnifiedPaperLedger } from './unified-paper-trading';
import { parseDeribitOptionInstrumentName } from './runner-deribit-options';

type Store=Pick<SQLiteStateStore,'get'|'set'|'transaction'>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isRecord=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Same allowlisted source payload as previous runner hashes; no model secrets or mutable intent. */
function payload(row:Record<string,any>){return {
  market:row.market,instrument:row.instrument,status:row.dataStatus,source:row.source,dataAt:row.dataAt,price:row.price,
  rsi14:row.rsi14,sma10:row.sma10,quote:row.quote,indicatorDataStatus:row.indicatorDataStatus,
  indicatorDataAt:row.indicatorDataAt,indicatorRetrievedAt:row.indicatorRetrievedAt,evidence:row.evidence,
  modelProbability:row.modelProbability,candidateSignals:row.candidateSignals,
};}
export function runnerSnapshotHash(row:Record<string,any>){return digest(payload(row));}
export function runnerExecutionSnapshotId(hash:string){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('快照 Hash 无效');return 'rs_'+hash;}
function identity(market:string,symbol:string){
  const normalized=symbol.toUpperCase();
  if(market==='options'&&parseDeribitOptionInstrumentName(normalized))return 'option:deribit:'+normalized;
  const prefix=({stocks:'stock:us:',options:'option:us:',crypto:'crypto:binance:',prediction:'prediction:predictfun:'} as Record<string,string>)[market];
  return prefix?prefix+normalized:null;
}
interface Snapshot extends PaperChartSnapshotReference {market:MarketId;hash:string;payload:Record<string,any>}
interface Signal extends PaperChartSignalReference {runnerId:string;accountId:string;orderId:string;hash:string;decision:AiRunnerDecisionRecord}
export interface ExecutionEvidenceLookup {market:MarketId;instrument:string;accountId:string;orderId:string;signalId:string;snapshotId:string}
export interface VerifiedExecutionEvidence {
  market:MarketId;instrument:string;orderId:string;accountId:string;signalId:string;snapshotId:string;
  snapshot:{id:string;hash:string;at:string;fields:Record<string,any>};
  decision:Pick<AiRunnerDecisionRecord,'id'|'runnerId'|'at'|'market'|'instrument'|'dataStatus'|'source'|'dataAt'|'strategyVersion'|'modelVersion'|'side'|'signals'|'riskChecks'|'action'|'reason'|'orderId'|'evidence'|'snapshotHash'>;
}

/** Immutable execution evidence in the SAME SQLite transaction as runner fills. Not another account ledger. */
export class RunnerExecutionEvidenceStore {
  constructor(private readonly store:Store){}
  save(row:Record<string,any>,decision:AiRunnerDecisionRecord,instrument:string,accountId:string):string{
    const hash=runnerSnapshotHash(row),id=runnerExecutionSnapshotId(hash);
    if(row.snapshotHash!==hash||decision.snapshotHash!==hash)throw Error('跑单快照 Hash 不一致');
    if(decision.market!==row.market||decision.instrument!==row.instrument||identity(row.market,String(row.instrument))!==instrument)throw Error('跑单证据市场或标的身份不一致');
    if(!decision.orderId||!['BUY','SELL'].includes(decision.action)||decision.market==='prediction'&&!['YES','NO'].includes(String(decision.side))||!decision.id||!decision.runnerId||accountId!=='ai-runner:'+decision.runnerId||!Number.isFinite(Date.parse(decision.at)))throw Error('成交决策与账户身份不完整');
    const snapshot:Snapshot={id,market:decision.market,instrument,at:decision.at,hash,payload:JSON.parse(JSON.stringify(payload(row)))};
    const base={id:decision.id,runnerId:decision.runnerId,accountId,orderId:decision.orderId,market:decision.market,instrument,at:decision.at,snapshotIds:[id],strategyVersion:decision.strategyVersion,decision:JSON.parse(JSON.stringify(decision))};
    const signal:Signal={...base,hash:digest(base)};
    this.store.transaction(()=>{
      const key='ai-runner:execution-signal:'+signal.id,prior=this.store.get<Signal>(key);
      if(prior&&prior.hash!==signal.hash)throw Error('成交决策不可变，引用冲突');
      const old=this.store.get<Snapshot>('ai-runner:execution-snapshot:'+id);
      if(old&&(old.hash!==hash||digest(old.payload)!==hash||old.instrument!==instrument||old.market!==decision.market))throw Error('归档快照 Hash 或身份冲突');
      if(!old)this.store.set('ai-runner:execution-snapshot:'+id,snapshot);
      if(!prior)this.store.set(key,signal);
    });return id;
  }
  snapshot(id:string):Snapshot|null{
    try{
      const row=this.store.get<Snapshot>('ai-runner:execution-snapshot:'+id);
      if(!isRecord(row)||row.id!==id||!isRecord(row.payload)||typeof row.hash!=='string'||digest(row.payload)!==row.hash||id!=='rs_'+row.hash||identity(row.market,String(row.payload.instrument))!==row.instrument||row.payload.market!==row.market||!Number.isFinite(Date.parse(row.at)))return null;
      return row;
    }catch{return null;}
  }
  signal(id:string):Signal|null{
    try{
      const row=this.store.get<Signal>('ai-runner:execution-signal:'+id);if(!isRecord(row)||typeof row.hash!=='string')return null;
      const {hash,...base}=row;
      return row.id===id&&digest(base)===hash?row:null;
    }catch{return null;}
  }
  executionForOrder(ledger:UnifiedPaperLedger,expected:ExecutionEvidenceLookup):VerifiedExecutionEvidence|null{
    try{
      if(!isRecord(ledger)||!isRecord(expected))return null;
      const type=({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'} as Record<string,string>)[expected.market];
      if(!type||typeof expected.instrument!=='string'||!expected.instrument.startsWith(type+':')||![expected.accountId,expected.orderId,expected.signalId,expected.snapshotId].every(value=>typeof value==='string'&&value.length>0))return null;
      const runnerAccounts=isRecord(ledger.runnerAccounts)?Object.values(ledger.runnerAccounts).filter(isRecord):[];
      const accounts=[{accountId:'unified-paper-ledger',runnerId:undefined as string|undefined,orders:Array.isArray(ledger.orders)?ledger.orders:[]},...runnerAccounts.map(account=>({accountId:account.accountId,runnerId:account.runnerId,orders:Array.isArray(account.orders)?account.orders:[]}))];
      const all=accounts.flatMap(account=>account.orders.filter(isRecord).map(order=>({account,order})));
      const withId=all.filter(item=>item.order.id===expected.orderId);
      if(withId.length!==1)return null;
      const {account,order}=withId[0],actualAccount=order.accountId||account.accountId,actualRunner=order.runnerId||account.runnerId;
      if(actualAccount!==expected.accountId||!actualRunner||actualRunner!==account.runnerId||order.instrumentType!==type||order.instrumentId!==expected.instrument||order.signalId!==expected.signalId||order.dataSnapshotId!==expected.snapshotId)return null;
      if(!Number.isFinite(Date.parse(order.timestamp))||!Number.isFinite(order.price)||order.price<=0||!Number.isFinite(order.quantity)||order.quantity<=0)return null;
      const signal=this.signal(expected.signalId),snapshot=this.snapshot(expected.snapshotId);
      if(!signal||!snapshot||signal.id!==expected.signalId||signal.orderId!==order.id||signal.accountId!==actualAccount||signal.runnerId!==actualRunner||signal.market!==expected.market||signal.instrument!==expected.instrument||!Array.isArray(signal.snapshotIds)||!signal.snapshotIds.includes(snapshot.id)||snapshot.market!==expected.market||snapshot.instrument!==expected.instrument)return null;
      const decision=signal.decision,fields=snapshot.payload;
      if(!isRecord(decision)||!isRecord(fields)||!['BUY','SELL'].includes(decision.action)||!Array.isArray(decision.signals)||decision.signals.some(item=>typeof item!=='string')||!Array.isArray(decision.riskChecks)||decision.riskChecks.some(item=>!isRecord(item)||typeof item.name!=='string'||typeof item.passed!=='boolean')||decision.evidence!=null&&(!Array.isArray(decision.evidence)||decision.evidence.some(item=>!isRecord(item)||!['bars','quote','market'].includes(item.dataset)||typeof item.source!=='string'||typeof item.status!=='string'))||Array.isArray(fields.evidence)&&fields.evidence.some((item:unknown)=>!isRecord(item)))return null;
      const predictionActionMatches=expected.market==='prediction'
        ? decision.action==='BUY'?typeof order.side==='string'&&['YES','NO'].includes(order.side)&&decision.side===order.side:order.side==='SELL'&&typeof order.outcome==='string'&&['YES','NO'].includes(order.outcome)&&decision.side===order.outcome
        : decision.action===order.side;
      const orderAt=Date.parse(order.timestamp),decisionAt=Date.parse(decision.at),snapshotAt=Date.parse(snapshot.at);
      if(decision.id!==signal.id||decision.runnerId!==signal.runnerId||decision.orderId!==order.id||decision.market!==expected.market||decision.instrument!==fields.instrument||identity(expected.market,String(fields.instrument))!==expected.instrument||decision.snapshotHash!==snapshot.hash||!predictionActionMatches||!Number.isFinite(decisionAt)||!Number.isFinite(snapshotAt)||decisionAt>orderAt||snapshotAt>orderAt||snapshotAt!==decisionAt)return null;
      if(order.strategyVersion&&order.strategyVersion!==decision.strategyVersion)return null;
      const notFuture=(value:unknown)=>value==null||value===''||(Number.isFinite(Date.parse(String(value)))&&Date.parse(String(value))<=orderAt+5_000);
      if(!notFuture(fields.dataAt)||!notFuture(fields.quote?.fetchedAt)||(Array.isArray(fields.evidence)&&fields.evidence.some((item:any)=>!notFuture(item.dataAt)||!notFuture(item.retrievedAt)))||(Array.isArray(decision.evidence)&&decision.evidence.some((item:any)=>!notFuture(item.dataAt)||!notFuture(item.retrievedAt))))return null;
      const safeEvidence:NonNullable<AiRunnerDecisionRecord['evidence']>=Array.isArray(decision.evidence)?decision.evidence.slice(0,20).map((item:any)=>({dataset:item.dataset,source:item.source.slice(0,160),status:item.status.slice(0,40),dataAt:item.dataAt,retrievedAt:item.retrievedAt,reason:item.reason?String(item.reason).slice(0,240):undefined})):[];
      const safeDecision={id:decision.id,runnerId:decision.runnerId,at:decision.at,market:decision.market,instrument:decision.instrument,dataStatus:decision.dataStatus,source:decision.source,dataAt:decision.dataAt,strategyVersion:decision.strategyVersion,modelVersion:decision.modelVersion,
        signals:decision.signals.slice(0,20).map((item:string)=>item.slice(0,240)),riskChecks:decision.riskChecks.slice(0,20).map((item:any)=>({name:String(item.name||'').slice(0,120),passed:item.passed===true,reason:item.reason?String(item.reason).slice(0,240):undefined})),action:decision.action,side:decision.side,reason:String(decision.reason||'').slice(0,500),orderId:decision.orderId,evidence:safeEvidence,snapshotHash:decision.snapshotHash};
      return {market:expected.market,instrument:expected.instrument,orderId:order.id,accountId:actualAccount,signalId:signal.id,snapshotId:snapshot.id,
        snapshot:{id:snapshot.id,hash:snapshot.hash,at:snapshot.at,fields:JSON.parse(JSON.stringify(fields))},decision:safeDecision};
    }catch{return null;}
  }
}
