import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import type {ResearchProjectStore,ResearchProject} from './research-projects';

const KEY='research-preregistration:v1:';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value:unknown,label:string,max=2000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}不能为空或超过${max}字`);return value.trim();};
type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'>;
type FixedReference={linkId:string;kind:string;id:string;market:string;instrument?:string;hash:string};
type Registration={id:string;projectId:string;market:string;projectVersion:number;registeredAt:string;version:number;registrationStatus:'prospective'|'retrospective';hypothesis:string;primaryMetric:string;sampleDefinition:string;stopCondition:string;parameterBudget:Record<string,{min:number;max:number;steps:number}>;trialBudget:number;fixedReferences:FixedReference[];idempotencyKey:string;requestHash:string;contentHash:string};
type ExperimentEvidence={id:string;registrationId:string;experimentId:string;market:string;instrument:string;outcome:'succeeded'|'failed';parameterHash:string;inputHash:string|null;inputHashStatus:'verified'|'unknown'|'mismatch';dataHash:string|null;fixedInputStatus:'verified'|'unknown'|'mismatch';temporalStatus:'verified'|'unknown'|'retrospective'|'mismatch';budgetStatus:'within'|'unknown'|'exceeded';savedResultHash:string;costEvidence:'complete'|'missing';sampleLeakage:'unknown';at:string};
type Association={id:string;projectId:string;registrationId:string;at:string;experiments:ExperimentEvidence[];idempotencyKey:string;requestHash:string;contentHash:string};
type Doc={version:1;spaceVersion:number;registrations:Registration[];associations:Association[];keys:Record<string,string>};
const empty=():Doc=>({version:1,spaceVersion:0,registrations:[],associations:[],keys:{}});
function validDoc(doc:Doc|null):Doc{
 if(doc===null)return empty();
 if(!doc||doc.version!==1||!Number.isSafeInteger(doc.spaceVersion)||doc.spaceVersion<0||!Array.isArray(doc.registrations)||!Array.isArray(doc.associations)||!doc.keys||typeof doc.keys!=='object'||doc.registrations.length>500||doc.associations.length>2000)throw Error('预注册历史格式损坏，不覆盖或修复历史');
 const valid=(row:any)=>row&&typeof row==='object'&&/^[a-f0-9]{64}$/.test(row.contentHash)&&digest((({contentHash,...rest}:any)=>rest)(row))===row.contentHash;
 if(doc.registrations.some(row=>!valid(row))||doc.associations.some(row=>!valid(row)))throw Error('预注册历史 Hash 校验失败');
 return doc;
}
function budget(input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('参数预算必须明确提供');
 const entries=Object.entries(input as Record<string,any>);if(!entries.length||entries.length>30)throw Error('参数预算需要1–30个明确参数');let trialBudget=1;const result:Registration['parameterBudget']={};
 for(const [key,row] of entries){if(!/^[\w.-]{1,64}$/.test(key)||!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['min','max','steps'].includes(k))||![row.min,row.max].every(Number.isFinite)||row.min>row.max||!Number.isSafeInteger(row.steps)||row.steps<1||row.steps>1000)throw Error('参数范围或步数无效');trialBudget*=row.steps;if(!Number.isSafeInteger(trialBudget)||trialBudget>100_000)throw Error('参数试验预算超过100000');result[key]={min:row.min,max:row.max,steps:row.steps};}
 return {budget:Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b))),trialBudget};
}
function registryKey(projectId:string){if(typeof projectId!=='string'||!/^project_[a-f0-9-]{36}$/.test(projectId))throw Error('项目身份无效');return KEY+projectId;}

/** Immutable registrations and append-only associations to server-saved experiment records. */
export function createResearchPreregistrationStore(deps:{state:State;projects:Pick<ResearchProjectStore,'read'>;getSavedExperiment?:(id:string)=>any|null;now?:()=>number}){
 const now=deps.now||Date.now;
 function read(projectId:string){if(deps.state.health?.ok===false)throw Error('预注册存储不可用，不覆盖历史');return validDoc(deps.state.get<Doc>(registryKey(projectId)));}
 function view(project:ResearchProject,doc=read(project.id)){
  const registrations=doc.registrations.filter(row=>row.projectId===project.id&&row.market===project.market).map(row=>{
   const experiments=doc.associations.filter(a=>a.registrationId===row.id).flatMap(a=>a.experiments),uniqueById=new Map(experiments.map(item=>[item.experimentId,item])),trials=[...uniqueById.values()];
   const budgetExceeded=trials.length>row.trialBudget||trials.some(item=>item.budgetStatus==='exceeded'),comparableTrialCount=trials.filter(item=>item.fixedInputStatus==='verified'&&item.temporalStatus==='verified'&&item.budgetStatus==='within').length;
   return {...row,experiments:trials,trialCount:trials.length,uniqueConfigurations:new Set(trials.map(item=>item.parameterHash)).size,comparableTrialCount,budgetExceeded,missingCostCount:trials.filter(item=>item.costEvidence==='missing').length,costCompleteness:trials.length&&trials.every(item=>item.costEvidence==='complete')?'complete':'unknown',sampleLeakage:'unknown' as const,robustnessEvidence:trials.map(item=>({experimentId:item.experimentId,parameterHash:item.parameterHash,inputHash:item.inputHash,inputHashStatus:item.inputHashStatus,temporalStatus:item.temporalStatus,dataHash:item.dataHash,fixedInputStatus:item.fixedInputStatus,budgetStatus:item.budgetStatus,outcome:item.outcome})),reason:'只关联明确保存的实验；试验次数为去重后的已保存 ID，input Hash、固定输入匹配、登记时间核验、缺失成本和样本泄漏均单独披露；历史未登记尝试未知；不运行实验或新增计算'};
  });
  return {projectId:project.id,market:project.market,spaceVersion:doc.spaceVersion,registrations,reason:'预注册不可变；新登记追加版本并保留旧记录'};
 }
 function list(projectId:string,market:string){const project=deps.projects.read(projectId);if(project.market!==market)throw Error('项目市场上下文不匹配');return view(project);}
 function register(input:{projectId:string;market:string;expectedVersion:number;idempotencyKey:string;hypothesis:string;primaryMetric:string;sampleDefinition:string;stopCondition:string;parameterBudget:unknown;fixedReferenceLinkIds:string[]}){
  const project=deps.projects.read(input.projectId),key=registryKey(project.id);if(input.market!==project.market)throw Error('预注册市场与研究项目不匹配');
  const idempotencyKey=text(input.idempotencyKey,'幂等键',160);if(!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw Error('预注册版本或幂等键无效');
  if(!Array.isArray(input.fixedReferenceLinkIds)||input.fixedReferenceLinkIds.length<1||input.fixedReferenceLinkIds.length>200||input.fixedReferenceLinkIds.some(id=>typeof id!=='string'||!id)||new Set(input.fixedReferenceLinkIds).size!==input.fixedReferenceLinkIds.length)throw Error('必须选择1–200项不重复的项目固定引用');
  const byId=new Map(project.links.map(link=>[link.linkId,link])),fixedReferences=input.fixedReferenceLinkIds.map(linkId=>{const row=byId.get(linkId);if(!row||row.market!==project.market||!/^[a-f0-9]{64}$/i.test(row.hash))throw Error('固定引用不属于当前项目、市场或可核验 Hash');return {linkId:row.linkId,kind:row.kind,id:row.id,market:row.market,...(row.instrument?{instrument:row.instrument}:{}),hash:row.hash};});
  const normalized={projectId:project.id,market:project.market,projectVersion:project.version,hypothesis:text(input.hypothesis,'假设'),primaryMetric:text(input.primaryMetric,'主要指标',240),sampleDefinition:text(input.sampleDefinition,'样本定义'),stopCondition:text(input.stopCondition,'停止条件'),...budget(input.parameterBudget),fixedReferences},requestHash=digest(normalized);
  return deps.state.transaction(()=>{
   const doc=read(project.id),storageKey='register:'+idempotencyKey,priorId=doc.keys[storageKey],prior=doc.registrations.find(row=>row.id===priorId);
   if(prior){if(prior.requestHash!==requestHash)throw Error('幂等键已绑定其他预注册内容');return structuredClone(prior);}
   if(doc.spaceVersion!==input.expectedVersion)throw Error('预注册空间版本已变化，请刷新重试');if(doc.registrations.length>=500)throw Error('预注册历史已达500条上限');
   const at=now(),retro=project.conclusions.some(row=>Number.isFinite(Date.parse(row.at))&&Date.parse(row.at)<=at)||project.links.some(row=>['experiment','study'].includes(row.kind)&&Number.isFinite(Date.parse(row.linkedAt))&&Date.parse(row.linkedAt)<=at);
   const inputBindingStatus=fixedReferences.some(row=>['partition','evidence'].includes(row.kind))?'fixed-evidence-selected' as const:'unknown' as const;
   const payload={id:'prereg_'+randomUUID(),projectId:project.id,market:project.market,projectVersion:project.version,registeredAt:new Date(at).toISOString(),version:doc.spaceVersion+1,registrationStatus:retro?'retrospective' as const:'prospective' as const,inputBindingStatus,hypothesis:normalized.hypothesis,primaryMetric:normalized.primaryMetric,sampleDefinition:normalized.sampleDefinition,stopCondition:normalized.stopCondition,parameterBudget:normalized.budget,trialBudget:normalized.trialBudget,fixedReferences,idempotencyKey,requestHash},record={...payload,contentHash:digest(payload)};
   doc.spaceVersion++;doc.registrations.push(record);doc.keys[storageKey]=record.id;deps.state.set(key,doc);deps.state.appendAudit({id:record.id,action:'research_preregistration_frozen',detail:JSON.stringify({projectId:project.id,market:project.market,version:record.version,status:record.registrationStatus,contentHash:record.contentHash}),at:record.registeredAt});return structuredClone(record);
  });
 }
 function associateSavedExperiments(input:{projectId:string;registrationId:string;expectedVersion:number;idempotencyKey:string;experimentIds:string[]}){
  const project=deps.projects.read(input.projectId),key=registryKey(project.id),idempotencyKey=text(input.idempotencyKey,'幂等键',160);
  if(!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw Error('关联版本或幂等键无效');
  if(!Array.isArray(input.experimentIds)||input.experimentIds.length>200||input.experimentIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(input.experimentIds).size!==input.experimentIds.length)throw Error('实验 ID 清单无效');
  const docBefore=read(project.id),registration=docBefore.registrations.find(row=>row.id===input.registrationId);if(!registration||registration.projectId!==project.id||registration.market!==project.market)throw Error('预注册不存在或市场不匹配');
  const allowed=new Map(project.links.filter(row=>row.kind==='experiment'&&row.market===project.market).map(row=>[row.id,row]));
  const savedRows=input.experimentIds.map(experimentId=>{
   if(!allowed.has(experimentId))throw Error('只能关联本项目明确保存的实验引用');const link=allowed.get(experimentId)!,saved=deps.getSavedExperiment?.(experimentId);if(!saved||saved.experiment?.id!==experimentId||saved.experiment?.market!==project.market||!saved.experiment.instrument||link.market!==project.market)throw Error(`明确的已保存实验不存在或市场身份不匹配: ${experimentId}`);
   if(digest(saved)!==link.hash)throw Error(`已保存实验 Hash 与项目固定引用不一致: ${experimentId}`);
   const parameters=saved.experiment.parameters??saved.input?.context?.parameters??saved.input?.parameters;if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw Error(`已保存实验缺少可核验参数: ${experimentId}`);
   let outcome:'succeeded'|'failed';if(['failed','error'].includes(saved.status)||typeof saved.error==='string'&&saved.error.trim()||typeof saved.failure==='string'&&saved.failure.trim())outcome='failed';else if(saved.backtest||saved.result||saved.robustness)outcome='succeeded';else throw Error(`已保存实验没有明确成功或失败结果: ${experimentId}`);
   const sortedParameters=Object.fromEntries(Object.entries(parameters).sort(([a],[b])=>a.localeCompare(b))),parameterBudget=registration.parameterBudget,paramNames=Object.keys(parameterBudget),actualNames=Object.keys(sortedParameters),budgetStatus:ExperimentEvidence['budgetStatus']=actualNames.length===paramNames.length&&paramNames.every(name=>typeof sortedParameters[name]==='number')?paramNames.every(name=>{const range=parameterBudget[name],value=Number(sortedParameters[name]),step=range.steps<=1?0:(range.max-range.min)/(range.steps-1),onGrid=range.max===range.min?value===range.min:range.steps<=1?value===range.min:Math.abs((value-range.min)/step-Math.round((value-range.min)/step))<1e-8;return value>=range.min&&value<=range.max&&onGrid;})?'within':'exceeded':'unknown';
   const savedInput=saved.reproducibility?.input||saved.input||null,inputHash=savedInput&&typeof savedInput==='object'&&!Array.isArray(savedInput)?digest(savedInput):null,inputContext=savedInput?.context||savedInput,claimedInputHash=saved.inputHash||saved.experiment.inputHash||saved.reproducibility?.inputHash||null,inputHashStatus:ExperimentEvidence['inputHashStatus']=typeof claimedInputHash!=='string'||!inputHash?'unknown':!/^[a-f0-9]{64}$/i.test(claimedInputHash)||claimedInputHash!==inputHash?'mismatch':'verified',experimentDataHash=saved.experiment.dataSnapshotHash||inputContext?.dataSnapshotHash||null,proofRefs=registration.fixedReferences.filter(row=>['partition','evidence'].includes(row.kind)&&row.instrument===saved.experiment.instrument),scopeMatches=inputContext?.market===project.market&&inputContext?.instrument===saved.experiment.instrument&&(!saved.experiment.timeframe||inputContext?.timeframe===saved.experiment.timeframe),proofMatches=typeof experimentDataHash==='string'&&proofRefs.some(row=>row.hash===experimentDataHash||row.id===experimentDataHash),registeredAt=Date.parse(registration.registeredAt);
   const createdAt=Date.parse(saved.createdAt||saved.experiment.createdAt||''),completedAt=Date.parse(saved.backtest?.completedAt||saved.result?.completedAt||saved.completedAt||'');
   const temporalStatus:ExperimentEvidence['temporalStatus']=registration.registrationStatus==='retrospective'?'retrospective':!Number.isFinite(registeredAt)||!Number.isFinite(createdAt)||!Number.isFinite(completedAt)?'unknown':createdAt>=registeredAt&&completedAt>=registeredAt?'verified':'mismatch';
   let fixedInputStatus:ExperimentEvidence['fixedInputStatus']=!inputHash||!scopeMatches||!proofRefs.length?'unknown':proofMatches?'verified':'mismatch';if(inputHashStatus==='mismatch'||temporalStatus==='mismatch')fixedInputStatus='mismatch';else if(inputHashStatus!=='verified'||temporalStatus!=='verified')fixedInputStatus='unknown';
   const hasCost=Number.isFinite(saved.experiment.feeRate)&&Number.isFinite(saved.experiment.slippage)&&(Number.isFinite(saved.backtest?.totalFees)||Number.isFinite(saved.totalFees));
   return {experimentId,market:project.market,instrument:saved.experiment.instrument,outcome,parameterHash:digest(sortedParameters),inputHash,inputHashStatus,dataHash:typeof experimentDataHash==='string'&&/^[a-f0-9]{64}$/i.test(experimentDataHash)?experimentDataHash:null,fixedInputStatus,temporalStatus,budgetStatus,savedResultHash:digest(saved),costEvidence:hasCost?'complete' as const:'missing' as const,sampleLeakage:'unknown' as const};
  });
  const normalized={projectId:project.id,registrationId:registration.id,experimentIds:[...input.experimentIds].sort(),savedResultHashes:savedRows.map(row=>row.savedResultHash).sort()},requestHash=digest(normalized);
  deps.state.transaction(()=>{
   const doc=read(project.id),storageKey='associate:'+idempotencyKey,priorId=doc.keys[storageKey],prior=doc.associations.find(row=>row.id===priorId);
   if(prior){if(prior.requestHash!==requestHash)throw Error('幂等键已绑定其他实验清单');return;}
   if(doc.spaceVersion!==input.expectedVersion)throw Error('预注册空间版本已变化，请刷新重试');const at=new Date(now()).toISOString(),seen=new Set(doc.associations.filter(row=>row.registrationId===registration.id).flatMap(row=>row.experiments.map(item=>item.experimentId))),experiments=savedRows.filter(row=>!seen.has(row.experimentId)).map(row=>({...row,id:'experiment-proof_'+digest([registration.id,row.experimentId,row.savedResultHash]),registrationId:registration.id,at}));
   const payload={id:'prereg-association_'+randomUUID(),projectId:project.id,registrationId:registration.id,at,experiments,idempotencyKey,requestHash},association={...payload,contentHash:digest(payload)};doc.spaceVersion++;doc.associations.push(association);doc.keys[storageKey]=association.id;deps.state.set(key,doc);deps.state.appendAudit({id:association.id,action:'research_preregistration_experiments_associated',detail:JSON.stringify({projectId:project.id,registrationId:registration.id,added:experiments.length,contentHash:association.contentHash}),at});
  });
  return view(project,read(project.id)).registrations.find(row=>row.id===registration.id);
 }
 return {list,register,associateSavedExperiments};
}
