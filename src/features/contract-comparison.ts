import { contractIdentity } from './contract-research';
interface Snapshot {
  market:string;instrument:string;updatedAt:string;source:string;kind?:string;dataStatus?:string;
  sections:Record<string,{dataStatus:string}>;
  quote:{multiplier?:number|null;takerFeeRate?:number|null;markPrice?:number|null;indexPrice?:number|null;basisPct?:number|null;fundingRatePct?:number|null;fundingIntervalSeconds?:number|null;expiresAt?:string|null};
  depth:{bids:Array<{price:number;contracts:number}>;asks:Array<{price:number;contracts:number}>};
}
const round=(value:number)=>Number(value.toFixed(12));
export function contractCapacity(snapshot:Snapshot,input:{side:'BUY'|'SELL';quantity:number},now=Date.now()) {
  contractIdentity(snapshot.instrument);
  if(snapshot.market!=='crypto' || !['BUY','SELL'].includes(input.side) || !Number.isFinite(input.quantity) || input.quantity<=0)throw new Error('合约容量参数无效；数量单位为基础币');
  const base={market:'crypto',instrument:snapshot.instrument,source:snapshot.source,updatedAt:snapshot.updatedAt,executionEnabled:false,quantity:input.quantity};
  const fail=(reason:string)=>({...base,dataStatus:'unavailable',reason,filledQuantity:null,uncoveredQuantity:null,vwap:null,feeEstimate:null,slippagePct:null,levels:[]});
  const age=now-Date.parse(snapshot.updatedAt),multiplier=snapshot.quote.multiplier,fee=snapshot.quote.takerFeeRate;
  if(!Number.isFinite(age) || age<0 || age>60000)return fail('盘口快照超过60秒或时间无效，请刷新，不使用旧盘口推算成交');
  if(!['live','delayed','cached'].includes(snapshot.sections.quote?.dataStatus) || !['live','delayed','cached'].includes(snapshot.sections.depth?.dataStatus))return fail('报价或深度来源不可用');
  if(multiplier==null || multiplier<=0 || !Number.isFinite(multiplier) || fee==null || !Number.isFinite(fee) || fee<0 || fee>0.1)return fail('合约乘数或Taker费率不可核验，未生成容量/成本');
  const valid=(rows:Snapshot['depth']['asks'])=>rows.length>0 && rows.every(row=>Number.isFinite(row.price) && row.price>0 && Number.isFinite(row.contracts) && row.contracts>0);
  if(!valid(snapshot.depth.asks) || !valid(snapshot.depth.bids))return fail('缺少双边有效盘口');
  const asks=[...snapshot.depth.asks].sort((a,b)=>a.price-b.price),bids=[...snapshot.depth.bids].sort((a,b)=>b.price-a.price);
  if(bids[0].price>asks[0].price)return fail('买卖盘口交叉，不能用于可靠容量分析');
  const book=input.side==='BUY' ? asks:bids,levels:Array<{price:number;quantity:number;notional:number}>=[];let remaining=input.quantity,notional=0;
  for(const row of book.slice(0,20)){const quantity=Math.min(remaining,row.contracts*multiplier);if(quantity<=0)break;levels.push({price:row.price,quantity:round(quantity),notional:round(quantity*row.price)});notional+=quantity*row.price;remaining=Math.max(0,remaining-quantity);}
  const filled=input.quantity-remaining,vwap=filled>0 ? notional/filled:null;
  return {...base,dataStatus:remaining>1e-12 ? 'partial':'historical',filledQuantity:round(filled),uncoveredQuantity:round(remaining),vwap:vwap==null ? null:round(vwap),feeEstimate:round(notional*fee),slippagePct:vwap==null ? null:round((vwap/book[0].price-1)*100*(input.side==='BUY' ? 1:-1)),levels,
    reason:remaining>1e-12 ? '当前前20档无法覆盖全部数量，未将剩余量当成成交':'抓取快照容量估计；不含撤单、排队、延迟或盘口补充，不证明真实成交，也不是强平价'};
}
export function compareContractSnapshots(snapshots:Snapshot[]) {
  if(snapshots.length<2 || snapshots.length>6 || new Set(snapshots.map(row=>row.instrument)).size!==snapshots.length)throw new Error('请选择2–6个不同合约');
  const identities=snapshots.map(row=>contractIdentity(row.instrument)),underlyings=identities.map(row=>row.contract.replace(/_USDT(?:_\d{8})?$/,''));
  if(snapshots.some(row=>row.market!=='crypto') || new Set(underlyings).size!==1)throw new Error('仅比较同一底层的Gate USDT线性合约，不能跨市场或混入现货');
  return {market:'crypto',underlying:underlyings[0],source:'Gate public API',executionEnabled:false,dataStatus:snapshots.some(row=>row.dataStatus==='unavailable') ? 'partial':'delayed',
    rows:snapshots.map((row,index)=>({instrument:row.instrument,kind:identities[index].kind,source:row.source,updatedAt:row.updatedAt,dataStatus:row.dataStatus || 'delayed',...row.quote,fundingRatePct:identities[index].kind==='delivery' ? null:row.quote.fundingRatePct ?? null})),
    reason:'逐合约展示基差、到期日及各自资金结算周期；不取平均，不把资金费率相同当成结算成本相同。'};
}
