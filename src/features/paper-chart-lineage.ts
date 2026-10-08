import type { UnifiedPaperLedger, UnifiedPaperOrder } from './unified-paper-trading';

/** Read-only projection. Time places a fill on a candle; it never links separate records. */
export function paperChartLineage(ledger:UnifiedPaperLedger,market:string,instrument:string,accountId?:string) {
  const type=({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'} as Record<string,string>)[market];
  const accounts=[{id:'unified-paper-ledger',orders:ledger.orders},...Object.values(ledger.runnerAccounts||{}).map(account=>({id:account.accountId,orders:account.orders}))];
  const markers:any[]=[],unlinked:{orderId:string|null;accountId:string;reason:string}[]=[];
  if(!type||!instrument.startsWith(type+':'))return {markers,unlinked,reason:'规范标的身份与市场不一致'};
  for(const account of accounts){for(const order of account.orders){
    const actualAccount=order.accountId||account.id;
    if(order.instrumentType!==type||order.instrumentId!==instrument||accountId&&actualAccount!==accountId)continue;
    const missing=[!order.id?'订单':null,!order.signalId?'信号':null,!order.dataSnapshotId?'快照':null].filter(Boolean);
    const time=Date.parse(order.timestamp);
    if(missing.length||!Number.isFinite(time)||!Number.isFinite(order.price)||order.price<=0||!Number.isFinite(order.quantity)||order.quantity<=0){unlinked.push({orderId:order.id||null,accountId:actualAccount,reason:missing.length?'未关联：缺少'+missing.join('/')+' ID':'成交价格、数量或时间无效'});continue;}
    markers.push({orderId:order.id,accountId:actualAccount,runnerId:order.runnerId||null,signalId:order.signalId,snapshotId:order.dataSnapshotId,experimentId:order.experimentId||null,market,instrument,time,price:order.price,quantity:order.quantity,side:order.side,feeUsd:cost(order,'feeUsd'),slippageUsd:cost(order,'slippageUsd'),spreadUsd:cost(order,'spreadUsd'),pnlUsd:Number.isFinite(order.pnlUsd)?order.pnlUsd:null});
  }}
  markers.sort((a,b)=>a.time-b.time||a.orderId.localeCompare(b.orderId));
  return {markers,unlinked,reason:markers.length?null:unlinked.length?'仅有未关联记录；不按时间猜测策略成交':'当前标的暂无已关联模拟成交'};
}
function cost(order:UnifiedPaperOrder,key:'feeUsd'|'slippageUsd'|'spreadUsd'){return Number.isFinite(order[key])?order[key]:null;}
