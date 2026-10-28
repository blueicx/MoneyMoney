import {createHash,randomUUID} from 'node:crypto';
import type {DataLakeCatalog,PointInTimeSnapshot} from '../storage/data-lake';
import type {ResearchProjectStore} from './research-projects';
import type {SQLiteStateStore} from '../storage/sqlite-state';

const MARKETS=['stocks','options','crypto','prediction'];
const KEY='research-evidence-recapture:v1';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type ProofCatalog=Pick<DataLakeCatalog,'getSnapshot'|'listSnapshots'|'readSnapshotProofExact'|'verifySavedSnapshotTuple'|'resolveInstrument'>;
type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'>;
type Recapture={id:string;projectId:string;market:string;instrument:string;dataset:string;timeframe:string;original:{id:string;contentHash:string};recaptured:{id:string;contentHash:string};reason:string;createdAt:string;version:number;idempotencyKey:string;requestHash:string;contentHash:string};
type RecaptureDoc={version:1;spaceVersion:number;records:Recapture[];keys:Record<string,string>};
const text=(value:unknown,label:string,max:number)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}无效`);return value.trim();};
function validScope(input:{market:string;instrument:string;timeframe:string},catalog:ProofCatalog){
 if(!MARKETS.includes(input.market)||typeof input.instrument!=='string'||!input.instrument.trim()||input.instrument.length>200||typeof input.timeframe!=='string'||!input.timeframe.trim()||input.timeframe.length>40)throw Error('必须明确提供有效市场、标的和周期');
 const resolved=catalog.resolveInstrument(input.market as any,input.instrument.trim());if(!resolved||resolved.id!==input.instrument.trim())throw Error('标的必须是当前市场唯一登记的规范身份');
 return {market:input.market,instrument:resolved.id,symbol:resolved.symbol,timeframe:input.timeframe.trim()};
}
function validSnapshot(snapshot:PointInTimeSnapshot|null,id:string,scope:{market:string;instrument:string;symbol:string;timeframe:string}){
 if(!snapshot||snapshot.id!==id)throw Error(`已保存快照不存在或 ID 不匹配: ${id}`);
 if(snapshot.market!==scope.market||snapshot.instrument!==scope.symbol||snapshot.dataset!=='bars'||snapshot.timeframe!==scope.timeframe)throw Error('快照与明确的市场、标的、数据集或周期不一致');
 if(!/^[a-f0-9]{64}$/i.test(snapshot.contentHash)||!Number.isFinite(Date.parse(snapshot.asOf))||!Number.isFinite(Date.parse(snapshot.createdAt)))throw Error('快照引用 Hash 或时间无法核验');
 return snapshot;
}
function readDoc(state:State):RecaptureDoc{
 if(state.health?.ok===false)throw Error('状态存储不可用；未覆盖历史关联');
 const doc=state.get<RecaptureDoc>(KEY);if(doc===null)return {version:1,spaceVersion:0,records:[],keys:{}};
 if(!doc||doc.version!==1||!Number.isSafeInteger(doc.spaceVersion)||!Array.isArray(doc.records)||!doc.keys||typeof doc.keys!=='object'||doc.records.length>1000||doc.records.some(row=>!row||row.contentHash!==digest((({contentHash,...rest})=>rest)(row))))throw Error('重采集关联历史损坏或 Hash 校验失败');
 return doc;
}

/** Read exact saved snapshot proof and append explicit recapture relationships without changing project links. */
export function createSavedEvidenceProofService(deps:{catalog:ProofCatalog;projects:Pick<ResearchProjectStore,'read'>;state?:State;now?:()=>number}){
 const now=deps.now||Date.now;
 async function proof(input:{market:string;instrument:string;timeframe:string;snapshotId:string}){
  const scope=validScope(input,deps.catalog),id=text(input.snapshotId,'快照 ID',240),snapshot=validSnapshot(deps.catalog.getSnapshot(id),id,scope);
  try{
   const result=await deps.catalog.readSnapshotProofExact(snapshot);
   if(!result||result.snapshot?.id!==snapshot.id||result.snapshot.contentHash!==snapshot.contentHash||result.snapshot.partitionId!==snapshot.partitionId)throw Error('精确读取返回的快照与目录引用不匹配');
   const files=Array.isArray(result.fileHashes)?result.fileHashes.filter(row=>row&&typeof row.partitionId==='string'&&/^[a-f0-9]{64}$/i.test(row.fileHash)):[];
   const fileHash=files.length===1?files[0].fileHash:null,expectedPartitions=snapshot.partitionId.split(','),verifiedSnapshot=result.dataStatus==='historical'&&files.length===expectedPartitions.length&&expectedPartitions.every(id=>files.some(file=>file.partitionId===id)),missing:string[]=[];
   if(!files.length)missing.push('fileHash');
   if(!result.currency)missing.push('currency');if(!result.session)missing.push('session');
   if(!result.coverage||!Number.isFinite(result.coverage.rows))missing.push('coverage');
   return {market:scope.market,instrument:scope.instrument,timeframe:scope.timeframe,dataStatus:verifiedSnapshot&&!missing.length?'historical':verifiedSnapshot?'partial':'unavailable',verifiedSnapshot,readOnly:true,snapshot:{id:snapshot.id,contentHash:snapshot.contentHash,partitionId:snapshot.partitionId,dataset:snapshot.dataset,market:snapshot.market,instrument:snapshot.instrument,timeframe:snapshot.timeframe,asOf:snapshot.asOf,createdAt:snapshot.createdAt,source:snapshot.source},availabilityProof:result.availabilityProof||null,fileHash,fileHashes:files,currency:result.currency||'unknown',session:result.session||'unknown',adjustment:result.adjustment||'unknown',coverage:result.coverage||null,partitionPublishedAt:result.publishedAt||null,serverFetchedAt:result.serverFetchedAt||null,reason:result.reason|| (missing.length?`已保存数据可精确读取；${missing.join('、')} 原始证明未保存，保持未知`:'逐分区文件 Hash 与固定快照均已核验'),missingProof:missing,evidenceRefs:[snapshot.id,...files.map(row=>row.partitionId)]};
  }catch(error){return {market:scope.market,instrument:scope.instrument,timeframe:scope.timeframe,dataStatus:'unavailable' as const,verifiedSnapshot:false,readOnly:true,snapshot:{id:snapshot.id,contentHash:snapshot.contentHash,partitionId:snapshot.partitionId,dataset:snapshot.dataset,market:snapshot.market,instrument:snapshot.instrument,timeframe:snapshot.timeframe,asOf:snapshot.asOf,createdAt:snapshot.createdAt,source:snapshot.source},fileHash:null,fileHashes:[],currency:'unknown',session:'unknown',adjustment:'unknown',coverage:null,partitionPublishedAt:null,serverFetchedAt:null,reason:error instanceof Error?error.message:'保存的快照证明不可用，未补造来源元数据',missingProof:['fileHash','currency','session','coverage'],evidenceRefs:[snapshot.id]};}
 }
 function listSnapshots(input:{market:string;instrument:string;timeframe:string}){
  const scope=validScope(input,deps.catalog);return deps.catalog.listSnapshots({market:scope.market as any,instrument:scope.symbol,timeframe:scope.timeframe,limit:100}).filter(row=>row.market===scope.market&&row.instrument===scope.symbol&&row.dataset==='bars'&&row.timeframe===scope.timeframe).map(row=>({id:row.id,market:row.market,instrument:scope.instrument,dataset:row.dataset,timeframe:row.timeframe,asOf:row.asOf,createdAt:row.createdAt,contentHash:row.contentHash,source:row.source}));
 }
 function recaptures(projectId:string){const project=deps.projects.read(projectId);if(!deps.state)throw Error('重采集关联存储未配置');const doc=readDoc(deps.state);return {projectId:project.id,market:project.market,spaceVersion:doc.spaceVersion,records:doc.records.filter(row=>row.projectId===project.id&&row.market===project.market)};}
 async function associateRecapture(input:{projectId:string;market:string;instrument:string;timeframe:string;originalSnapshotId:string;recapturedSnapshotId:string;reason:string;expectedVersion:number;idempotencyKey:string}){
  if(!deps.state)throw Error('重采集关联存储未配置');
  const project=deps.projects.read(text(input.projectId,'项目 ID',80)),scope=validScope(input,deps.catalog);
  if(project.market!==scope.market)throw Error('项目市场与重采集市场不一致');
  const reason=text(input.reason,'重采集理由',2000),key=text(input.idempotencyKey,'幂等键',160);
  if(!/^[A-Za-z0-9._:-]{8,160}$/.test(key)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw Error('版本或幂等键无效');
  const old=validSnapshot(deps.catalog.getSnapshot(text(input.originalSnapshotId,'原快照 ID',240)),input.originalSnapshotId,scope),fresh=validSnapshot(deps.catalog.getSnapshot(text(input.recapturedSnapshotId,'新快照 ID',240)),input.recapturedSnapshotId,scope);
  if(old.id===fresh.id)throw Error('新旧快照必须是不同的明确引用');
  const request={projectId:project.id,...scope,dataset:old.dataset,original:{id:old.id,contentHash:old.contentHash},recaptured:{id:fresh.id,contentHash:fresh.contentHash},reason},requestHash=digest(request);
  const before=readDoc(deps.state);const existingId=before.keys[key];if(existingId){const existing=before.records.find(row=>row.id===existingId);if(!existing||existing.requestHash!==requestHash)throw Error('幂等键已绑定其他重采集关联');return structuredClone(existing);}
  if(before.spaceVersion!==input.expectedVersion)throw Error('关联空间版本已变化，请刷新重试');
  const [oldProof,newProof]=await Promise.all([proof({...scope,snapshotId:old.id}),proof({...scope,snapshotId:fresh.id})]);
  const originalTuple=deps.catalog.verifySavedSnapshotTuple(old),newTuple=deps.catalog.verifySavedSnapshotTuple(fresh);
  if(!originalTuple.verified||!newTuple.verified||!newProof.verifiedSnapshot)throw Error('原快照目录元组或新快照文件证明不可用；旧分区元组須可核验，新版本必须有文件Hash证明');
  return deps.state.transaction(()=>{
   const doc=readDoc(deps.state!);const priorId=doc.keys[key];if(priorId){const prior=doc.records.find(row=>row.id===priorId);if(!prior||prior.requestHash!==requestHash)throw Error('幂等键已绑定其他重采集关联');return structuredClone(prior);}
   if(doc.spaceVersion!==input.expectedVersion)throw Error('关联空间版本已变化，请刷新重试');if(doc.records.length>=1000)throw Error('重采集关联已达上限，保留历史');
   const at=new Date(now()).toISOString(),payload={id:'recapture_'+randomUUID(),...request,originalProof:{dataStatus:oldProof.dataStatus,fileHash:oldProof.fileHash,verifiedSnapshot:oldProof.verifiedSnapshot,missingProof:oldProof.missingProof,tupleVerified:originalTuple.verified,reason:originalTuple.reason||oldProof.reason},recapturedProof:{dataStatus:newProof.dataStatus,fileHash:newProof.fileHash,verifiedSnapshot:newProof.verifiedSnapshot,missingProof:newProof.missingProof},createdAt:at,version:doc.spaceVersion+1,idempotencyKey:key,requestHash},record={...payload,contentHash:digest(payload)};
   doc.spaceVersion++;doc.records.push(record);doc.keys[key]=record.id;deps.state!.set(KEY,doc);deps.state!.appendAudit({id:record.id,action:'research_evidence_recapture_associated',detail:JSON.stringify({projectId:project.id,market:scope.market,oldHash:old.contentHash,newHash:fresh.contentHash,contentHash:record.contentHash}),at});return structuredClone(record);
  });
 }
 return {proof,listSnapshots,recaptures,associateRecapture};
}
