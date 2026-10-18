import { createHash } from 'node:crypto';
import type { RunnerDecisionObservation } from './runner-execution-evidence';

/** Sampled hypothetical markout, never a simulated fill or proof that a rejected trade was executable. */
export function reviewRejectedIntentPath(start:RunnerDecisionObservation,observations:RunnerDecisionObservation[],asOf:string) {
  const base={hypothetical:true,modelCalls:0,orderChanges:0,observedPoints:0,horizons:[] as any[],basisHash:null as string|null,
    reason:'仅比较同来源归档报价的后续采样路径，不证明曾能成交；不评判拒单风控对错，不插值，也不将采样极值当作盘中MFE/MAE。'};
  const d=start.decision,basis=d.evaluationBasis,at=Date.parse(d.at),now=Date.parse(asOf);
  if(!['stocks','crypto'].includes(d.market))return {...base,dataStatus:'unsupported',reason:'当前拒单情景仅支持股票/现货的明确LONG买入意图；不套用期权或预测结算口径'};
  if(d.action!=='REJECTED'||d.requestedIntent?.action!=='BUY'||d.requestedIntent.side!=='LONG'||!Number.isFinite(at)||!Number.isFinite(now)||at>now||!basis||!Number.isFinite(basis.maxAgeMs)||basis.maxAgeMs<=0||basis.maxAgeMs>86400000||![basis.feeRateBps,basis.additionalSlippageBps].every(n=>Number.isFinite(n)&&n>=0&&n<=1000))
    return {...base,dataStatus:'unavailable',reason:'没有明确保存的拒绝买入意图、同轮成本或新鲜度参数，不从理由文本或当前配置反推旧条件'};
  const source=start.snapshot.payload.source;
  const quote=(row:RunnerDecisionObservation)=>{
    const p=row?.snapshot?.payload,r=row?.decision,q=p?.quote;
    if(!r||!q||row.runnerId!==d.runnerId||row.accountId!==start.accountId||r.runnerId!==d.runnerId||r.market!==d.market||r.instrument!==d.instrument||row.snapshot.instrument!==start.snapshot.instrument||row.snapshot.market!==d.market||p.market!==d.market||p.instrument!==d.instrument||p.source!==source||typeof source!=='string'||!source||row.snapshot.hash!==r.snapshotHash||row.snapshot.id!=='rs_'+r.snapshotHash||q.market!==d.market||!['live','delayed'].includes(p.status)||!['live','delayed'].includes(q.dataStatus||q.status))return null;
    const recorded=Date.parse(r.at),dataAt=Date.parse(p.dataAt||''),retrieved=Date.parse(q.fetchedAt||q.updatedAt||'');
    if(![recorded,dataAt,retrieved].every(Number.isFinite)||recorded>now||dataAt>recorded||retrieved>recorded||recorded-dataAt>basis.maxAgeMs||recorded-retrieved>basis.maxAgeMs||typeof q.bestBid!=='number'||typeof q.bestAsk!=='number'||!Number.isFinite(q.bestBid)||!Number.isFinite(q.bestAsk)||q.bestBid<=0||q.bestAsk<q.bestBid)return null;
    return {at:recorded,dataAt,bid:q.bestBid,ask:q.bestAsk,snapshotId:row.snapshot.id};
  };
  const entry=quote(start);
  if(!entry)return {...base,dataStatus:'unavailable',reason:'原始输入缺少同市场新鲜双边报价，不虚构假设入场价'};
  const byTime=new Map<number,NonNullable<ReturnType<typeof quote>>[]>();
  for(const row of observations.slice(0,2000)){
    const q=quote(row);if(!q||q.at<=at||q.dataAt<=entry.dataAt)continue;
    const values=byTime.get(q.dataAt)||[];values.push(q);byTime.set(q.dataAt,values);
  }
  // Same source/time with divergent quotes is a conflict, not a best-price opportunity.
  const points=[...byTime.values()].filter(values=>new Set(values.map(p=>JSON.stringify([p.bid,p.ask]))).size===1).map(values=>values.sort((a,b)=>a.at-b.at)[0]).sort((a,b)=>a.at-b.at);
  const rate=(basis.feeRateBps+basis.additionalSlippageBps)/10000;
  const horizons=[15,60,240,1440].map(minutes=>{
    const target=at+minutes*60000,q=points.find(p=>p.at>=target&&p.at-target<=basis.maxAgeMs);
    const common={minutes,targetAt:new Date(target).toISOString(),entryAsk:entry.ask,exitBid:null as number|null,grossReturnPct:null as number|null,netReturnPct:null as number|null,snapshotId:null as string|null};
    if(target>now)return {...common,dataStatus:'pending',reason:'观察期限尚未成熟'};
    if(!q)return {...common,dataStatus:'unavailable',reason:'目标时间附近没有同来源合格归档报价，或存在冲突；不插值'};
    return {...common,dataStatus:'historical',observedAt:new Date(q.at).toISOString(),exitBid:q.bid,grossReturnPct:(q.bid/entry.ask-1)*100,
      netReturnPct:((q.bid*(1-rate))/(entry.ask*(1+rate))-1)*100,snapshotId:q.snapshotId,reason:'单位名义头寸的假设报价回报，包含双边价差和当时保存的费率/滑点；没有订单或保证成交'};
  });
  const basisHash=createHash('sha256').update(JSON.stringify({decisionId:d.id,snapshotId:start.snapshot.id,basis,asOf,points})).digest('hex');
  return {...base,dataStatus:horizons.some(h=>h.dataStatus==='historical')?'partial':'unavailable',observedPoints:points.length,horizons,basisHash,
    sampledFavorablePct:points.length?Math.max(...points.map(p=>(p.bid/entry.ask-1)*100)):null,
    sampledAdversePct:points.length?Math.min(...points.map(p=>(p.bid/entry.ask-1)*100)):null,
    source,asOf,costAssumption:basis,coverageReason:'只覆盖保留的最近2000轮真实观测，源时间去重；缺口不补齐，采样值不代表连续行情极值'};
}
