import { createHash } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import type { AiRunnerDecisionRecord } from './ai-paper-runner';
import type { MarketId } from './research-contracts';
import type { PaperChartSignalReference, PaperChartSnapshotReference } from './paper-chart-lineage';

type Store=Pick<SQLiteStateStore,'get'|'set'|'transaction'>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Same allowlisted source payload as previous runner hashes; no model secrets or mutable intent. */
function payload(row:Record<string,any>){return {
  market:row.market,instrument:row.instrument,status:row.dataStatus,source:row.source,dataAt:row.dataAt,price:row.price,
  rsi14:row.rsi14,sma10:row.sma10,quote:row.quote,indicatorDataStatus:row.indicatorDataStatus,
  indicatorDataAt:row.indicatorDataAt,indicatorRetrievedAt:row.indicatorRetrievedAt,evidence:row.evidence,
  modelProbability:row.modelProbability,candidateSignals:row.candidateSignals,
};}
export function runnerSnapshotHash(row:Record<string,any>){return digest(payload(row));}
export function runnerExecutionSnapshotId(hash:string){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('快照 Hash 无效');return 'rs_'+hash;}
function identity(market:string,symbol:string){const prefix=({stocks:'stock:us:',options:'option:us:',crypto:'crypto:binance:',prediction:'prediction:predictfun:'} as Record<string,string>)[market];return prefix?prefix+symbol.toUpperCase():null;}
interface Snapshot extends PaperChartSnapshotReference {market:MarketId;hash:string;payload:Record<string,any>}
interface Signal extends PaperChartSignalReference {runnerId:string;accountId:string;orderId:string;hash:string;decision:AiRunnerDecisionRecord}

/** Immutable execution evidence in the SAME SQLite transaction as runner fills. Not another account ledger. */
export class RunnerExecutionEvidenceStore {
  constructor(private readonly store:Store){}
  save(row:Record<string,any>,decision:AiRunnerDecisionRecord,instrument:string,accountId:string):string{
    const hash=runnerSnapshotHash(row),id=runnerExecutionSnapshotId(hash);
    if(row.snapshotHash!==hash||decision.snapshotHash!==hash)throw Error('跑单快照 Hash 不一致');
    if(decision.market!==row.market||decision.instrument!==row.instrument||identity(row.market,String(row.instrument))!==instrument)throw Error('跑单证据市场或标的身份不一致');
    if(!decision.orderId||!['BUY','SELL'].includes(decision.action)||!decision.id||!decision.runnerId||accountId!=='ai-runner:'+decision.runnerId||!Number.isFinite(Date.parse(decision.at)))throw Error('成交决策与账户身份不完整');
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
    const row=this.store.get<Snapshot>('ai-runner:execution-snapshot:'+id);
    if(!row||row.id!==id||!row.payload||digest(row.payload)!==row.hash||id!=='rs_'+row.hash||identity(row.market,String(row.payload.instrument))!==row.instrument||row.payload.market!==row.market||!Number.isFinite(Date.parse(row.at)))return null;
    return row;
  }
  signal(id:string):Signal|null{
    const row=this.store.get<Signal>('ai-runner:execution-signal:'+id);if(!row)return null;
    const {hash,...base}=row;
    return row.id===id&&digest(base)===hash?row:null;
  }
}
