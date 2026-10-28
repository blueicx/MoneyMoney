import {createHash} from 'node:crypto';

type Market='stocks'|'options'|'crypto'|'prediction';
interface TrialRow {
  id:string;
  experimentId:string|null;
  status:'running'|'succeeded'|'failed';
  parameters:Record<string,number|string|boolean>;
  configurationHash:string;
  strategyVersion:string|null;
  dataHash:string|null;
  completedAt?:number;
}
interface LedgerView {
  market:Market;
  asOf:number;
  trials:TrialRow[];
  attempts:number;
  uniqueConfigurations:number;
  reason:string;
}
interface SavedExperiment {
  experiment:any;
  backtest:any;
  folds?:unknown[];
  evidence?:any;
}

export interface ResearchStatisticsAuditInput {
  market:Market;
  experimentId:string;
  asOf:string;
  saved:SavedExperiment;
  ledger:LedgerView;
}

interface TrialAudit {
  id:string;
  experimentId:string|null;
  status:TrialRow['status'];
  configurationHash:string;
  strategyVersion:string|null;
  dataHash:string|null;
  parameters:Record<string,number|string|boolean>;
}

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const mean=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;
const quantile=(values:number[],fraction:number)=>{
  const sorted=[...values].sort((left,right)=>left-right),position=(sorted.length-1)*fraction;
  const lower=Math.floor(position),upper=Math.ceil(position);
  return lower===upper?sorted[lower]:sorted[lower]+(sorted[upper]-sorted[lower])*(position-lower);
};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function erf(value:number){
  const sign=value<0?-1:1,x=Math.abs(value),t=1/(1+0.3275911*x);
  const polynomial=(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t;
  return sign*(1-polynomial*Math.exp(-x*x));
}
function normalTwoSidedP(t:number){
  return clamp(1-erf(Math.abs(t)/Math.SQRT2),0,1);
}

function seedFrom(value:string){
  const bytes=createHash('sha256').update(value).digest();
  return bytes.readUInt32LE(0)>>>0;
}

/** Audits only saved experiment outputs plus the append-only attempt ledger. */
export function auditResearchStatistics(input:ResearchStatisticsAuditInput){
  if(!input||!['stocks','options','crypto','prediction'].includes(input.market)||typeof input.experimentId!=='string'||!input.experimentId.trim())throw Error('统计审计市场或实验引用无效');
  const asOf=Date.parse(input.asOf);
  if(!Number.isFinite(asOf)||!/(?:Z|[+-]\d\d:\d\d)$/i.test(input.asOf))throw Error('统计审计截止时间无效');
  const experiment=input.saved?.experiment;
  if(!experiment||experiment.id!==input.experimentId||experiment.market!==input.market)throw Error('已保存实验不存在、ID或市场不一致');
  if(!input.ledger||input.ledger.market!==input.market||input.ledger.asOf>asOf+1000)throw Error('研究尝试台账与审计市场或时点不一致');
  const trades:any[]=Array.isArray(input.saved.backtest?.trades)?input.saved.backtest.trades as any[]:[];
  const valid:Array<{index:number;timeIndex:number;holdingTime:number|null;pnl:number;price:number;volume:number}>=trades.map((trade:any,index:number)=>({
    index,
    timeIndex:Number(trade.timeIndex),
    holdingTime:trade.holdingTime===undefined?null:Number(trade.holdingTime),
    pnl:Number(trade.pnl),
    price:Number(trade.executionPrice??trade.price),
    volume:Number(trade.volume),
  })).filter((row:{index:number;timeIndex:number;holdingTime:number|null;pnl:number;price:number;volume:number})=>Number.isFinite(row.pnl)&&Number.isFinite(row.timeIndex)).sort((left:{timeIndex:number;index:number},right:{timeIndex:number;index:number})=>left.timeIndex-right.timeIndex||left.index-right.index);
  if(valid.length!==trades.length)throw Error('已保存实验包含无效时间或损益行');
  const trials=input.ledger.trials.map(row=>({
    id:row.id,
    experimentId:row.experimentId,
    status:row.status,
    configurationHash:row.configurationHash,
    strategyVersion:row.strategyVersion,
    dataHash:row.dataHash,
    parameters:structuredClone(row.parameters),
  })).sort((left,right)=>left.id.localeCompare(right.id));
  const attempts=input.ledger.attempts>0?input.ledger.attempts:null;
  const uniqueConfigurations=input.ledger.uniqueConfigurations>0?input.ledger.uniqueConfigurations:null;
  const currentTrialMatched=trials.some(trial=>trial.status==='succeeded'&&trial.experimentId===experiment.id);
  const sample=trades.length;
  const pnls=valid.map((row:{pnl:number})=>row.pnl);
  const startingBalance=Number(input.saved.backtest?.startingBalance);
  const bootstrap=[] as number[];
  let pValue:number|null=null,adjustedPValue:number|null=null,tStatistic:number|null=null;
  if(sample>=3){
    const average=mean(pnls),variance=pnls.reduce((sum:number,value:number)=>sum+(value-average)**2,0)/(sample-1),standardError=Math.sqrt(variance/sample);
    if(standardError>0){tStatistic=average/standardError;pValue=normalTwoSidedP(tStatistic);}
    const block=Math.max(1,Math.ceil(Math.sqrt(sample))),seed=seedFrom(digest({experimentId:experiment.id,trades:valid,attempts})),randomState=new Uint32Array([seed]);
    const random=()=>{randomState[0]=(Math.imul(randomState[0],1664525)+1013904223)>>>0;return randomState[0]/4294967296;};
    const denominator=Number.isFinite(startingBalance)&&startingBalance>0?startingBalance:1;
    for(let repetition=0;repetition<2000;repetition++){
      let total=0;
      for(let count=0;count<sample;count+=block){
        const start=Math.floor(random()*sample);
        for(let offset=0;offset<block&&count+offset<sample;offset++)total+=pnls[(start+offset)%sample];
      }
      bootstrap.push(total/denominator*100);
    }
    if(pValue!==null&&attempts!==null)adjustedPValue=clamp(pValue*attempts,0,1);
  }
  const overlapProblems=valid.filter((row:{holdingTime:number|null})=>row.holdingTime===null);
  let overlappingPairs=0;
  for(let index=0;index<valid.length-1;index++){
    const current=valid[index],next=valid[index+1];
    if(current.holdingTime!==null&&current.timeIndex+current.holdingTime>next.timeIndex)overlappingPairs++;
  }
  const foldDependence=input.saved.folds&&input.saved.folds.length>1?input.saved.folds.slice(1).some((fold:any,index:number)=>Number(fold.testStart)<=Number((input.saved.folds as any[])[index].testEnd)):false;
  const repeatedConfigurations=uniqueConfigurations!==null&&attempts!==null?attempts-uniqueConfigurations:null;
  const warnings:string[]=[];
  if(attempts===null)warnings.push('历史尝试次数未知；多重检验校正不成立，不能把单次显著性当作确认');
  else if(adjustedPValue===null)warnings.push('样本或标准误不足，未计算多重检验校正后的区间');
  if(sample<20)warnings.push('少于20笔已完成交易，重采样区间不稳定');
  if(overlapProblems.length)warnings.push('部分交易缺少明确持仓时长，样本依赖状态未知');
  if(overlappingPairs)warnings.push(`${overlappingPairs}对相邻交易持有区间重叠；普通独立重采样可能高估有效样本量`);
  if(foldDependence)warnings.push('样本外折测试窗口存在重叠，未把折数当作独立重复实验');
  const base={
    market:input.market,
    experimentId:experiment.id,
    asOf:new Date(asOf).toISOString(),
    dataStatus:sample>=3?'historical':'partial',
    sample:{trades:sample,usable:valid.length,minimumForInference:20},
    ledger:{
      attempts,
      uniqueConfigurations,
      repeatedConfigurations,
      trials,
      failedTrials:trials.filter(trial=>trial.status==='failed').length,
      runningTrials:trials.filter(trial=>trial.status==='running').length,
      currentTrialMatched,
      attemptsKnown:attempts!==null,
      reason:input.ledger.reason,
    },
    inference:{
      naivePValue:pValue,
      multipleTesting:{method:'bonferroni',factor:attempts,adjustedPValue,available:adjustedPValue!==null,reason:adjustedPValue!==null?'按台账实际记录尝试数做保守校正':attempts===null?'历史尝试数未知，不使用伪造分母校正':'样本或方差不足'},
      tStatistic,
      blockBootstrap:{repetitions:sample>=3?2000:0,blockSize:sample>=3?Math.ceil(Math.sqrt(sample)):0,confidence95:bootstrap.length?[quantile(bootstrap,0.025),quantile(bootstrap,0.975)]:null,unit:'累计损益/起始资金 %'},
    },
    dependence:{
      status:overlapProblems.length?'unknown':overlappingPairs?'dependent':'not-detected',
      overlappingPairs,
      missingHoldingTime:overlapProblems.length,
      foldWindowsOverlap:foldDependence,
      reason:overlapProblems.length?'缺少明确持仓时长，不能判断交易样本是否重叠':overlappingPairs?'已保存交易显示持有区间重叠；重采样区间不能视为独立样本':foldDependence?'测试折窗口重叠；不把每折视为独立试验':'未从已保存交易和折窗发现重叠，但不证明其他依赖不存在',
    },
    selectionBias:{
      status:attempts===null?'unknown':repeatedConfigurations&&repeatedConfigurations>0?'observed':'not-detected',
      repeatedConfigurations,
      reason:attempts===null?'旧尝试未记录，无法判断选择偏差':repeatedConfigurations&&repeatedConfigurations>0?'同一配置存在重复尝试；展示全部失败和运行记录，不剔除':'台账未发现重复配置；未记录历史仍可能造成选择偏差',
    },
    warnings,
    executionEnabled:false as const,
    ordersCreated:0 as const,
    modelCalls:0 as const,
    reason:'只审计已保存交易、样本外折和追加式尝试台账；不重新优化、不静默剔除失败参数，也不把显著性修正当作策略有效性证明',
  };
  return {...base,contentHash:digest(base)};
}
