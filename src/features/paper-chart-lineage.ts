import type { UnifiedPaperLedger, UnifiedPaperOrder } from './unified-paper-trading';
import { verifyEvidenceSnapshotHash, type EvidenceSnapshot, type SignalOutcome } from './decision-intelligence';
import type { PointInTimeSnapshot } from '../storage/data-lake';

/** Read-only projection. Time places a fill on a candle; it never links separate records. */
export interface PaperChartSnapshotReference {id:string;market:string;instrument:string;at:string;retrievedAt?:string}
export interface PaperChartSignalReference extends PaperChartSnapshotReference {snapshotIds:string[];accountId?:string;runnerId?:string;orderId?:string;strategyVersion?:string;action?:string;outcome?:string;decision?:{id?:string;runnerId?:string;orderId?:string;market?:string;instrument?:string;action?:string;side?:string}}
export interface PaperChartReferences {signal:(id:string)=>PaperChartSignalReference|null;snapshot:(id:string)=>PaperChartSnapshotReference|null}
export interface PaperChartReferenceSources {
  runnerSignal:(id:string)=>PaperChartSignalReference|null;
  runnerSnapshot:(id:string)=>PaperChartSnapshotReference|null;
  researchSignal:(id:string)=>SignalOutcome|null;
  evidenceSnapshot:(id:string)=>EvidenceSnapshot|null;
  pointInTimeSnapshot:(id:string)=>PointInTimeSnapshot|null;
  resolveInstrument?:(market:string,instrument:string)=>string|null;
}

const unusableEvidenceStatuses=new Set(['empty','failed','unavailable','unsupported']);

