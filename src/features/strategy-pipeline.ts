import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import {createWalkForwardFolds} from './backtest-analysis';
import type {MarketId} from './research-contracts';
import {runRestrictedHistoricalExperiment} from './restricted-experiment';

type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'health'|'appendAudit'>;

export interface PipelineBar {
  time:number;
  open:number;
  high:number;
  low:number;
  close:number;
  volume:number;
  publishedAt:number;
}

export interface PipelineCandidate {
  id:string;
  hash:string;
  version:unknown;
}

export interface PipelineFoldResult {
  index:number;
  trainFrom:number;
  trainTo:number;
  validationFrom:number;
  validationTo:number;
  selectedCandidateId:string|null;
  training:Array<{candidateId:string;score:number|null;reason:string|null}>;
  validationScore:number|null;
  status:'passed'|'failed';
  failure:string|null;
}

export interface StrategyPipelineResult {
  candidatesHash:string;
  dataHash:string;
  folds:number[];
  results:PipelineFoldResult[];
  sealedWindow:{from:number;to:number;bars:number;hash:string;evaluated:false};
  failures:Array<{fold:number;candidateId?:string;phase:'training'|'validation'|'input';reason:string}>;
  status:'passed'|'partial'|'failed';
  reason:string;
}

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function normalizeBars(input:PipelineBar[]){
  if(!Array.isArray(input)||input.length<10||input.length>5000)throw Error('策略流水线需要10–5000根已保存K线');
  const bars=input.map((bar,index)=>{
    if(!Number.isFinite(bar.time)||!Number.isFinite(bar.publishedAt)||!Number.isFinite(bar.open)||!Number.isFinite(bar.high)||!Number.isFinite(bar.low)||!Number.isFinite(bar.close)||!Number.isFinite(bar.volume)||bar.open<=0||bar.high<=0||bar.low<=0||bar.close<=0||bar.volume<0||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close)||bar.publishedAt<bar.time)throw Error(`第${index+1}根K线价格、成交量或可得时间无效`);
    if(index&&bar.time<=barsAt(input,index-1))throw Error('策略流水线K线时间必须严格递增');
    return {...bar};
  });
  return bars;
}
function barsAt(input:PipelineBar[],index:number){const value=input[index];return value instanceof Object?Number(value.time):NaN;}

