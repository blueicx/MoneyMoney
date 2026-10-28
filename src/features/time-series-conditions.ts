import { createHash, randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import { assertMarketContext, type MarketId } from './research-contracts';
import { verifyEvidenceSnapshotHash, type EvidenceSnapshot } from './decision-intelligence';

type State = Pick<SQLiteStateStore,'get'|'set'|'health'|'transaction'|'appendAudit'> & Partial<Pick<SQLiteStateStore,'getIdempotent'|'setIdempotent'>>;
type RuleStatus = 'preview'|'confirmed';
type PredicateOperator = 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'exists';
type Scalar = string|number|boolean;

export interface TimeSeriesPredicate {
  field:string;
  operator:PredicateOperator;
  value?:Scalar|Scalar[];
}

export interface TimeSeriesStep {
  id:string;
  label:string;
  afterPreviousMs?:number;
  withinPreviousMs?:number;
  predicate:TimeSeriesPredicate;
}

export interface TimeSeriesExclusion {
  id:string;
  label:string;
  afterStepId:string;
  withinMs:number;
  predicate:TimeSeriesPredicate;
}

export interface TimeSeriesConditionInput {
  market:MarketId;
  instrument:string;
  name:string;
  asOf:string;
  requestId:string;
  evidenceIds:string[];
  maxSpanMs:number;
  steps:TimeSeriesStep[];
  exclusions:TimeSeriesExclusion[];
}

export interface SequenceHit {
  id:string;
  startAt:string;
  endAt:string;
  evidenceIds:string[];
  steps:Array<{stepId:string;label:string;evidenceId:string;at:string}>;
  linkedProjectId?:string;
  linkedProjectVersion?:number;
  linkedAt?:string;
  linkKey?:string;
  linkRequestHash?:string;
}

export interface SequenceMiss {
  id:string;
  startEvidenceId:string;
  startAt:string;
  status:'window'|'excluded'|'incomplete';
  reason:string;
  matchedStepIds:string[];
  evidenceIds:string[];
}

export interface TimeSeriesEvaluation {
  status:'calculated'|'empty';
  inputVersion:string;
  hits:SequenceHit[];
  misses:SequenceMiss[];
  evidenceIds:string[];
  coverage:{evidence:number;candidateStarts:number;hits:number;misses:number};
  contentHash:string;
  modelCalls:0;
  ordersCreated:0;
  reason:string;
}

interface StoredRule {
  id:string;
  manifest:TimeSeriesConditionInput;
  manifestHash:string;
  requestHash:string;
  result:TimeSeriesEvaluation;
  contentHash:string;
  status:RuleStatus;
  version:number;
  createdAt:number;
  updatedAt:number;
  confirmationKey?:string;
  confirmationHash?:string;
  confirmedAt?:string;
}

export interface TimeSeriesRuleView extends Omit<StoredRule,'manifest'|'createdAt'|'updatedAt'> {
  createdAt:string;
  updatedAt:string;
  manifest:TimeSeriesConditionInput;
}

interface StoredRun extends TimeSeriesEvaluation {
  id:string;
  ruleId:string;
  ruleVersion:number;
  ruleContentHash:string;
  runKey:string;
  createdAt:number;
  linkedHits?:SequenceHit[];
}

interface ProjectLinker {
  link(projectId:string,version:number,reference:{kind:'condition-hit';id:string}):unknown;
}

const marketIds:MarketId[]=['stocks','options','crypto','prediction'];
const operators:PredicateOperator[]=['eq','neq','gt','gte','lt','lte','in','exists'];
const idPattern=/^[a-z][a-z0-9_-]{0,63}$/;
const requestPattern=/^[A-Za-z0-9._:-]{8,128}$/;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finiteTime=(value:unknown,label:string)=>{
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||!/(?:Z|[+-]\d\d:\d\d)$/i.test(value))throw Error(`${label}必须包含有效时区`);
  return new Date(Date.parse(value)).toISOString();
};
const text=(value:unknown,label:string,max:number)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}不能为空或超过${max}字`);
  return value.trim();
};
const duration=(value:unknown,label:string,max:number,allowZero=true)=>{
  const number=Number(value);
  if(!Number.isFinite(number)||number<0||(!allowZero&&number===0)||number>max)throw Error(`${label}无效`);
  return Math.round(number);
};
const scalar=(value:unknown,label:string):Scalar=>{
  if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw Error(`${label}必须是字符串、数字或布尔值`);
  if(typeof value==='number'&&!Number.isFinite(value))throw Error(`${label}必须是有限数字`);
  if(typeof value==='string'&&value.length>240)throw Error(`${label}不能超过240字`);
  return value;
};

function normalizePredicate(value:unknown,label:string):TimeSeriesPredicate{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${label}无效`);
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).some(key=>!['field','operator','value'].includes(key)))throw Error(`${label}包含未允许字段`);
  const field=text(raw.field,`${label}字段`,120);
  if(!/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(field)||field.split('.').some(part=>!part||part==='__proto__'||part==='prototype'||part==='constructor'))throw Error(`${label}字段路径无效`);
  const operator=String(raw.operator||'') as PredicateOperator;
  if(!operators.includes(operator))throw Error(`${label}操作符无效`);
  if(operator==='exists')return {field,operator};
  if(operator==='in'){
    if(!Array.isArray(raw.value)||raw.value.length<1||raw.value.length>20)throw Error(`${label}的 in 需要1–20个值`);
    return {field,operator,value:[...new Set(raw.value.map((item,index)=>scalar(item,`${label}第${index+1}个值`)))]};
  }
  return {field,operator,value:scalar(raw.value,`${label}值`)};
}

