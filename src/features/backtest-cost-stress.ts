import crypto from 'node:crypto';
import { BacktestEngine } from './backtest-engine';
import type { ResearchExperimentInput } from './experiment-runner';
export function backtestCostStress(input: ResearchExperimentInput) {
  const warnings=['仅现有现金买入撮合的费用/滑点假设，不包含永续资金费、借贷、强平、Gas 或盘口容量；不是套利执行模型。','使用现有收盘序列，未推断 K 线内部成交路径；不同成本下成交数量可能变化，不自动排名。','压力比较固定初始现金 100000、一个买入仓位约束，默认信号数量为 1；不是原账户资金收益。'];
  const empty=(reason:string,dataStatus='unavailable')=>({dataStatus,reason,inputHash:null as string|null,executionEnabled:false as const,warnings,scenarios:[] as Array<{multiplier:number;feeRate:number;slippage:number;totalFees:number;totalSlippage:number;totalReturnPct:number;maxDrawdownPct:number;trades:number;equityCurve:number[]}>});
  if(!['stocks','crypto'].includes(input.context.market))return empty('该市场需要专属成交与结算模型，未套用现金股票成本压力模型','unsupported');
  if(input.context.market==='crypto' && input.context.parameters?.marketType!=='spot')return empty('未明确声明现货口径；合约与永续需要资金费和结算模型，未套用现金成本模型','unsupported');
  if(!input.context.dataSource || !input.context.strategyVersion)return empty('未声明来源或策略版本，无法生成可追溯成本证据');
  const feeRate=input.context.feeRate,slippage=input.context.slippage;
  if(typeof feeRate!=='number' || typeof slippage!=='number' || !Number.isFinite(feeRate) || !Number.isFinite(slippage) || feeRate<0 || slippage<0 || feeRate>0.03 || slippage>0.03)return empty('缺少有效费用/滑点假设（各不超过 3%），未使用零成本兜底');
  if(!Array.isArray(input.prices) || input.prices.length<2 || input.prices.length>10000 || input.prices.some(price=>!Number.isFinite(price) || price<=0 || price>1e12) || !Array.isArray(input.signals) || input.signals.length>20000)return empty('价格历史不足、无效或超过研究预算');
  if(input.signals.some(signal=>!Number.isInteger(signal.timeIndex) || signal.timeIndex<0 || signal.timeIndex>=input.prices.length || !['buy','sell'].includes(signal.direction)))return empty('信号索引无效或引用未来数据，未执行成本比较');
  if(input.signals.some(signal=>(signal.volume!==undefined && (!Number.isFinite(signal.volume) || signal.volume<=0 || signal.volume>1e9)) || (signal.orderType!==undefined && !['market','limit','stop','take_profit','cancel'].includes(signal.orderType)) || (['limit','take_profit'].includes(signal.orderType || '') && (!Number.isFinite(signal.limitPrice) || Number(signal.limitPrice)<=0 || Number(signal.limitPrice)>1e12)) || (signal.orderType==='stop' && (!Number.isFinite(signal.stopPrice) || Number(signal.stopPrice)<=0 || Number(signal.stopPrice)>1e12))))return empty('订单数量或成交约束无效，未执行成本比较');
  if(input.signals.some(signal=>signal.price!==undefined && signal.price!==input.prices[signal.timeIndex]))return empty('信号自带成交价与输入历史不一致，未生成理想化成本结果');
  if(input.prices.length<100)warnings.push('低于 100 根历史，样本不足；结果只作成本敏感性展示。');
  const scenarios=[1,2,3].map(multiplier=>{
    const result=new BacktestEngine({marketId:input.context.market,rules:{maxOpenPositions:1},feeRate:feeRate*multiplier,slippage:slippage*multiplier,startingBalance:100000,preventFutureData:true}).run(input.prices,input.signals);
    return {multiplier,feeRate:feeRate*multiplier,slippage:slippage*multiplier,totalFees:result.totalFees,totalSlippage:result.totalSlippage,totalReturnPct:result.metrics.totalReturnPct,maxDrawdownPct:result.metrics.maxDrawdownPct,trades:result.trades.length,equityCurve:result.equityCurve};
  });
  return {...empty('历史成本压力比较；不改变候选状态或产生订单'),dataStatus:'historical',inputHash:crypto.createHash('sha256').update(JSON.stringify({prices:input.prices,signals:input.signals,context:input.context,version:'cash-cost-stress-v1'})).digest('hex'),scenarios};
}