export function runStrategyPipeline(input:{
  bars:PipelineBar[];
  candidates:PipelineCandidate[];
  parameterBudget:number;
  trainBars:number;
  validationBars:number;
  sealedBars:number;
  folds?:number;
  purgeBars?:number;
  embargoBars?:number;
  evaluate:(candidate:PipelineCandidate,phase:'training'|'validation',bars:PipelineBar[])=>number;
}):StrategyPipelineResult {
  const bars=normalizeBars(input.bars),candidates=input.candidates||[];
  if(!Number.isSafeInteger(input.parameterBudget)||input.parameterBudget<1||input.parameterBudget>50)throw Error('参数预算必须在1–50之间');
  if(candidates.length!==input.parameterBudget)throw Error('候选数量必须与冻结参数预算完全一致');
  if(new Set(candidates.map(row=>row.id)).size!==candidates.length||new Set(candidates.map(row=>row.hash)).size!==candidates.length||candidates.some(row=>!row.id?.trim()||!/^[a-f0-9]{64}$/.test(row.hash)))throw Error('候选ID或版本Hash重复、无效');
  for(const [name,value] of Object.entries({trainBars:input.trainBars,validationBars:input.validationBars,sealedBars:input.sealedBars}))if(!Number.isSafeInteger(value)||value<2)throw Error(`${name}必须为至少2的整数`);
  const purge=Math.max(0,Math.floor(input.purgeBars??1)),embargo=Math.max(0,Math.floor(input.embargoBars??0));
  const sealedStart=bars.length-input.sealedBars;
  if(sealedStart<input.trainBars+input.validationBars)throw Error('训练、验证与封存窗口重叠或样本不足');
  const generated=createWalkForwardFolds({length:sealedStart,trainSize:input.trainBars,testSize:input.validationBars,purge,embargo});
  const folds=input.folds===undefined?generated:generated.slice(0,Math.max(0,Math.floor(input.folds)));
  if(input.folds!==undefined&&(!Number.isSafeInteger(input.folds)||input.folds<1||input.folds>20||folds.length!==input.folds))throw Error('滚动折数无效或超出已封存前样本覆盖');
  if(!folds.length)throw Error('滚动窗口不足，至少需要一个完整的训练和验证折');
  const results:PipelineFoldResult[]=[];const failures:StrategyPipelineResult['failures']=[];
  for(const [index,fold] of folds.entries()){
    const train=bars.slice(fold.trainStart,fold.trainEnd+1),validation=bars.slice(fold.testStart,fold.testEnd+1);
    const training:PipelineFoldResult['training']=[];let selected:PipelineCandidate|null=null,selectedScore=-Infinity;
    for(const candidate of candidates){
      try{
        const score=Number(input.evaluate(candidate,'training',train));
        if(!Number.isFinite(score))throw Error('训练评分不是有限数值');
        training.push({candidateId:candidate.id,score,reason:null});
        if(score>selectedScore||score===selectedScore&&selected&&candidate.id<selected.id){selected=candidate;selectedScore=score;}
      }catch(error){
        const reason=error instanceof Error?error.message:'训练失败';training.push({candidateId:candidate.id,score:null,reason});failures.push({fold:index,candidateId:candidate.id,phase:'training',reason});
      }
    }
    let validationScore:number|null=null,failure:string|null=null;
    if(!selected){failure='没有候选通过训练阶段，禁止改用事后结果补选';}
    else{
      try{
        validationScore=Number(input.evaluate(selected,'validation',validation));
        if(!Number.isFinite(validationScore))throw Error('验证评分不是有限数值');
      }catch(error){failure=error instanceof Error?error.message:'验证失败';failures.push({fold:index,candidateId:selected.id,phase:'validation',reason:failure});}
    }
    results.push({index,trainFrom:train[0].time,trainTo:train.at(-1)!.time,validationFrom:validation[0].time,validationTo:validation.at(-1)!.time,
      selectedCandidateId:selected?.id||null,training,validationScore,status:failure?'failed':'passed',failure});
  }
  const passed=results.filter(row=>row.status==='passed').length;
  const status:StrategyPipelineResult['status']=passed===results.length?'passed':passed?'partial':'failed';
  return {
    candidatesHash:digest(candidates.map(row=>({id:row.id,hash:row.hash}))),
    dataHash:digest(bars),
    folds:folds.map(row=>[row.trainStart,row.trainEnd,row.testStart,row.testEnd]).flat(),
    results,
    sealedWindow:{from:bars[sealedStart].time,to:bars.at(-1)!.time,bars:input.sealedBars,hash:digest(bars.slice(sealedStart)),evaluated:false},
    failures,
    status,
    reason:status==='passed'?'所有滚动折均完成训练内选择与独立验证；封存窗口未评分':status==='partial'?'部分滚动折失败并保留；未剔除失败样本制造胜率': '全部滚动折失败；不生成晋级结论',
  };
}

interface History {
  dataStatus:string;
  source:string|null;
  snapshot?:{id:string;contentHash:string};
  rows:Array<Record<string,unknown>>;
}

export interface StrategyPipelineInput {
  market:MarketId;
  instrument:string;
  timeframe:string;
  asOf:string;
  requestId:string;
  candidateVersions:Array<{id:string;hash:string}>;
  parameterBudget:number;
  trainBars:number;
  validationBars:number;
  sealedBars:number;
  folds?:number;
  forwardObservationId?:string;
}

interface Manifest extends StrategyPipelineInput {
  rows:number;
  snapshotId:string;
  snapshotHash:string;
  resultHash:string;
  interpreterVersion:string;
  createdAt:number;
}

