import type { AiRunner, AiRunnerDecisionRecord } from './ai-paper-runner';

/** Derived report only: it cannot change runners, launch models or place orders. */
export function compareAiRunnerReports(runners: AiRunner[], histories: Record<string,AiRunnerDecisionRecord[]>) {
  if(runners.length<2 || runners.length>6 || new Set(runners.map(row=>row.id)).size!==runners.length)throw new Error('请选择2–6个不同跑单');
  const market=runners[0].universe?.market;
  if(!market || runners.some(row=>row.universe?.market!==market))throw new Error('跑单必须有已核验的冻结市场，不能跨市场比较');
  const warnings:string[]=[],checks:Array<{name:string;matched:boolean;reason:string}>=[];
  const check=(name:string,values:unknown[],reason:string)=>checks.push({name,matched:values.every(value=>value!=null && JSON.stringify(value)===JSON.stringify(values[0])),reason});
  check('冻结标的',runners.map(row=>row.universe?.hash),'只比较已保存的冻结Hash，不猜测旧标的集');
  check('预算',runners.map(row=>row.budgetUsd),'预算必须一致');
  check('起点',runners.map(row=>row.createdAt),'启动时间不同会产生采样偏差');
  check('成本模型',runners.map(row=>row.policy.feeRateBps==null || row.policy.additionalSlippageBps==null ? null : [row.policy.feeRateBps,row.policy.additionalSlippageBps]),'费用和额外滑点假设必须一致');
  check('随机种子/模型采样',runners.map(row=>row.comparisonControl ? [row.comparisonControl.groupId,row.comparisonControl.configHash,row.comparisonControl.seed,row.comparisonControl.temperature]:null),'旧账户未记录受控配置时不能宣称公平实验；供应商seed仍不保证模型确定性');
  const evidenceKeys=runners.map(runner=>new Set((histories[runner.id] || []).filter(row=>row.runnerId===runner.id && row.market===market && row.snapshotHash && ['live','delayed','cached'].includes(row.dataStatus)).map(row=>`${row.instrument}|${row.snapshotHash}`)));
  const paired=[...evidenceKeys[0]].filter(key=>evidenceKeys.every(keys=>keys.has(key)));
  if(!paired.length)warnings.push('没有共同真实快照，只展示独立账户，不推断策略优劣。');
  checks.filter(row=>!row.matched).forEach(row=>warnings.push(row.name+'：'+row.reason));
  const rows=runners.map(runner=>{
    const points=(runner.equityHistory || []).filter(point=>Number.isFinite(point.equityUsd) && Number.isFinite(Date.parse(point.at))).sort((a,b)=>a.at.localeCompare(b.at));
    const costsKnown=runner.trades.every(trade=>trade.feeUsd!=null && trade.slippageUsd!=null && Number.isFinite(trade.feeUsd) && Number.isFinite(trade.slippageUsd));
    const closed=runner.positions.filter(position=>position.status==='CLOSED'),realizedKnown=closed.every(position=>position.pnlUsd!=null && Number.isFinite(position.pnlUsd));
    if(!costsKnown)warnings.push(runner.id+'：旧成交费用字段缺失，未按零成本补齐');
    if(closed.length<20)warnings.push(runner.id+`：平仓样本不足（${closed.length}/20），未提供可靠胜率或排名`);
    if(runner.mode==='ai-review')warnings.push(runner.id+'：AI研究只读，不应将零成交与交易策略收益排名');
    return {id:runner.id,title:runner.title,market,mode:runner.mode || 'legacy',accountId:runner.accountId || null,strategyVersion:runner.strategyVersion || null,modelVersion:runner.model || null,
      executionEligible:runner.mode!=='ai-review' && runner.executionState!=='legacy-readonly',budget:runner.budgetUsd,equity:points.at(-1)?.equityUsd ?? null,
      equityReason:points.length ? null:'尚无真实估值轮次',points:points.map(point=>({date:point.at,value:point.equityUsd,dataStatus:point.dataStatus})),
      drawdown:points.length ? Math.max(...points.map(point=>Number(point.drawdownPct) || 0)):null,
      recordedCosts:costsKnown ? runner.trades.reduce((sum,trade)=>sum+Math.abs(trade.feeUsd!)+Math.abs(trade.slippageUsd!),0):null,
      realizedPnl:realizedKnown ? closed.reduce((sum,position)=>sum+position.pnlUsd!,0):null,closedCount:closed.length,
      unrealizedPnl:typeof points.at(-1)?.unrealizedPnlUsd==='number' ? points.at(-1)!.unrealizedPnlUsd:null,
      valuationStatus:runner.lastDataStatus || points.at(-1)?.dataStatus || 'unavailable',valuationAt:runner.lastDataAt || null,valuationSource:runner.lastDataSource || null,
      firstObservation:points[0]?.at || null,lastObservation:points.at(-1)?.at || null,
      decisions:(histories[runner.id] || []).filter(row=>row.runnerId===runner.id).length,
      commonDecisions:(histories[runner.id] || []).filter(row=>row.market===market && paired.includes(`${row.instrument}|${row.snapshotHash}`)).map(row=>({id:row.id,instrument:row.instrument,at:row.at,snapshotHash:row.snapshotHash,action:row.action,reason:row.reason,orderId:row.orderId || null})),
    };
  });
  return {market,rows,checks,pairedSnapshotCount:paired.length,fairComparison:checks.every(row=>row.matched) && paired.length>0,warnings:[...new Set(warnings)],dataStatus:rows.every(row=>row.points.length) ? 'historical':'partial',executionEnabled:false,reason:'历史只读对照；没有统一实验约束时不排名，不生成订单，也不调用AI'};
}