function normalizeInput(value:TimeSeriesConditionInput):TimeSeriesConditionInput{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('条件规则清单无效');
  const allowed=['market','instrument','name','asOf','requestId','evidenceIds','maxSpanMs','steps','exclusions'];
  if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('条件规则包含未允许字段');
  if(!marketIds.includes(value.market))throw Error('条件规则市场无效');
  const instrument=text(value.instrument,'条件规则标的',200);
  assertMarketContext({market:value.market,workspace:'screener',instrument});
  const name=text(value.name,'条件规则名称',160);
  const asOf=finiteTime(value.asOf,'条件规则截止时间');
  const requestId=String(value.requestId||'');
  if(!requestPattern.test(requestId))throw Error('条件规则请求ID无效');
  if(!Array.isArray(value.evidenceIds)||value.evidenceIds.length<2||value.evidenceIds.length>200)throw Error('条件规则需要2–200条证据引用');
  const evidenceIds=value.evidenceIds.map((row,index)=>text(row,`第${index+1}条证据引用`,240));
  if(new Set(evidenceIds).size!==evidenceIds.length)throw Error('条件规则证据引用不得重复');
  const maxSpanMs=duration(value.maxSpanMs,'规则最长观察窗',366*24*60*60_000,false);
  if(!Array.isArray(value.steps)||value.steps.length<2||value.steps.length>6)throw Error('有序条件需要2–6个步骤');
  const steps=value.steps.map((step,index)=>{
    if(!step||typeof step!=='object'||Array.isArray(step))throw Error(`第${index+1}个条件步骤无效`);
    if(Object.keys(step).some(key=>!['id','label','afterPreviousMs','withinPreviousMs','predicate'].includes(key)))throw Error(`第${index+1}个条件步骤包含未允许字段`);
    const id=text(step.id,`第${index+1}个条件步骤ID`,64);
    if(!idPattern.test(id))throw Error(`第${index+1}个条件步骤ID无效`);
    const afterPreviousMs=index===0?undefined:duration(step.afterPreviousMs??0,`${id}最短间隔`,maxSpanMs);
    const withinPreviousMs=index===0?undefined:duration(step.withinPreviousMs,`${id}时间窗口`,maxSpanMs,false);
    if(index>0&&afterPreviousMs!>withinPreviousMs!)throw Error(`${id}最短间隔不能大于时间窗口`);
    return {
      id,
      label:text(step.label,`${id}标签`,100),
      ...(afterPreviousMs!==undefined?{afterPreviousMs}:{}),
      ...(withinPreviousMs!==undefined?{withinPreviousMs}:{}),
      predicate:normalizePredicate(step.predicate,`${id}条件`),
    };
  });
  if(new Set(steps.map(step=>step.id)).size!==steps.length)throw Error('条件步骤ID不得重复');
  if(!Array.isArray(value.exclusions)||value.exclusions.length>8)throw Error('排除条件最多8条');
  const exclusions=value.exclusions.map((exclusion,index)=>{
    if(!exclusion||typeof exclusion!=='object'||Array.isArray(exclusion))throw Error(`第${index+1}条排除条件无效`);
    const raw=exclusion as unknown as Record<string,unknown>;
    if(Object.keys(raw).some(key=>!['id','label','afterStepId','withinMs','predicate'].includes(key)))throw Error(`第${index+1}条排除条件包含未允许字段`);
    const id=text(raw.id,`第${index+1}条排除条件ID`,64);
    if(!idPattern.test(id))throw Error(`第${index+1}条排除条件ID无效`);
    const afterStepId=text(raw.afterStepId,`${id}起始步骤`,64);
    if(!steps.some(step=>step.id===afterStepId))throw Error(`${id}引用的起始步骤不存在`);
    return {
      id,
      label:text(raw.label,`${id}标签`,100),
      afterStepId,
      withinMs:duration(raw.withinMs,`${id}时间窗口`,maxSpanMs,false),
      predicate:normalizePredicate(raw.predicate,`${id}条件`),
    };
  });
  if(new Set(exclusions.map(row=>row.id)).size!==exclusions.length)throw Error('排除条件ID不得重复');
  return {market:value.market,instrument,name,asOf,requestId,evidenceIds,maxSpanMs,steps,exclusions};
}