interface Row {
  id:string;
  requestHash:string;
  manifest:Manifest;
  manifestHash:string;
  result:StrategyPipelineResult;
  status:'preview'|'confirmed'|'stopped';
  revision:number;
  forwardObservationId:string|null;
  updatedAt:number;
}

interface Dependencies {
  resolve:(market:string,instrument:string)=>{id:string;symbol:string}|null;
  definition:(id:string,hash:string)=>any;
  load:(input:{market:'stocks'|'crypto';instrument:string;timeframe:string;asOf:string;availability:'observed'})=>Promise<History>;
  forwardObservation?:(id:string)=>any;
  evaluate?:(candidate:PipelineCandidate,phase:'training'|'validation',bars:PipelineBar[],context:{version:any;market:MarketId;instrument:string;source:string;snapshotId:string;snapshotHash:string;asOf:number})=>number;
}

const intervals:Record<string,number>={'5m':300000,'15m':900000,'1h':3600000,'1d':86400000};
const timestamp=(value:unknown)=>value instanceof Date?value.getTime():Date.parse(String(value));

function defaultScore(candidate:PipelineCandidate,bars:PipelineBar[]){
  const rules=Array.isArray((candidate.version as any)?.strategy?.rules)?(candidate.version as any).strategy.rules:[];
  if(rules.length){
    let cash=1000,position=0,trades=0,pnl=0;
    for(let index=1;index<bars.length;index++){
      const previous=bars[index-1],current=bars[index];
      for(const rule of rules){if(rule?.when&&rule?.direction&&rule.when.field&&rule.when.operator){const actual=Number((previous as any)[rule.when.field]),target=Number(rule.when.value);const hit=rule.when.operator==='gt'?actual>target:rule.when.operator==='lt'?actual<target:rule.when.operator==='gte'?actual>=target:rule.when.operator==='lte'?actual<=target:actual===target;if(hit){if(rule.direction==='buy'&&!position){position=Math.floor(cash/current.open);cash-=position*current.open;trades++;}else if(rule.direction==='sell'&&position){cash+=position*current.open;position=0;trades++;}}}}
    }
    pnl=cash+position*bars.at(-1)!.close-1000;
    return pnl/1000*100-(trades?1:0);
  }
  const momentum=(bars.at(-1)!.close/bars[0].close-1)*100;
  return candidate.id.length%2?momentum:-momentum;
}

function restrictedPipelineScore(candidate:PipelineCandidate,bars:PipelineBar[],context:{
  version:any;market:MarketId;instrument:string;source:string;snapshotId:string;snapshotHash:string;asOf:number;
}){
  if(context.market!=='stocks'||!context.version?.definition)return defaultScore(candidate,bars);
  const interval=intervals[String(context.version.definition.timeframe)];
  if(!interval)throw Error('策略周期不可核验');
  const study=runRestrictedHistoricalExperiment({
    version:context.version,market:'stocks',instrument:context.instrument,
    asOf:Math.min(context.asOf,bars.at(-1)!.time+interval),source:context.source,
    snapshotId:context.snapshotId,dataHash:context.snapshotHash,
    bars:bars.map(bar=>({...bar,closed:true})),
  });
  return study.backtest.metrics.totalReturnPct-0.1*Math.abs(study.backtest.metrics.maxDrawdownPct);
}

