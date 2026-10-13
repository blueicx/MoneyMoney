import crypto from 'node:crypto';
import type { ResearchExperimentInput } from './experiment-runner';
import { backtestCostStress } from './backtest-cost-stress';

type Observation = { entryIndex:number;exitIndex:number;grossReturnPct:number;netReturnPct:number;regime:string };
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;

/** Saved-input sensitivity analysis, not an execution path or statistical significance claim. */
export function evaluateResearchRobustness(input:ResearchExperimentInput) {
  const warnings=['历史敏感性研究，不是预测、策略排名或下单指令。',
    '来源与快照引用来自保存的实验声明，本模块未独立核验上游来源；数据 Hash 是该保存价格序列的内容 Hash。',
    '随机对照可能相互重叠；未计算显著性或多重检验校正，不把偶然差异当成有效策略。',
    '时间安慰剂只改变入场时间，不伪称无事件样本；未排除未归档的其他事件。',
    '分组收益使用收盘价格及双边费用/滑点假设，不推断盘中成交或盘口容量；执行成本压力另按现有撮合引擎计算。'];
  const empty=(reason:string,dataStatus='unavailable')=>({dataStatus,reason,warnings,executionEnabled:false as const,ranking:null,
    seed:input.context?.seed??null,dataHash:null as string|null,configurationHash:null as string|null,
    controls:null as null|{randomEntry:Array<{samples:Observation[];meanNetReturnPct:number|null}>;timePlacebo:Array<{samples:Observation[];meanNetReturnPct:number|null}>},
    regimes:[] as Array<{regime:string;sampleCount:number;meanNetReturnPct:number|null;definition:string}>,costScenarios:[] as ReturnType<typeof backtestCostStress>['scenarios'],observations:[] as Observation[]});
  if(!input?.context || !['stocks','crypto'].includes(input.context.market)
    || (input.context.market==='crypto'&&input.context.parameters?.marketType!=='spot'))return empty('当前市场缺少适用的现金现货对照模型','unsupported');
  const context=input.context;
  if(!context.instrument || !context.strategyVersion || !context.dataSource || !context.dataSnapshotHash)return empty('缺少标的、策略版本、来源或已归档数据 Hash，未推断旧记录关联');
  if(!Number.isSafeInteger(context.seed) || Number(context.seed)<0 || Number(context.seed)>2147483647)return empty('缺少有效固定随机种子');
  const stress=backtestCostStress(input);
  if(stress.dataStatus!=='historical')return empty(stress.reason,stress.dataStatus);
  if(input.prices.length>5000 || input.signals.length>2000)return empty('超过稳健性研究单次预算（5000 根、2000 信号）');
  const ordered=[...input.signals].sort((a,b)=>a.timeIndex-b.timeIndex);
  if(ordered.some(row=>row.orderType && row.orderType!=='market'))return empty('非市价订单需要专属条件对照，未忽略原有订单约束','unsupported');
  let pending:number|null=null;const pairs:Array<[number,number]>=[];let unmatched=0;
  for(const row of ordered){
    if(row.direction==='buy'){if(pending!==null)unmatched++;else pending=row.timeIndex;}
    else if(pending!==null && row.timeIndex>pending){pairs.push([pending,row.timeIndex]);pending=null;}
    else unmatched++;
  }
  if(pending!==null)unmatched++;
  if(!pairs.length)return empty('没有明确配对的完整买入/退出信号；未关联旧记录不猜配对','empty');
  if(unmatched)warnings.push(`${unmatched} 条未配对信号未参与对照；只使用明确的现金单持仓信号区间。`);
  if(pairs.length<20)warnings.push('少于 20 个已完成区间，低样本量；不提供可靠胜率、结论排名。');
  const costPct=2*(Number(context.feeRate)+Number(context.slippage))*100;
  const regime=(entry:number)=>entry<20?'unknown':input.prices[entry-1]>input.prices[entry-20]?'rising':input.prices[entry-1]<input.prices[entry-20]?'falling':'flat';
  const observation=(entryIndex:number,exitIndex:number):Observation=>{
    const grossReturnPct=(input.prices[exitIndex]/input.prices[entryIndex]-1)*100;
    return {entryIndex,exitIndex,grossReturnPct,netReturnPct:grossReturnPct-costPct,regime:regime(entryIndex)};
  };
  const observations=pairs.map(([entry,exit])=>observation(entry,exit));
  const actualEntries=new Set(pairs.map(row=>row[0]));
  let state=Number(context.seed)>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const randomEntry:Array<{samples:Observation[];meanNetReturnPct:number|null}>=[],timePlacebo:typeof randomEntry=[];
  for(let repetition=0;repetition<12;repetition++){
    const randomSamples:Observation[]=[],placeboSamples:Observation[]=[];
    for(const [entry,exit] of pairs){
      const duration=exit-entry,maxEntry=input.prices.length-duration-1;
      const eligible=Array.from({length:Math.max(0,maxEntry-19)},(_,index)=>20+index).filter(index=>!actualEntries.has(index));
      if(eligible.length){const chosen=eligible[Math.floor(random()*eligible.length)];randomSamples.push(observation(chosen,chosen+duration));}
      const shifted=eligible.filter(index=>Math.abs(index-entry)>=Math.max(1,duration)&&Math.abs(index-entry)<=60);
      if(shifted.length){const chosen=shifted[Math.floor(random()*shifted.length)];placeboSamples.push(observation(chosen,chosen+duration));}
    }
    randomEntry.push({samples:randomSamples,meanNetReturnPct:mean(randomSamples.map(row=>row.netReturnPct))});
    timePlacebo.push({samples:placeboSamples,meanNetReturnPct:mean(placeboSamples.map(row=>row.netReturnPct))});
  }
  const dataHash=hash(input.prices),configurationHash=hash({version:'saved-input-robustness-v1',dataHash,context,signals:ordered,split:input.split??null,repetitions:12});
  const regimes=['rising','falling','flat','unknown'].map(name=>{
    const rows=observations.filter(row=>row.regime===name);
    return {regime:name,sampleCount:rows.length,meanNetReturnPct:mean(rows.map(row=>row.netReturnPct)),definition:'仅入场前 20 根历史首尾比较；不足时为 unknown，不用未来行情划分市场状态'};
  });
  return {...empty('固定保存输入的历史对照；没有检验统计显著性，不改变策略状态'),dataStatus:'historical',dataHash,configurationHash,
    observations,regimes,controls:{randomEntry,timePlacebo},costScenarios:stress.scenarios};
}
