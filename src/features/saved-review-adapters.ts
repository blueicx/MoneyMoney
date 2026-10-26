import { createHash } from 'node:crypto';
import type { MarketId } from './research-contracts';
import type { ReviewCandidate, ReviewItem, ReviewQueueStore } from './review-queue';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Project={id:string;market:MarketId;version:number;links:Array<{linkId:string;kind:string;id:string;hash:string;instrument?:string;revisionHash?:string;linkedAt?:string}>};
type ReferenceState={linkId:string;kind:string;id:string;pinnedHash:string;current:any|null;changed:boolean|null;reason:string};
type Forward={id:string;market:MarketId;instrument:string;updatedAt:number;revision:number;signalIds:string[];status:string;captures:any[]};
type Signal={id:string;market:MarketId;instrument:string;triggeredAt:number;forwardObservation?:any;evidenceRefs?:string[]};
type Forecast={id:string;manifest:any;manifestHash:string;outputHash?:string;evaluationHash?:string;status:string;revision:number;evaluation:any;updatedAt:number};
export interface SavedReviewDependencies {
 researchProjects:(market:MarketId)=>Project[];
 projectReferenceStates:(projectId:string)=>ReferenceState[];
 forwardSessions:(market:MarketId)=>Forward[];
 forwardSignals:(id:string)=>Signal[];
 forecasts:(market:MarketId)=>Forecast[];
 savedSourceReport:(market:MarketId)=>{updatedAt:string;items:Array<{id:string;name:string;ok:boolean;status?:string;checkedAt?:string;detail?:string}>}|null;
}
/** Builds candidates from saved repository/catalog records only. savedSourceReport must be a repository read. */
export function createSavedReviewAdapters(store:ReviewQueueStore,deps:SavedReviewDependencies){
 const contexts=new Map<string,ReviewCandidate>();
 function candidates(market:MarketId):ReviewItem[]{
  const raw:ReviewCandidate[]=[],invalid=new Map<string,string>();
  for(const project of deps.researchProjects(market)||[]){if(project.market!==market)continue;const states=deps.projectReferenceStates(project.id)||[];for(const link of project.links||[]){if(link.kind==='project-conclusion')continue;const state=states.find(x=>x.linkId===link.linkId);if(!state||!(state.changed===true||state.current===null))continue;const current=state.current,currentHash=current?.revisionHash||current?.hash||null,sourceTime=current?.updatedAt||link.linkedAt,observedAt=sourceTime&&Number.isFinite(Date.parse(sourceTime))?new Date(sourceTime).toISOString():undefined,version=hash({projectVersion:project.version,linkId:link.linkId,pinnedHash:link.hash,currentHash,changed:state.changed});raw.push({kind:'research-reference-revision',market,referenceId:`${project.id}/${link.linkId}`,version,title:`研究引用${current?'已修订':'不可读取'} · ${link.instrument||current?.instrument||link.id}`,instrument:link.instrument||current?.instrument,summary:state.reason||'保存的引用状态已变化',observedAt,evidenceRefs:[link.id,link.hash,currentHash].filter((x):x is string=>typeof x==='string')});if(!current)invalid.set(`${market}:research-reference-revision:${project.id}/${link.linkId}:${version}`,state.reason||'明确引用当前不可读取');}}
  for(const row of deps.forwardSessions(market)||[]){if(row.market!==market)continue;for(const signal of deps.forwardSignals(row.id)||[]){if(signal.market!==market||signal.instrument!==row.instrument)continue;const horizon=[1,3,5,20].find(n=>signal.forwardObservation?.horizons?.[n]?.mature===true);if(!horizon)continue;const frozen=signal.forwardObservation||{},observedAt=Number.isFinite(frozen.observedAt)?new Date(frozen.observedAt).toISOString():undefined,version=hash({signalId:signal.id,triggeredAt:signal.triggeredAt,evidenceRefs:signal.evidenceRefs||[],snapshotId:frozen.snapshotId||null,dataHash:frozen.dataHash||null,observedAt,horizon});raw.push({kind:'forward-maturity',market,referenceId:signal.id,version,title:`前向观察待复核 · ${signal.instrument}`,instrument:signal.instrument,observedAt,summary:`${horizon} 根观察已成熟 · ${row.status==='active'?'前向观察':'观察暂停或已停止'}`,evidenceRefs:[...(signal.evidenceRefs||[]),frozen.snapshotId,frozen.dataHash].filter((x):x is string=>typeof x==='string')});}}
  for(const row of deps.forecasts(market)||[]){if(row.manifest?.market!==market)continue;if(row.status==='completed'&&!row.evaluation&&row.manifest.targetCloseAt<=Date.now())raw.push({kind:'forecast-awaiting-score',market,referenceId:row.id,version:hash({manifestHash:row.manifestHash,outputHash:row.outputHash||null,revision:row.revision}),title:`预测等待评分 · ${row.manifest.instrument}`,instrument:row.manifest.instrument,observedAt:Number.isFinite(row.updatedAt)?new Date(row.updatedAt).toISOString():undefined,summary:'固定目标已到期，需读取已保存来源进行评分',evidenceRefs:[row.manifestHash,row.outputHash].filter((x):x is string=>typeof x==='string')});}
  const report=deps.savedSourceReport(market);for(const source of report?.items||[]){if(source.ok)continue;const observedAt=source.checkedAt||report?.updatedAt;const version=hash({checkedAt:observedAt||null,status:source.status||null,detail:source.detail||null});raw.push({kind:'source-recheck',market,referenceId:source.id,version,observedAt:observedAt&&Number.isFinite(Date.parse(observedAt))?new Date(observedAt).toISOString():undefined,title:`来源复查 · ${source.name}`,summary:`${source.status||'unavailable'} · ${source.detail||''}`});}
  const current=store.build(market,raw,(candidate)=>{const reason=invalid.get(`${market}:${candidate.kind}:${candidate.referenceId}:${candidate.version}`);return reason?{valid:false,reason}:{valid:true};}),byId=new Map(current.map(x=>[x.id,x])),retained=store.retained('admin',market),historical=retained.filter(item=>!byId.has(item.id)).map(item=>store.withInvalidReason(item,'来源中已删除或不可读取；保留原版本供复查'));current.sort((a,b)=>(Date.parse(b.observedAt||'')||0)-(Date.parse(a.observedAt||'')||0));
  for(const key of contexts.keys())if(key.startsWith(`${market}:`))contexts.delete(key);for(const item of current)contexts.set(`${market}:${item.kind}:${item.referenceId}:${item.version}`,item);return [...current,...historical];
 }
 return {candidates,refresh:(market:MarketId)=>store.retain('admin',candidates(market)),validate:(item:ReviewItem)=>({valid:contexts.has(`${item.market}:${item.kind}:${item.referenceId}:${item.version}`),reason:'源引用已经删除或版本不可读取'}),itemHash:(item:ReviewItem)=>hash(item)};
}

