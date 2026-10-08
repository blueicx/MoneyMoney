import type { UnifiedPaperLedger, UnifiedPaperOrder } from './unified-paper-trading';

/** Read-only projection. Time places a fill on a candle; it never links separate records. */
export interface PaperChartSnapshotReference {id:string;market:string;instrument:string;at:string}
export interface PaperChartSignalReference extends PaperChartSnapshotReference {snapshotIds:string[];accountId?:string;runnerId?:string;orderId?:string;strategyVersion?:string}
export interface PaperChartReferences {signal:(id:string)=>PaperChartSignalReference|null;snapshot:(id:string)=>PaperChartSnapshotReference|null}
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
      else if(!Number.isFinite(Date.parse(signal.at))||!Number.isFinite(Date.parse(snapshot.at))||Date.parse(signal.at)>time||Date.parse(snapshot.at)>time)reason='证据时间无效或晚于成交';
    }
    if(reason){unlinked.push({orderId:order.id||null,accountId:actualAccount,reason:'未关联：'+reason});continue;}
    markers.push({orderId:order.id,accountId:actualAccount,runnerId:order.runnerId||null,signalId:order.signalId,snapshotId:order.dataSnapshotId,experimentId:order.experimentId||null,market,instrument,time,price:order.price,quantity:order.quantity,side:order.side,feeUsd:cost(order,'feeUsd'),slippageUsd:cost(order,'slippageUsd'),spreadUsd:cost(order,'spreadUsd'),pnlUsd:Number.isFinite(order.pnlUsd)?order.pnlUsd:null});
  }}
  markers.sort((a,b)=>a.time-b.time||a.orderId.localeCompare(b.orderId));
  return {markers,unlinked,reason:markers.length?null:unlinked.length?'仅有未关联记录；不按时间猜测策略成交':'当前标的暂无已关联模拟成交'};
}
function cost(order:UnifiedPaperOrder,key:'feeUsd'|'slippageUsd'|'spreadUsd'){return Number.isFinite(order[key])?order[key]:null;}