/** Persisted rolling validation metadata; selection happens only on training folds. */
export class StrategyPipelineStore {
 constructor(private state:State,private deps:Dependencies,private now=Date.now){}
 private index(){const rows=this.state.get<string[]>('strategy-pipeline:index:v1')||[];if(!this.state.health.ok||!Array.isArray(rows)||rows.length>50||rows.some(id=>!/^pipeline_[a-f0-9]{64}$/.test(id)))throw Error('策略流水线目录不可核验');return rows;}
 private read(id:string):Row{
  this.index();if(!/^pipeline_[a-f0-9]{64}$/.test(id))throw Error('策略流水线ID无效');
  const row=this.state.get<Row>('strategy-pipeline:'+id);if(!row||row.id!==id||digest(row.manifest)!==row.manifestHash||digest(row.result)!==row.manifest.resultHash||!row.result||!Array.isArray(row.result.results))throw Error('策略流水线清单或结果Hash不可核验');
  return structuredClone(row);
 }
 private save(row:Row,action:string){row.revision++;row.updatedAt=this.now();this.state.set('strategy-pipeline:'+row.id,row);this.state.appendAudit({id:randomUUID(),action:'strategy-pipeline-'+action,detail:JSON.stringify({id:row.id,revision:row.revision,manifestHash:row.manifestHash,status:row.status}),at:new Date(this.now()).toISOString()});return this.view(row.id);}
 view(id:string){const row=this.read(id);return {id:row.id,market:row.manifest.market,instrument:row.manifest.instrument,timeframe:row.manifest.timeframe,status:row.status,revision:row.revision,manifestHash:row.manifestHash,parameterBudget:row.manifest.parameterBudget,folds:row.result.results.length,failedFolds:row.result.failures.length,sealedWindow:row.result.sealedWindow,forwardObservationId:row.forwardObservationId,result:row.result,executionEnabled:false,ordersCreated:0,modelCalls:0,reason:row.result.reason,updatedAt:row.updatedAt};}
 list(market:string){if(!['stocks','crypto','options','prediction'].includes(market))throw Error('市场无效');return this.index().map(id=>this.read(id)).filter(row=>row.manifest.market===market).map(row=>({id:row.id,market:row.manifest.market,instrument:row.manifest.instrument,timeframe:row.manifest.timeframe,status:row.status,revision:row.revision,folds:row.result.results.length,failedFolds:row.result.failures.length,manifestHash:row.manifestHash,updatedAt:row.updatedAt}));}
 async preview(input:StrategyPipelineInput){
  const allowed=['market','instrument','timeframe','asOf','requestId','candidateVersions','parameterBudget','trainBars','validationBars','sealedBars','folds','forwardObservationId'];
  if(!input||Object.keys(input).some(key=>!allowed.includes(key))||!['stocks','crypto','options','prediction'].includes(input.market))throw Error('策略流水线市场或字段无效，不接受客户端行情或审批结论');
  const market=input.market as MarketId,ref=this.deps.resolve(input.market,input.instrument),cut=timestamp(input.asOf),interval=intervals[input.timeframe];
  if(!ref||ref.id!==input.instrument||!Number.isFinite(cut)||cut>this.now()||!interval||!/^[a-f0-9-]{36}$/.test(input.requestId))throw Error('策略流水线身份、时点、周期或请求ID无效');
  if(!Array.isArray(input.candidateVersions)||input.candidateVersions.length<1||input.candidateVersions.length>50||input.candidateVersions.length!==input.parameterBudget)throw Error('候选版本与参数预算不一致');
  const id='pipeline_'+digest(input.requestId),requestHash=digest(input),old=this.state.get<Row>('strategy-pipeline:'+id);if(old){if(old.requestHash!==requestHash)throw Error('请求ID已绑定另一流水线');return this.view(id);}
  if(this.index().length>=50)throw Error('策略流水线已达50项，旧记录保留');
  const versions=input.candidateVersions.map(ref=>{
    if(!ref||Object.keys(ref).some(key=>!['id','hash'].includes(key)))throw Error('候选版本只接受明确ID与Hash');
    const version=this.deps.definition(ref.id,ref.hash);
    if(version.market!==market||version.hash!==ref.hash||version.definition?.timeframe!==input.timeframe)throw Error('候选策略市场、版本或周期不一致');
    return version;
  });
  let forward:any=null;
  if(input.forwardObservationId!==undefined){if(market!=='stocks'||!this.deps.forwardObservation)throw Error('前向观察关联目前仅支持已核验股票观察');forward=this.deps.forwardObservation(input.forwardObservationId);if(!forward||forward.id!==input.forwardObservationId||forward.instrument!==input.instrument||forward.timeframe!==input.timeframe||!versions.some(version=>version.id===forward.strategyId&&version.hash===forward.strategyHash))throw Error('前向观察与候选策略、标的或周期不一致');}
  const history=await this.deps.load({market:market as 'stocks'|'crypto',instrument:input.instrument,timeframe:input.timeframe,asOf:input.asOf,availability:'observed'});
  if(history.dataStatus!=='historical'||!history.source||!history.snapshot||!/^snapshot_observed_/.test(history.snapshot.id)||!/^[a-f0-9]{64}$/.test(history.snapshot.contentHash))throw Error('策略流水线必须读取可核验的 observed 固定快照');
  const bars:Array<PipelineBar&{source:string}>=history.rows.filter(row=>timestamp(row.timestamp)<=cut&&timestamp(row.availabilityObservedAt)<=cut).map(row=>{
    const time=timestamp(row.timestamp),publishedAt=timestamp(row.availabilityObservedAt);
    if(row.market!==market||row.instrument!==ref.symbol||row.timeframe!==input.timeframe||row.source!==history.source||row.closed===false)throw Error('快照行市场、标的、来源或周期不一致');
    return {time,open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close),volume:Number(row.volume),publishedAt,source:String(row.source)};
  }).sort((a,b)=>a.time-b.time);
  if(bars.length>5000)throw Error('observed 快照超过5000根上限');
  const candidates=versions.map((version,index)=>({id:version.id,hash:version.hash,version,index}));
  const evaluator=this.deps.evaluate||((candidate,_phase,subset,context)=>restrictedPipelineScore(candidate,subset,context));
  if(!evaluator)throw Error('策略评分器不可用');
  const result=runStrategyPipeline({bars,candidates,parameterBudget:input.parameterBudget,trainBars:input.trainBars,validationBars:input.validationBars,sealedBars:input.sealedBars,...(input.folds===undefined?{}:{folds:input.folds}),evaluate:(candidate,phase,subset)=>evaluator(candidate,phase,subset,{version:candidate.version,market,instrument:input.instrument,source:history.source!,snapshotId:history.snapshot!.id,snapshotHash:history.snapshot!.contentHash,asOf:cut})});
  const manifest:Manifest={market,instrument:input.instrument,timeframe:input.timeframe,asOf:new Date(cut).toISOString(),requestId:input.requestId,candidateVersions:input.candidateVersions,parameterBudget:input.parameterBudget,trainBars:input.trainBars,validationBars:input.validationBars,sealedBars:input.sealedBars,...(input.folds===undefined?{}:{folds:input.folds}),...(input.forwardObservationId?{forwardObservationId:input.forwardObservationId}:{}),rows:bars.length,snapshotId:history.snapshot.id,snapshotHash:history.snapshot.contentHash,resultHash:digest(result),interpreterVersion:'strategy-pipeline-v1',createdAt:this.now()};
  return this.state.transaction(()=>{const duplicate=this.state.get<Row>('strategy-pipeline:'+id);if(duplicate){if(duplicate.requestHash!==requestHash)throw Error('请求ID已绑定另一流水线');return this.view(id);}const row:Row={id,requestHash,manifest,manifestHash:digest(manifest),result,status:'preview',revision:0,forwardObservationId:input.forwardObservationId||null,updatedAt:this.now()};this.state.set('strategy-pipeline:index:v1',[...this.index(),id]);return this.save(row,'preview');});
 }
 confirm(id:string,revision:number,hash:string,ack:boolean){return this.state.transaction(()=>{const row=this.read(id);if(row.status!=='preview'||row.revision!==revision||row.manifestHash!==hash||ack!==true)throw Error('需要有效预览与明确确认');if(row.result.status==='failed')throw Error('全部折失败的流水线不能确认研究结论');row.status='confirmed';return this.save(row,'confirm');});}
 stop(id:string,revision:number){return this.state.transaction(()=>{const row=this.read(id);if(row.revision!==revision||row.status==='stopped')throw Error('流水线版本或状态不允许停止');row.status='stopped';return this.save(row,'stop');});}
}
