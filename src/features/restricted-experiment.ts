import {createHash} from 'node:crypto';
import {BacktestEngine,type BacktestSignal} from './backtest-engine';
import {restrictedStrategy} from './strategy-definitions';
import {createExperimentRecord} from './research-contracts';

interface Bar {time:number;open:number;high:number;low:number;close:number;volume?:number;closed?:boolean;publishedAt:number|null}
interface Input {version:{id:string;hash:string;version:number;market:string;interpreterVersion:string;definition:Record<string,any>};market:string;instrument:string;asOf:number;source:string;snapshotId:string;dataHash:string;bars:Bar[]}
/** Private deterministic research only. Reuses the existing backtest cash/cost engine, never the paper executor. */
export function runRestrictedHistoricalExperiment(input:Input){
 const d=restrictedStrategy.validate(input.version.definition),executionModel='restricted-next-open-v1';
 if(input.market!=='stocks'||d.market!==input.market||input.version.market!==input.market||!/^stock:(us|cn):[^:]+$/.test(input.instrument))throw Error('当前成交研究仅支持身份已核验的股票，不跨市场回退');
 if(!/^[a-f0-9]{64}$/.test(input.version.hash)||input.version.interpreterVersion!==restrictedStrategy.version||!input.source?.trim()||!input.snapshotId||!/^[a-f0-9]{64}$/.test(input.dataHash))throw Error('策略、来源或快照身份不可核验');
 if(!Number.isFinite(input.asOf)||input.asOf>Date.now()||d.costs.slippageBps>=10000)throw Error('历史时点或成本模型无效');
 const interval=restrictedStrategy.capabilities.intervals[d.timeframe],evaluated=restrictedStrategy.evaluate(d,input.bars,input.asOf);
 const bars=input.bars.filter(b=>b.time+interval<=input.asOf&&b.closed!==false);
 if(!bars.length)throw Error('没有可用于研究的已完成K线');
 let knownAt=-Infinity;const publication=bars.map(b=>{knownAt=Math.max(knownAt,b.publishedAt==null||!Number.isFinite(b.publishedAt)?Infinity:b.publishedAt);return knownAt;});
 const rejections:Array<{time:number;reason:string}>=[],signals:Array<BacktestSignal&{signalTime:number;knownAt:number}>=[];
 for(const p of evaluated.points){const next=bars[p.index+1],decisionTime=p.time+interval;
  const reason=!next?'没有下一根已完成K线，不强制成交':publication[p.index]>decisionTime?'条件所用数据尚未发布或发布时间未知，不使用事后数据':interval<86400000&&next.time!==decisionTime?'下一根存在日内缺口，不跨缺口假定成交':!Number.isFinite(next.volume)||Math.floor(Number(next.volume))<1?'下一根成交量不足或未知，无法建立成交模型':null;
  if(reason){rejections.push({time:p.time,reason});continue;}
  signals.push({timeIndex:p.index+1,direction:p.direction,price:next.open,timeoutBars:1,volume:Math.min(Number.MAX_SAFE_INTEGER,Math.floor(next.volume!)),strategyId:input.version.id,source:input.source,tag:'restricted:'+p.time,signalTime:p.time,knownAt:publication[p.index]});
 }
 const experiment=createExperimentRecord({market:'stocks',instrument:input.instrument,timeframe:d.timeframe,strategyId:input.version.id,strategyVersion:input.version.hash,dataSource:input.source,dataSnapshotHash:input.dataHash,dataFrom:new Date(bars[0].time).toISOString(),dataTo:new Date(bars.at(-1)!.time).toISOString(),feeRate:d.costs.feeBps/10000,slippage:d.costs.slippageBps/10000,seed:0,parameters:{executionModel,allocationPct:d.position.maxAllocationPct,startingBalance:1000,asOf:new Date(input.asOf).toISOString()}});
 // Strong idempotent identity; the existing legacy experiment ID is a short configuration checksum.
 experiment.id='exp_restricted_'+createHash('sha256').update(JSON.stringify({...experiment,id:undefined,createdAt:undefined,snapshotId:input.snapshotId})).digest('hex');
 const backtest=new BacktestEngine({marketId:'stocks',rules:{maxOpenPositions:1,targetAllocationPct:d.position.maxAllocationPct},feeRate:experiment.feeRate,slippage:experiment.slippage,startingBalance:1000,preventFutureData:true,useCache:false,experimentContext:{marketId:'stocks',instrumentId:input.instrument,timeframe:d.timeframe,strategyId:input.version.id,strategyVersion:input.version.hash,dataSource:input.source,dataSnapshotId:input.snapshotId,costModel:executionModel,seed:0}}).run(bars.map(b=>b.close),signals);
 let units=0,roundPnl=0,closed=0,wins=0;
 for(const trade of backtest.trades){units+=trade.direction==='buy'?trade.volume:-trade.volume;if(trade.direction==='sell'){roundPnl+=trade.pnl;if(units===0){closed++;if(roundPnl>0)wins++;roundPnl=0;}}}
 const metrics={...backtest.metrics,tradesCount:closed,winRatePct:closed>=20?100*wins/closed:null,profitFactor:closed>=20?backtest.metrics.profitFactor:null};
 delete metrics.cagrPct;delete metrics.sharpeRatio;delete metrics.sortinoRatio;
 const reportedBacktest={...backtest,metrics};
 return {experiment,backtest:reportedBacktest,signals,rejections,executionModel,definition:input.version,evidenceRefs:[input.snapshotId],folds:[],evidence:{summary:'私人股票历史成交模型；下一根开盘、整股、单持仓；不代表实际可成交',checks:{futureData:{passed:true,detail:'仅使用收线时已发布数据；日内缺口拒绝'},marketScope:{passed:true,detail:'股票身份及快照由服务端核验'},data:{passed:true,detail:input.source}},outOfSample:null,generatedAt:experiment.createdAt},gate:{passed:false,status:'draft',monitoringAllowed:false,reasons:['尚未进行样本外验证及人工审批']},warnings:['下一根开盘为理论成交模型，缺少逐笔盘口与排队证据，不是实际成交。','未做样本外或公司行动收益归因，不提供晋级依据；不报告年化指标。',...(closed<20?['少于20笔已平仓样本，不提供可靠胜率或排名。']:[])],quality:{closedTrades:closed,reliableWinRate:metrics.winRatePct},reason:'只保存研究结果，不创建模拟订单、修改跑单或开启监控'};
}
