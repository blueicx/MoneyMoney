import type { UnifiedPaperOrder } from './unified-paper-trading';
import type { VerifiedExecutionEvidence } from './runner-execution-evidence';

/** Called only after immutable account/order/signal/snapshot verification. Never fetches a quote. */
export function paperFillQuality(order:UnifiedPaperOrder,evidence:VerifiedExecutionEvidence) {
  if(!order.id||order.id!==evidence.orderId||order.accountId!==evidence.accountId
    ||order.signalId!==evidence.signalId||order.dataSnapshotId!==evidence.snapshotId
    ||order.instrumentId!==evidence.instrument||order.runnerId!==evidence.decision.runnerId)return null;
  const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
  const cost=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
  const interval=(start:unknown,end:unknown)=>{
    const a=Date.parse(String(start||'')),b=Date.parse(String(end||''));return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
  };
  const fields=evidence.snapshot.fields,quote=fields.quote;
  const samePriceBasis=order.instrumentType!=='prediction'; // YES/NO price conversion requires explicit separate evidence.
  const decisionPrice=samePriceBasis&&positive(fields.price)?fields.price:null;
  const bid=samePriceBasis&&positive(quote?.bestBid)?quote.bestBid:null,ask=samePriceBasis&&positive(quote?.bestAsk)?quote.bestAsk:null;
  const multiplier=order.instrumentType==='option'?(positive(order.contractMultiplier)?order.contractMultiplier:null):1;
  const fee=cost(order.feeUsd),slippage=cost(order.slippageUsd);
  return {
    decisionPrice,fillPrice:positive(order.price)?order.price:null,
    decisionToFillMs:interval(evidence.decision.at,order.timestamp),quoteAgeAtFillMs:interval(fields.dataAt,order.timestamp),
    adverseMoveBps:decisionPrice&&positive(order.price)?(order.price-decisionPrice)/decisionPrice*10000*(order.side==='SELL'?-1:1):null,
    quoteSpreadBps:bid!==null&&ask!==null&&ask>=bid?(ask-bid)/((ask+bid)/2)*10000:null,
    fillNotional:multiplier&&positive(order.price)&&positive(order.quantity)?order.price*order.quantity*multiplier:null,
    feeUsd:fee,slippageUsd:slippage,recordedCostsUsd:fee!==null&&slippage!==null?fee+slippage:null,
    recordedSpreadUsd:cost(order.spreadUsd),submissionQuote:null,forwardReturn:null,
    reason:'只读模拟成交质量；成交价已含点差，不重复叠加点差与价格偏移。报价至成交偏移不等于已实现滑点；提交时报价、后续表现或明确价格口径未关联时不推算。',
  };
}
