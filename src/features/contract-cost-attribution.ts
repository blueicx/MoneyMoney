import { contractIdentity } from './contract-research';
import type { UnifiedPaperOrder } from './unified-paper-trading';

/** Recorded ledger components only. No inferred entry/exit pairing or FX conversion. */
export function reviewContractCostAttribution(input:{accountId:string;instrument:string;orders:UnifiedPaperOrder[];asOf:string}) {
  contractIdentity(input.instrument);const cutoff=Date.parse(input.asOf);
  if(!input.accountId||!Number.isFinite(cutoff))throw Error('账户和归因时点必须明确');
  const matching=input.orders.filter(row=>row.instrumentType==='crypto'&&row.instrumentId===input.instrument&&Number.isFinite(Date.parse(row.timestamp))&&Date.parse(row.timestamp)<=cutoff);
  const unlinkedAccountOrders=matching.filter(row=>!row.accountId).length;
  const scoped=matching.filter(row=>row.accountId===input.accountId);
  const ids=new Map<string,UnifiedPaperOrder[]>();let missingIds=0;
  for(const row of scoped){if(!row.id){missingIds++;continue;}const values=ids.get(row.id)||[];values.push(row);ids.set(row.id,values);}
  const conflicts=[...ids.values()].filter(rows=>rows.length!==1).length;
  const rows=[...ids.values()].filter(values=>values.length===1).map(values=>values[0]),closed=rows.filter(row=>row.side==='SELL');
  const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
  const sum=(values:unknown[])=>{if(!values.length||!values.every(finite)||conflicts||missingIds)return null;const total=(values as number[]).reduce((a,b)=>a+b,0);return Number.isFinite(total)?total:null;};
  const price=sum(closed.map(row=>row.pnlUsd)),fees=sum(rows.map(row=>finite(row.feeUsd)&&row.feeUsd!>=0?row.feeUsd:null)),slippage=sum(rows.map(row=>finite(row.slippageUsd)&&row.slippageUsd!>=0?row.slippageUsd:null));
  const unlinkedPriceOrders=closed.filter(row=>!finite(row.pnlUsd)).length;
  return {market:'crypto',instrument:input.instrument,accountId:input.accountId,asOf:input.asOf,dataStatus:unlinkedAccountOrders?'partial':!scoped.length?'empty':conflicts||missingIds||unlinkedPriceOrders||fees===null||slippage===null?'partial':'historical',
    recordedPricePnlUsd:price,recordedFeesUsd:fees,recordedSlippageUsd:slippage,priceOrderIds:closed.filter(row=>finite(row.pnlUsd)).map(row=>row.id!),orderCount:rows.length,unlinkedPriceOrders,unlinkedAccountOrders,missingIds,conflicts,totalNetPnl:null,
    reason:'只读取统一账本显式pnlUsd、feeUsd及slippageUsd，不按时间猜测配对，不重算旧成交。期间费用可能包含未平仓入场成本；未平仓估值不混入已记价格损益。USD记账组件与USDT资金结算分开；缺少可核验汇率和完整持有期血缘时不输出总净收益。',modelCalls:0,orderChanges:0};
}
