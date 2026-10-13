import { contractIdentity } from './contract-research';

/** Derive only sampled observations; do not invent missing intervals or source time. */
export async function loadContractPanelHistory(detail:any,selected:string[],read:()=>Promise<any>) {
  let history;
  try { history=await read(); }
  catch(error) { history={instrument:detail.instrument,dataStatus:'unavailable',rows:[],reason:'历史归档不可用：'+(error instanceof Error?error.message:'读取失败')}; }
  return withContractPanelHistory(detail,history,selected);
}

export function withContractPanelHistory(detail:any,history:any,selected:string[]) {
  if(detail.instrument!==history.instrument)throw Error('合约历史标的身份不一致');
  const series={...detail.series};
  for(const [key,field] of [['openInterest','openInterestUsd'],['basis','basisPct']]){
    if(!selected.includes(key))continue;
    const expectedUnit=field==='openInterestUsd'?'USDT':'%';
    const rows=Array.isArray(history.rows)?history.rows:[];
    const unitMismatches=rows.filter((row:any)=>Number.isFinite(row[field])&&row.units?.[field]!==expectedUnit).length;
    const observations=rows.flatMap((row:any)=>Number.isFinite(Date.parse(row.retrievedAt))&&Number.isFinite(row[field])&&row.units?.[field]===expectedUnit?[{time:Date.parse(row.retrievedAt),value:row[field],evidenceRef:row.evidenceRef,contentHash:row.contentHash,source:String(row.source||history.source||'来源未记录')}]:[]).sort((a:any,b:any)=>a.time-b.time);
    const sources=[...new Set(observations.map((point:any)=>point.source))];
    const selectedSource=observations.at(-1)?.source;
    const points=selectedSource?observations.filter((point:any)=>point.source===selectedSource):[];
    const gaps=points.slice(1).map((point:any,index:number)=>point.time-points[index].time);
    const sourceSwitch=sources.length>1;
    const status=history.dataStatus==='unavailable'||(!points.length&&unitMismatches>0)?'unavailable':history.dataStatus==='partial'||sourceSwitch||unitMismatches>0?'partial':points.length>=2?'historical':points.length?'partial':'empty';
    series[key]={...series[key],kind:'observations',unit:expectedUnit,timeBasis:'retrievedAt',source:selectedSource,points,coverage:{from:points[0]?.time??null,to:points.at(-1)?.time??null,records:points.length,maxObservedGapMs:gaps.length?Math.max(...gaps):null,sources,excludedSources:sources.filter(source=>source!==selectedSource)},
      dataStatus:status,
      reason:(history.reason||'同来源归档快照')+'；'+points.length+' 个有效点；来源：'+(selectedSource||'未知')+(unitMismatches?'；忽略 '+unitMismatches+' 条单位缺失或不匹配记录':'')+(sourceSwitch?'；检测到来源切换，仅显示最新同源区间':'')+'；源时间未提供时仅按抓取时间对齐，缺口不插值'+(points.length<2?'；不足两个点，不能判定趋势':'')};
  }
  return {...detail,series};
}

/** Reconcile explicit paper-ledger costs with same-contract observations; rates are not treated as paid funding cash flows. */
export interface ContractFundingSettlement {
  id:string; accountId:string; market:'crypto'; instrument:string; source:string;
  settledAt:string; currency:'USDT'; amount:number; amountConvention:'cash-credit-positive';
  status:'verified'; evidenceRef:string;
}