export function createPaperChartReferences(sources:PaperChartReferenceSources):PaperChartReferences{
  const snapshot=(id:string):PaperChartSnapshotReference|null=>{
    const runner=sources.runnerSnapshot(id);
    if(runner){
      const payloadStatus=(runner as PaperChartSnapshotReference & {payload?:{status?:unknown}}).payload?.status;
      return typeof payloadStatus==='string'&&unusableEvidenceStatuses.has(payloadStatus)?null:runner;
    }
    const evidence=sources.evidenceSnapshot(id);
    if(evidence)return evidence.id===id&&evidence.instrument&&verifyEvidenceSnapshotHash(evidence)&&!unusableEvidenceStatuses.has(evidence.dataStatus)
      ?{id:evidence.id,market:evidence.market,instrument:evidence.instrument,at:evidence.observedAt,retrievedAt:evidence.fetchedAt}:null;
    const row=sources.pointInTimeSnapshot(id);
    if(!row||row.id!==id||row.dataset!=='bars'||!row.instrument||!/^([a-f0-9]{64})$/i.test(row.contentHash)||!row.partitionId)return null;
    const instrument=sources.resolveInstrument?.(row.market,row.instrument)||null;
    if(!instrument)return null;
    return {id:row.id,market:row.market,instrument,at:row.asOf,retrievedAt:row.createdAt};
  };
  return {
    signal(id){
      const runner=sources.runnerSignal(id);if(runner)return runner;
      const row=sources.researchSignal(id);
      if(!row||row.id!==id||!row.market||!row.instrument||!Number.isFinite(row.triggeredAt))return null;
      let at:string;try{at=new Date(row.triggeredAt).toISOString();}catch{return null;}
      const snapshotIds=Array.isArray(row.evidenceRefs)?[...new Set(row.evidenceRefs.filter((value):value is string=>typeof value==='string'&&!!value))].filter(snapshotId=>{
        const reference=snapshot(snapshotId);
        return !!reference&&reference.market===row.market&&reference.instrument===row.instrument;
      }):[];
      if(!snapshotIds.length)return null;
      return {id:row.id,market:row.market,instrument:row.instrument,at,snapshotIds,...(row.strategyVersion?{strategyVersion:row.strategyVersion}:{}),...(row.action?{action:row.action}:{}),...(row.outcome?{outcome:row.outcome}:{})};
    },
    snapshot,
  };
}
export function resolvePaperChartInstrument(
  ledger:UnifiedPaperLedger,
  market:string,
  query:string,
  resolveRegistered?:(market:string,query:string)=>{id:string}|null,
):string|null {
  const type=({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'} as Record<string,string>)[market];
  if(!type||!query)return null;
  try {
    const registered=resolveRegistered?.(market,query);
    if(registered&&registered.id.startsWith(type+':'))return registered.id;
  } catch { return null; }
  // A canonical InstrumentRef carries its own market and venue. Accept this
  // explicit identity when a paper fill already proves the same identity, or
  // for normalized stock/crypto identities that may not have a lake partition.
  const match=query.match(/^(stock|option|crypto|prediction):([a-z0-9._-]+):([A-Za-z0-9._:/-]+)$/);
  if(!match||match[1]!==type)return null;
  const [,idType,venue,symbol]=match;
  const canonical=`${idType}:${venue.toLowerCase()}:${idType==='prediction'?symbol:symbol.toUpperCase()}`;
  if(query!==canonical)return null;
  if(idType==='stock'&&(venue.toLowerCase()!=='us'||!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)))return null;
  if(idType==='crypto'&&!/^[A-Z0-9]{2,20}(?:[_-]?[A-Z0-9]{2,20})?$/.test(symbol))return null;
  const ledgerHasIdentity=[...ledger.orders,...Object.values(ledger.runnerAccounts||{}).flatMap(account=>account.orders)]
    .some(order=>order.instrumentType===type&&order.instrumentId===canonical);
  if(idType==='option'||idType==='prediction')return ledgerHasIdentity?canonical:null;
  return canonical;
}
export function paperChartLineage(ledger:UnifiedPaperLedger,market:string,instrument:string,accountId?:string,references?:PaperChartReferences) {
  const type=({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'} as Record<string,string>)[market];
  const accounts=[{id:'unified-paper-ledger',runnerId:undefined as string|undefined,orders:ledger.orders},...Object.values(ledger.runnerAccounts||{}).map(account=>({id:account.accountId,runnerId:account.runnerId,orders:account.orders}))];
  const markers:any[]=[],unlinked:{orderId:string|null;accountId:string;reason:string}[]=[];
  if(!type||!instrument.startsWith(type+':'))return {markers,unlinked,reason:'规范标的身份与市场不一致'};
  for(const account of accounts){for(const order of account.orders){
    const actualAccount=order.accountId||account.id;
    if(order.instrumentType!==type||order.instrumentId!==instrument||accountId&&actualAccount!==accountId)continue;
    const missing=[!order.id?'订单':null,!order.signalId?'信号':null,!order.dataSnapshotId?'快照':null].filter(Boolean);
    const time=Date.parse(order.timestamp);
    if(missing.length||!Number.isFinite(time)||!Number.isFinite(order.price)||order.price<=0||!Number.isFinite(order.quantity)||order.quantity<=0){unlinked.push({orderId:order.id||null,accountId:actualAccount,reason:missing.length?'未关联：缺少'+missing.join('/')+' ID':'成交价格、数量或时间无效'});continue;}
    let reason:string|null=null;
    if(actualAccount!==account.id||order.runnerId!==account.runnerId)reason='成交账户或跑单归属与持久账本不一致';
    else if(!references)reason='引用目标尚未核验';
    else {
      const signal=references.signal(order.signalId!),snapshot=references.snapshot(order.dataSnapshotId!);
      if(!signal||!snapshot)reason='信号/决策或源快照不存在，或内容 Hash 校验失败';
      else if(signal.id!==order.signalId||snapshot.id!==order.dataSnapshotId||signal.market!==market||snapshot.market!==market||signal.instrument!==instrument||snapshot.instrument!==instrument)reason='信号或快照市场、标的不一致';
      else if(!Array.isArray(signal.snapshotIds)||!signal.snapshotIds.includes(snapshot.id))reason='信号未明确关联该快照';
      else if(signal.accountId&&signal.accountId!==actualAccount||signal.runnerId&&signal.runnerId!==account.runnerId||signal.orderId&&signal.orderId!==order.id)reason='信号关联的账户、跑单或订单不一致';
      else if(order.strategyVersion&&signal.strategyVersion!==order.strategyVersion)reason='策略版本不一致';
      else if(signal.decision
        ? signal.decision.id!==signal.id||signal.decision.runnerId!==account.runnerId||signal.decision.orderId!==order.id||signal.decision.market!==market||String(signal.decision.instrument||'').toUpperCase()!==instrument.split(':').at(-1)?.toUpperCase()
        : Boolean(account.runnerId||signal.runnerId))reason='成交缺少可核验的决策方向或关联身份';
      else if(!paperActionMatches(signal,order,market))reason='成交方向或预测市场 YES/NO 结果与信号不一致';
      else if(!Number.isFinite(Date.parse(signal.at))||!Number.isFinite(Date.parse(snapshot.at))||signal.retrievedAt!=null&&!Number.isFinite(Date.parse(signal.retrievedAt))||snapshot.retrievedAt!=null&&!Number.isFinite(Date.parse(snapshot.retrievedAt))||Date.parse(signal.at)>time||Date.parse(snapshot.at)>time||signal.retrievedAt!=null&&Date.parse(signal.retrievedAt)>time||snapshot.retrievedAt!=null&&Date.parse(snapshot.retrievedAt)>time)reason='证据时间无效或晚于成交';
    }
    if(reason){unlinked.push({orderId:order.id||null,accountId:actualAccount,reason:'未关联：'+reason});continue;}
    markers.push({orderId:order.id,accountId:actualAccount,runnerId:order.runnerId||null,signalId:order.signalId,snapshotId:order.dataSnapshotId,experimentId:order.experimentId||null,market,instrument,time,price:order.price,quantity:order.quantity,side:order.side,...(order.instrumentType==='prediction'?{outcome:order.side==='SELL'?order.outcome:order.side}:{}),feeUsd:cost(order,'feeUsd'),slippageUsd:cost(order,'slippageUsd'),spreadUsd:cost(order,'spreadUsd'),pnlUsd:Number.isFinite(order.pnlUsd)?order.pnlUsd:null});
  }}
  markers.sort((a,b)=>a.time-b.time||a.orderId.localeCompare(b.orderId));
  return {markers,unlinked,reason:markers.length?null:unlinked.length?'仅有未关联记录；不按时间猜测策略成交':'当前标的暂无已关联模拟成交'};
}
function cost(order:UnifiedPaperOrder,key:'feeUsd'|'slippageUsd'|'spreadUsd'){return Number.isFinite(order[key])?order[key]:null;}

function paperActionMatches(signal:PaperChartSignalReference,order:UnifiedPaperOrder,market:string):boolean{
  const action=String(signal.decision?.action||signal.action||'');
  if(!['BUY','SELL'].includes(action)||!['BUY','SELL','YES','NO'].includes(String(order.side)))return false;
  const outcome=String(signal.decision?.side||signal.outcome||'');
  if(market==='prediction')return action==='BUY'
    ? ['YES','NO'].includes(String(order.side))&&outcome===order.side
    : order.side==='SELL'&&['YES','NO'].includes(String(order.outcome))&&outcome===order.outcome;
  return action===order.side;
}