function readField(value:unknown,path:string):unknown{
  let current=value;
  for(const part of path.split('.')){
    if(!current||typeof current!=='object'||Array.isArray(current))return undefined;
    current=(current as Record<string,unknown>)[part];
  }
  return current;
}

function compare(left:unknown,right:unknown):number|undefined{
  if(typeof left==='number'&&typeof right==='number'&&Number.isFinite(left)&&Number.isFinite(right))return left-right;
  if(typeof left==='string'&&typeof right==='string')return left.localeCompare(right);
  if(typeof left==='boolean'&&typeof right==='boolean')return Number(left)-Number(right);
  return undefined;
}

function matches(predicate:TimeSeriesPredicate,item:EvidenceSnapshot):boolean{
  const actual=readField(item.fields,predicate.field);
  if(predicate.operator==='exists')return actual!==undefined&&actual!==null;
  if(predicate.operator==='in')return Array.isArray(predicate.value)&&predicate.value.some(value=>actual===value);
  if(predicate.operator==='eq')return actual===predicate.value;
  if(predicate.operator==='neq')return actual!==predicate.value;
  const direction=compare(actual,predicate.value);
  if(direction===undefined)return false;
  if(predicate.operator==='gt')return direction>0;
  if(predicate.operator==='gte')return direction>=0;
  if(predicate.operator==='lt')return direction<0;
  return direction<=0;
}

function prepareEvidence(input:TimeSeriesConditionInput,rows:EvidenceSnapshot[],now:number){
  const byId=new Map(rows.map(row=>[row.id,row]));
  if(byId.size!==rows.length)throw Error('条件证据存在重复身份');
  const ordered=[...rows].sort((left,right)=>Date.parse(left.observedAt)-Date.parse(right.observedAt)||left.id.localeCompare(right.id));
  const cutoff=Date.parse(input.asOf);
  if(cutoff>now)throw Error('条件规则截止时间来自未来');
  for(const id of input.evidenceIds){
    const item=byId.get(id);
    if(!item||item.id!==id||!verifyEvidenceSnapshotHash(item))throw Error(`证据 ${id} 不存在或Hash不可核验`);
    if(item.market!==input.market||item.instrument!==input.instrument)throw Error(`证据 ${id} 的市场或标的不一致`);
    if(!['live','delayed','cached','historical','partial'].includes(item.dataStatus))throw Error(`证据 ${id} 的来源状态不可用于序列判断`);
    const observed=Date.parse(item.observedAt),fetched=Date.parse(item.fetchedAt);
    if(!Number.isFinite(observed)||!Number.isFinite(fetched)||observed>fetched)throw Error(`证据 ${id} 的观察与抓取时间顺序无效`);
    if(observed>cutoff||fetched>cutoff)throw Error(`证据 ${id} 晚于规则截止时间`);
  }
  return ordered;
}