export function reviewContractPositionCosts(input:{market:string;instrument:string;accountId?:string;fundingSettlements?:ContractFundingSettlement[];orders:any[];positions?:any[];history:any;funding:any[];fundingSource?:string;from?:string;to?:string;now?:number}) {
  if(input.market!=='crypto')throw Error('持仓成本复核只支持虚拟币合约市场');
  contractIdentity(input.instrument);
  if(input.history?.instrument!==input.instrument)throw Error('合约历史标的身份不一致');
  const now=Number.isFinite(input.now)?Number(input.now):Date.now();
  const from=input.from?Date.parse(input.from):-Infinity,to=input.to?Date.parse(input.to):now;
  if(Number.isNaN(from)||!Number.isFinite(to)||to>now||from>to)throw Error('合约持仓成本复核区间无效');
  const orders=(Array.isArray(input.orders)?input.orders:[]).filter(row=>row?.instrumentId===input.instrument&&row?.instrumentType==='crypto')
    .flatMap(row=>{const at=Date.parse(String(row.timestamp||''));return Number.isFinite(at)&&at<=now&&at>=from&&at<=to?[{...row,at}]:[];})
    .sort((a,b)=>a.at-b.at);
  const positions=(Array.isArray(input.positions)?input.positions:[]).filter(row=>row?.instrumentId===input.instrument&&row?.instrumentType==='crypto'&&Number(row.quantity)>0).map(row=>({quantity:Number(row.quantity),currency:row.currency||null,averageEntryPrice:Number.isFinite(Number(row.averageEntryPrice))?Number(row.averageEntryPrice):null,openedAt:row.openedAt||null,markStatus:row.markStatus||'unavailable',markUpdatedAt:row.markUpdatedAt||null}));
  const costValue=(value:unknown)=>value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value));
  const knownFees=orders.flatMap(row=>costValue(row.feeUsd)?[Math.abs(Number(row.feeUsd))]:[]);
  const knownSlippage=orders.flatMap(row=>costValue(row.slippageUsd)?[Math.abs(Number(row.slippageUsd))]:[]);
  const rows:Record<string,any>[]=Array.isArray(input.history?.rows)?input.history.rows:[];
  const metricSummary=(field:string,unit:string)=>{
    const valid=rows.flatMap(row=>{
      const at=Date.parse(String(row.retrievedAt||'')),value=Number(row[field]);
      return Number.isFinite(at)&&at>=from&&at<=to&&costValue(row[field])&&Number.isFinite(value)&&row.units?.[field==='openInterestUsd'?'openInterestUsd':'basisPct']===unit?[{at,value,source:String(row.source||input.history.source||'来源未记录')}]:[];
    }).sort((a,b)=>a.at-b.at);
    const sources=[...new Set(valid.map(row=>row.source))],selectedSource=sources.at(-1);
    const selected=selectedSource?valid.filter(row=>row.source===selectedSource):[];
    const gaps=selected.slice(1).map((row,index)=>row.at-selected[index].at);
    const partial=input.history.dataStatus==='partial'||sources.length>1;
    return {records:selected.length,from:selected.length?new Date(selected[0].at).toISOString():null,to:selected.length?new Date(selected[selected.length-1].at).toISOString():null,source:selectedSource||null,sources,sourceSwitch:sources.length>1,maxObservedGapMs:gaps.length?Math.max(...gaps):null,dataStatus:input.history.dataStatus==='unavailable'?'unavailable':partial?'partial':selected.length>=2?'historical':selected.length?'partial':'empty',reason:selected.length?'真实抓取快照；只计数观测点，不插值'+(partial?'；底层归档为部分成功或来源有切换':''):input.history.reason||'区间内没有可核验记录'};
  };
  const funding:{at:number;ratePct:number}[]=(Array.isArray(input.funding)?input.funding:[]).flatMap((row:any)=>{
    const at=Date.parse(String(row.at||'')),rate=Number(row.ratePct);
    return Number.isFinite(at)&&at>=from&&at<=to&&at<=now&&Number.isFinite(rate)?[{at,ratePct:rate}]:[];
  }).sort((a,b)=>a.at-b.at);
  // An official market funding rate is not evidence of an account cash payment.
  // Consume only explicitly linked settlement records already in the unified ledger.
  const settlements=new Map<string,ContractFundingSettlement>();
  const conflicts=new Set<string>();let rejected=0;
  for(const row of input.fundingSettlements||[]){
    if(!input.accountId||row?.accountId!==input.accountId||row?.instrument!==input.instrument||row?.market!=='crypto')continue;
    const at=Date.parse(row.settledAt);
    if(!Number.isFinite(at)||at>to||at<from||at>now)continue;
    if(typeof row.id!=='string'||!row.id.trim()||typeof row.source!=='string'||!row.source.trim()||typeof row.evidenceRef!=='string'||!row.evidenceRef.trim()||row.status!=='verified'||row.currency!=='USDT'||row.amountConvention!=='cash-credit-positive'||typeof row.amount!=='number'||!Number.isFinite(row.amount)){rejected++;continue;}
    const old=settlements.get(row.id);
    if(old && ['settledAt','amount','source','evidenceRef','currency','amountConvention'].some(key=>old[key as keyof ContractFundingSettlement]!==row[key as keyof ContractFundingSettlement]))conflicts.add(row.id);
    else settlements.set(row.id,row);
  }
  const settlementRows=[...settlements.values()].filter(row=>!conflicts.has(row.id)).sort((a,b)=>Date.parse(a.settledAt)-Date.parse(b.settledAt));
  const rawCashFlow=settlementRows.reduce((sum,row)=>sum+row.amount,0);
  if(!Number.isFinite(rawCashFlow))rejected++;
  const actualKnown=settlementRows.length>0&&conflicts.size===0&&rejected===0;
  const cashFlow=actualKnown?rawCashFlow:null;
  return {
    market:'crypto',instrument:input.instrument,from:Number.isFinite(from)?new Date(from).toISOString():orders[0]?new Date(orders[0].at).toISOString():null,to:new Date(to).toISOString(),
    dataStatus:orders.length?(orders.some(row=>!costValue(row.feeUsd)||!costValue(row.slippageUsd))?'partial':'historical'):'empty',
    ledger:{orderCount:orders.length,orderIds:orders.flatMap(row=>row.id?[String(row.id)]:[]),firstOrderAt:orders[0]?new Date(orders[0].at).toISOString():null,lastOrderAt:orders.at(-1)?new Date(orders.at(-1).at).toISOString():null,feeUsd:knownFees.reduce((sum,value)=>sum+value,0),slippageUsd:knownSlippage.reduce((sum,value)=>sum+value,0),incompleteCostOrders:orders.filter(row=>!costValue(row.feeUsd)||!costValue(row.slippageUsd)).length,openPositions:positions,reason:orders.length?'仅汇总该规范合约的显式模拟账本费用与滑点；缺失字段不按零成本处理':'区间内没有该合约的明确模拟订单'},
    funding:{observationCount:funding.length,from:funding.length?new Date(funding[0].at).toISOString():null,to:funding.length?new Date(funding[funding.length-1].at).toISOString():null,source:input.fundingSource||null,averageRatePct:funding.length?funding.reduce((sum,row)=>sum+row.ratePct,0)/funding.length:null,
      paidCostUsd:null,paidCostUSDT:cashFlow===null?null:-cashFlow,cashFlowUSDT:cashFlow,currency:'USDT',settlementCount:settlementRows.length,settlements:settlementRows,evidenceRefs:[...new Set(settlementRows.map(row=>row.evidenceRef))],conflictCount:conflicts.size,rejectedCount:rejected,
      settlementStatus:actualKnown?'historical':conflicts.size||rejected?'partial':'unavailable',
      coverageComplete:false,
      reason:conflicts.size?'账户资金结算记录冲突；不发布实际成本合计':rejected?'存在未核验或字段不完整的结算记录；不发布实际成本合计':actualKnown?'仅汇总相同账户、合约、币种及区间内的明确结算现金流；收入为正、支出为负。记录覆盖未保证完整，不是完整持有期总成本。':'费率序列不是账户结算账单；未记录逐笔资金结算金额及结算时点持仓名义值/方向，因此不推算已支付资金费。'},
    history:{openInterest:metricSummary('openInterestUsd','USDT'),basis:metricSummary('basisPct','%'),timeBasis:input.history.timeBasis||'retrievedAt',reason:'严格限于相同规范合约和同源快照；不跨来源、不插值。'},
  };
}
