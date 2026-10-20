import {createHash} from 'node:crypto';
import type {EvidenceSnapshot,DecisionRecord,SignalOutcome} from './decision-intelligence';
import type {DatasetPartition,DataRevision} from '../storage/data-lake';
import {buildResearchRevisionImpact} from './research-revision-impact';
import type {ProjectReference,ProjectReferenceState} from './research-projects';
import type {MarketId} from './research-contracts';

interface Sources {
 evidence:(id:string)=>EvidenceSnapshot|null;verifyEvidence:(e:EvidenceSnapshot)=>boolean;
 partition:(id:string)=>DatasetPartition|null;experiment:(id:string)=>any;
 decision:(id:string)=>DecisionRecord|null;signal:(id:string)=>SignalOutcome|null;
 revisions?:(market:MarketId)=>DataRevision[];partitions?:()=>DatasetPartition[];
}
/** Read-only adapters: no nearest-time matching, upstream fetch, task creation or account mutation. */
export function createProjectReferenceResolver(sources:Sources,now=Date.now){
 return (ref:ProjectReference):ProjectReferenceState|null=>{
  if(ref.kind==='evidence'||ref.kind==='event'){
   const evidenceId=ref.kind==='event'?`event-evidence-${ref.id}`:ref.id;
   const e=sources.evidence(evidenceId);if(!e||e.id!==evidenceId||!sources.verifyEvidence(e)||(ref.kind==='event'&&e.workspace!=='event-intelligence'))return null;
   return {market:e.market,instrument:e.instrument,hash:e.hash,updatedAt:e.fetchedAt,expired:['failed','unavailable','empty','unsupported'].includes(e.dataStatus)};
  }
  if(ref.kind==='partition'){
   const p=sources.partition(ref.id);if(!p||p.id!==ref.id||p.status!=='committed')return null;
   const sameScope=(row:{market:string;instrument:string;timeframe:string})=>row.market===p.market&&row.instrument===p.instrument&&row.timeframe===p.timeframe;
   const revisions=(sources.revisions?.(p.market)||[]).filter(sameScope),partitions=(sources.partitions?.()||[p]).filter(sameScope);
   const impact=buildResearchRevisionImpact({market:p.market,instrument:p.instrument,timeframe:p.timeframe,asOf:new Date(now()).toISOString(),revisions,partitions,records:[{id:p.id,kind:'experiment',market:p.market,instrument:p.instrument,timeframe:p.timeframe,createdAt:p.publishedAt,partitionRefs:[{partitionId:p.id,hash:p.contentHash}]}]});
   const latest=impact.rows[0]?.findings.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0];
   return {market:p.market,instrument:p.instrument,hash:p.contentHash,updatedAt:p.fetchedAt,...(latest?{revisionHash:latest.newHash}:{})};
  }
  const saved=ref.kind==='experiment'?sources.experiment(ref.id):null;
  const row=ref.kind==='experiment'?saved?.experiment:ref.kind==='decision'?sources.decision(ref.id):ref.kind==='signal'?sources.signal(ref.id):null;
  if(!row||row.id!==ref.id||!['stocks','options','crypto','prediction'].includes(row.market))return null;
  const time=row.updatedAt??row.createdAt??row.triggeredAt;
  if(typeof time!=='string'&&typeof time!=='number')return null;
  const updatedAt=new Date(time);if(!Number.isFinite(updatedAt.getTime()))return null;
  return {market:row.market as MarketId,instrument:row.instrument,hash:createHash('sha256').update(JSON.stringify(saved||row)).digest('hex'),updatedAt:updatedAt.toISOString(),expired:ref.kind==='signal'&&Number.isFinite(row.expiresAt)&&row.expiresAt<=now()};
 };
}