function miss(ruleId:string,start:EvidenceSnapshot,matched:Array<{step:TimeSeriesStep;item:EvidenceSnapshot;index:number}>,status:SequenceMiss['status'],reason:string,nextStep?:TimeSeriesStep):SequenceMiss{
  return {
    id:`tsmiss_${digest({ruleId,start:start.id,status,reason,matched:matched.map(row=>row.item.id)})}`,
    startEvidenceId:start.id,
    startAt:start.observedAt,
    status,
    reason,
    matchedStepIds:matched.map(row=>row.step.id),
    evidenceIds:matched.map(row=>row.item.id),
    ...(nextStep?{}:{}),
  };
}

export function evaluateTimeSeriesSequence(input:TimeSeriesConditionInput,rows:EvidenceSnapshot[],options:{now?:number;ruleId?:string;inputVersion?:string}={}):TimeSeriesEvaluation{
  const normalized=normalizeInput(input),now=options.now??Date.now(),ordered=prepareEvidence(normalized,rows,now);
  const ruleId=options.ruleId||`rule_${digest({requestId:normalized.requestId,manifest:normalized})}`;
  const inputVersion=options.inputVersion||digest({evidence:normalized.evidenceIds,steps:normalized.steps,exclusions:normalized.exclusions,maxSpanMs:normalized.maxSpanMs,asOf:normalized.asOf});
  const hits:SequenceHit[]=[];
  const misses:SequenceMiss[]=[];
  const first=normalized.steps[0];
  for(let startIndex=0;startIndex<ordered.length;startIndex++){
    const start=ordered[startIndex];
    if(!matches(first.predicate,start))continue;
    const matched=[{step:first,item:start,index:startIndex}];
    let failed=false;
    for(let stepIndex=1;stepIndex<normalized.steps.length;stepIndex++){
      const step=normalized.steps[stepIndex],previous=matched[matched.length-1].item;
      const min=Date.parse(previous.observedAt)+Number(step.afterPreviousMs||0);
      const max=Date.parse(previous.observedAt)+Number(step.withinPreviousMs||normalized.maxSpanMs);
      let found:number|undefined;
      for(let index=matched[matched.length-1].index+1;index<ordered.length;index++){
        const at=Date.parse(ordered[index].observedAt);
        if(at<min)continue;
        if(at>max)break;
        if(matches(step.predicate,ordered[index])){found=index;break;}
      }
      if(found===undefined){
        misses.push(miss(ruleId,start,matched,'window',`步骤 ${step.id} 未出现在 ${min}–${max} 的有序时间窗口内`,step));
        failed=true;
        break;
      }
      matched.push({step,item:ordered[found],index:found});
    }
    if(failed)continue;
    const matchedByStep=new Map(matched.map(row=>[row.step.id,row]));
    let excluded=false;
    for(const exclusion of normalized.exclusions){
      const anchor=matchedByStep.get(exclusion.afterStepId);
      if(!anchor)continue;
      const from=Date.parse(anchor.item.observedAt),to=from+exclusion.withinMs;
      for(let index=anchor.index+1;index<ordered.length;index++){
        const item=ordered[index],at=Date.parse(item.observedAt);
        if(at>to)break;
        if(at>=from&&matches(exclusion.predicate,item)){
          misses.push(miss(ruleId,start,matched,'excluded',`命中排除条件 ${exclusion.id}：${exclusion.label}；证据 ${item.id} 出现在排除窗口内`));
          excluded=true;
          break;
        }
      }
      if(excluded)break;
    }
    if(excluded)continue;
    hits.push({
      id:`tshit_${digest({ruleId,inputVersion,start:start.id,evidence:matched.map(row=>row.item.id)})}`,
      startAt:start.observedAt,
      endAt:matched[matched.length-1].item.observedAt,
      evidenceIds:matched.map(row=>row.item.id),
      steps:matched.map(row=>({stepId:row.step.id,label:row.step.label,evidenceId:row.item.id,at:row.item.observedAt})),
    });
    if(hits.length>=200)break;
  }
  const base={
    status:(hits.length?'calculated':'empty') as 'calculated'|'empty',
    inputVersion,
    hits,
    misses:misses.slice(0,400),
    evidenceIds:[...normalized.evidenceIds],
    coverage:{evidence:ordered.length,candidateStarts:ordered.filter(row=>matches(first.predicate,row)).length,hits:hits.length,misses:Math.min(misses.length,400)},
    modelCalls:0 as const,
    ordersCreated:0 as const,
    reason:hits.length?'按观察时间顺序得到命中；排除条件和时间窗口均使用已保存证据':misses.length?'没有完整命中；逐项保留步骤窗口或排除原因':'证据中没有首个步骤候选',
  };
  return {...base,contentHash:digest(base)};
}