export interface SavedEvaluationLabs { intent:{read:(id:string)=>any}; forecast:{read:(id:string)=>any} }
/** Read-only resolver for explicitly prefixed IDs; preserves provider credits without converting them to USD. */
export function createSavedCohortCaseLoader(labs:SavedEvaluationLabs){
 return (market:string,reference:string):any|null=>{
  const split=reference.indexOf('/');if(split<1)return null;const kind=reference.slice(0,split),id=reference.slice(split+1);
  if(kind==='intent'){
   const saved=labs.intent.read(id);if(saved.manifest.market!==market)return {market:saved.manifest.market,cases:[{market:saved.manifest.market}]};
   const outputs=saved.outputs?.length?saved.outputs:saved.manifest.models.map((model:string)=>({requestedModel:model,ok:false,status:saved.status==='cancelled'?'cancelled':saved.status==='running'?'pending':'pending'}));return {market,cases:outputs.map((output:any)=>{const evidence=output.evidence;return {market,status:output.ok?'completed':output.status|| (saved.status==='cancelled'?'cancelled':saved.status==='running'?'pending':'failed'),actualModel:output.ok?evidence?.returnedModel:null,requestedModel:output.requestedModel||evidence?.requestedModel||null,manifest:{market,promptVersion:saved.manifest.promptVersion,promptHash:saved.manifest.promptHash,inputHash:saved.manifest.inputHash,model:output.requestedModel||evidence?.requestedModel||null,target:null},manifestHash:saved.hash,output:output.ok?evidence.output:null,outputHash:output.ok?evidence.outputHash:null,evaluation:null,actualCostCredits:null,costUnit:null,sourceId:id};})};
  }
  if(kind==='forecast'){
   const p=labs.forecast.read(id);if(p.manifest.market!==market)return {market:p.manifest.market,cases:[{market:p.manifest.market}]};return {market,cases:[{market,status:p.status,actualModel:p.actualModel||null,requestedModel:p.manifest.model,manifest:{...p.manifest,inputHash:p.manifestHash,model:p.manifest.model},manifestHash:p.manifestHash,output:p.output,outputHash:p.outputHash,evaluation:p.evaluation,evaluationHash:p.evaluationHash,actualCostCredits:p.actualCostCredits??null,costUnit:p.costSource==='provider-response'?'OpenRouter credits':null,sourceId:id}]};
  }
  return null;
 };
}