export class TimeSeriesConditionStore {
  constructor(private state:State,private loadEvidence:(id:string)=>EvidenceSnapshot|null,private now=Date.now){}

  private clock(){return new Date(this.now()).toISOString();}
  private index(){
    if(!this.state.health.ok)throw Error('时间序列条件目录不可用');
    const rows=this.state.get<string[]>('time-series-condition:index:v1')||[];
    if(!Array.isArray(rows)||rows.length>200||rows.some(id=>!/^tscond_[a-f0-9]{64}$/.test(id)))throw Error('时间序列条件目录不可核验');
    return rows;
  }
  private read(id:string):StoredRule{
    if(!/^tscond_[a-f0-9]{64}$/.test(id))throw Error('时间序列条件ID无效');
    this.index();
    const row=this.state.get<StoredRule>('time-series-condition:'+id);
    if(!row||row.id!==id||digest(row.manifest)!==row.manifestHash)throw Error('时间序列条件清单Hash不可核验');
    const {contentHash,...payload}=row.result;
    if(contentHash!==row.contentHash||digest(payload)!==contentHash)throw Error('时间序列条件结果Hash不可核验');
    return structuredClone(row);
  }
  private view(row:StoredRule):TimeSeriesRuleView{
    return {...structuredClone(row),createdAt:new Date(row.createdAt).toISOString(),updatedAt:new Date(row.updatedAt).toISOString()};
  }
  private save(row:StoredRule,action:string,increment=true){
    if(increment)row.version++;
    row.updatedAt=this.now();
    this.state.set('time-series-condition:'+row.id,row);
    this.state.appendAudit({id:randomUUID(),at:this.clock(),action:'time-series-condition-'+action,detail:JSON.stringify({id:row.id,version:row.version,contentHash:row.contentHash,manifestHash:row.manifestHash,status:row.status})});
    return this.view(row);
  }
  list(){
    return this.index().map(id=>{
      const row=this.read(id);
      return {id,market:row.manifest.market,instrument:row.manifest.instrument,name:row.manifest.name,status:row.status,version:row.version,contentHash:row.contentHash,asOf:row.manifest.asOf,hits:row.result.coverage.hits,misses:row.result.coverage.misses,updatedAt:new Date(row.updatedAt).toISOString()};
    }).sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt));
  }
  get(id:string){return this.view(this.read(id));}
  preview(input:TimeSeriesConditionInput){
    const normalized=normalizeInput(input),loaded=normalized.evidenceIds.map(id=>this.loadEvidence(id));
    if(loaded.some(row=>!row))throw Error('条件证据不存在或不可用');
    prepareEvidence(normalized,loaded as EvidenceSnapshot[],this.now());
    const id='tscond_'+digest(normalized.requestId),requestHash=digest(normalized);
    // A preview has not run the rule yet; retain a verifiable zero-run manifest.
    const previewBase={
      status:'empty' as const,inputVersion:digest({evidence:normalized.evidenceIds,steps:normalized.steps,exclusions:normalized.exclusions,maxSpanMs:normalized.maxSpanMs,asOf:normalized.asOf}),
      hits:[],misses:[],evidenceIds:[...normalized.evidenceIds],coverage:{evidence:loaded.length,candidateStarts:0,hits:0,misses:0},modelCalls:0 as const,ordersCreated:0 as const,
      reason:'规则预览已校验证据身份与Hash；确认前不执行命中计算',
    };
    const contentHash=digest(previewBase),resultWithHash={...previewBase,contentHash};
    const old=this.state.get<StoredRule>('time-series-condition:'+id);
    if(old){
      const existing=this.read(id);
      if(existing.requestHash!==requestHash)throw Error('幂等键已绑定不同的时间序列条件');
      return this.view(existing);
    }
    if(this.index().length>=200)throw Error('时间序列条件已达200项，旧记录保留');
    return this.state.transaction(()=>{
      const duplicate=this.state.get<StoredRule>('time-series-condition:'+id);
      if(duplicate)return this.view(this.read(id));
      const row:StoredRule={id,manifest:normalized,manifestHash:digest(normalized),requestHash,result:resultWithHash,contentHash,status:'preview',version:0,createdAt:this.now(),updatedAt:this.now()};
      this.state.set('time-series-condition:index:v1',[...this.index(),id]);
      return this.save(row,'preview',false);
    });
  }
  confirm(id:string,input:{expectedVersion:number;contentHash:string;acknowledge:boolean;confirmationKey:string}){
    return this.state.transaction(()=>{
      const row=this.read(id),confirmationHash=digest({id,expectedVersion:input.expectedVersion,contentHash:input.contentHash,acknowledge:input.acknowledge});
      if(row.confirmationKey===input.confirmationKey){
        if(row.confirmationHash!==confirmationHash)throw Error('确认幂等键已用于不同条件规则');
        return this.view(row);
      }
      if(row.status!=='preview'||row.version!==input.expectedVersion||row.contentHash!==input.contentHash||input.acknowledge!==true)throw Error('需要有效预览版本、结果Hash及明确确认');
      row.status='confirmed';
      row.confirmedAt=this.clock();
      row.confirmationKey=input.confirmationKey;
      row.confirmationHash=confirmationHash;
      return this.save(row,'confirm');
    });
  }
  private runIndex(){
    const rows=this.state.get<string[]>('time-series-condition:run-index:v1')||[];
    if(!Array.isArray(rows)||rows.length>2000||rows.some(id=>!/^tsrun_[a-f0-9]{64}$/.test(id)))throw Error('条件运行目录不可核验');
    return rows;
  }
  private readRun(id:string):StoredRun{
    if(!/^tsrun_[a-f0-9]{64}$/.test(id))throw Error('条件运行ID无效');
    const row=this.state.get<StoredRun>('time-series-condition-run:'+id);
    if(!row||row.id!==id)throw Error('条件运行记录不存在');
    const {contentHash,...payload}=row;
    if(digest(payload)!==contentHash)throw Error('条件运行结果Hash不可核验');
    return structuredClone(row);
  }
  run(ruleId:string,input:{expectedVersion:number;contentHash:string;runKey:string}){
    return this.state.transaction(()=>{
      const row=this.read(ruleId);
      const requestHash=digest({ruleId,expectedVersion:input.expectedVersion,contentHash:input.contentHash});
      const key='time-series-condition:run-key:'+input.runKey,old=this.state.getIdempotent?.<{id:string;requestHash:string}>(key);
      if(old){
        if(old.requestHash!==requestHash)throw Error('运行幂等键已用于不同条件请求');
        return this.readRun(old.id);
      }
      if(row.status!=='confirmed'||row.version!==input.expectedVersion||row.contentHash!==input.contentHash)throw Error('需要已确认规则、当前版本及结果Hash');
      const evidence=row.manifest.evidenceIds.map(id=>this.loadEvidence(id));
      if(evidence.some(item=>!item))throw Error('条件证据不存在或不可用');
      const result=evaluateTimeSeriesSequence(row.manifest,evidence as EvidenceSnapshot[],{now:this.now(),ruleId});
      const runId='tsrun_'+digest({ruleId,ruleVersion:row.version,runKey:input.runKey,inputVersion:result.inputVersion}),run:StoredRun={...result,id:runId,ruleId,ruleVersion:row.version,ruleContentHash:row.contentHash,runKey:input.runKey,createdAt:this.now()};
      const {contentHash:_,...runPayload}=run;
      const hash=digest(runPayload),stored={...run,contentHash:hash};
      this.state.setIdempotent?.(key,{id:runId,requestHash});
      this.state.set('time-series-condition-run:'+runId,stored);
      this.state.set('time-series-condition:run-index:v1',[...this.runIndex(),runId]);
      this.state.appendAudit({id:randomUUID(),at:this.clock(),action:'time-series-condition-run',detail:JSON.stringify({ruleId,runId,inputVersion:result.inputVersion,hits:result.hits.length,misses:result.misses.length})});
      return stored;
    });
  }
  history(ruleId:string){
    this.read(ruleId);
    return this.runIndex().map(id=>this.readRun(id)).filter(row=>row.ruleId===ruleId).sort((left,right)=>right.createdAt-left.createdAt).map(row=>({id:row.id,ruleVersion:row.ruleVersion,createdAt:new Date(row.createdAt).toISOString(),hits:row.hits,misses:row.misses,coverage:row.coverage,inputVersion:row.inputVersion}));
  }
  getRun(id:string){return this.readRun(id);}
  linkHit(ruleId:string,hitId:string,input:{expectedVersion:number;projectId:string;projectVersion:number;linkKey:string},projects:ProjectLinker){
    return this.state.transaction(()=>{
      const rule=this.read(ruleId);
      if(rule.version!==input.expectedVersion)throw Error('条件规则版本已变化，请刷新重试');
      const run=this.runIndex().map(id=>this.readRun(id)).find(row=>row.ruleId===ruleId&&row.hits.some(hit=>hit.id===hitId));
      if(!run)throw Error('条件命中不存在');
      const hit=run.hits.find(row=>row.id===hitId)!;
      const requestHash=digest({ruleId,hitId,projectId:input.projectId,projectVersion:input.projectVersion});
      if(hit.linkKey===input.linkKey){
        if(hit.linkRequestHash!==requestHash)throw Error('关联幂等键已用于不同研究项目');
        return {hit,projectId:hit.linkedProjectId,projectVersion:hit.linkedProjectVersion};
      }
      if(hit.linkedProjectId)throw Error('该条件命中已关联研究项目，不自动替换');
      if(!/^project_[a-f0-9-]{36}$/.test(input.projectId)||!Number.isSafeInteger(input.projectVersion)||input.projectVersion<1)throw Error('研究项目或版本无效');
      const linked=projects.link(input.projectId,input.projectVersion,{kind:'condition-hit',id:hitId});
      const nextProjectVersion=Number((linked as {version?:unknown})?.version);
      hit.linkedProjectId=input.projectId;
      hit.linkedProjectVersion=Number.isSafeInteger(nextProjectVersion)&&nextProjectVersion>0?nextProjectVersion:input.projectVersion+1;
      hit.linkedAt=this.clock();
      hit.linkKey=input.linkKey;
      hit.linkRequestHash=requestHash;
      const {contentHash,...payload}=run,hash=digest(payload);
      this.state.set('time-series-condition-run:'+run.id,{...run,contentHash:hash});
      this.save({...rule},'hit-linked');
      return {hit,projectId:hit.linkedProjectId,projectVersion:hit.linkedProjectVersion};
    });
  }
  reference(id:string){
    const runIndex=this.runIndex();
    for(const runId of runIndex){
      const run=this.readRun(runId);
      const hit=run.hits.find(row=>row.id===id);
      if(!hit)continue;
      const rule=this.read(run.ruleId);
      const fixed={id:hit.id,startAt:hit.startAt,endAt:hit.endAt,evidenceIds:hit.evidenceIds,steps:hit.steps,ruleId:rule.id,inputVersion:run.inputVersion};
      return {market:rule.manifest.market,instrument:rule.manifest.instrument,hash:digest(fixed),updatedAt:hit.endAt,summary:{ruleId:rule.id,ruleName:rule.manifest.name,hits:1,inputVersion:run.inputVersion}};
    }
    return null;
  }
}
