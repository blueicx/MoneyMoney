import type { DataRevision, DatasetPartition } from '../storage/data-lake';
export interface RevisionImpactRecord {
  id:string;kind:'experiment'|'signal'|'decision';market:string;instrument:string;timeframe?:string;createdAt:string;
  snapshotHash?:string|null;partitionRefs?:Array<{partitionId:string;hash?:string}>;
}
export interface RevisionImpactInput {
  market:string;instrument:string;timeframe?:string;asOf:string;revisions:DataRevision[];
  partitions:Array<Pick<DatasetPartition,'id'|'market'|'instrument'|'timeframe'|'dataset'|'contentHash'|'periodStart'|'periodEnd'|'status'>>;
  records:RevisionImpactRecord[];
}
/** Catalog lineage only. A newer publication without overlapping scope is not a revision finding. */
export function buildResearchRevisionImpact(input:RevisionImpactInput){
  const cut=Date.parse(input.asOf),same=(r:{market:string;instrument:string;timeframe?:string})=>r.market===input.market&&r.instrument===input.instrument&&(!input.timeframe||r.timeframe===input.timeframe);
  if(!['stocks','options','crypto','prediction'].includes(input.market)||!input.instrument)throw Error('需要明确市场与标的');
  if(!Number.isFinite(cut))throw Error('修订观察时点无效');
  if(input.records.length>500||input.revisions.length>2000||input.partitions.length>2000)throw Error('修订检查超过记录上限');
  const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const partitions=new Map(input.partitions.filter(r=>same(r)&&r.status==='committed'&&Number.isFinite(Date.parse(r.periodStart))&&Number.isFinite(Date.parse(r.periodEnd))&&Date.parse(r.periodStart)<=Date.parse(r.periodEnd)).map(r=>[r.id,r]));
  const revisions=input.revisions.filter(r=>{const p=partitions.get(r.partitionId);return same(r)&&hash(r.contentHash)&&Number.isFinite(Date.parse(r.publishedAt))&&Date.parse(r.publishedAt)<=cut&&p?.contentHash===r.contentHash&&p.dataset===r.dataset&&p.timeframe===r.timeframe;});
  const byId=new Map(revisions.map(r=>[r.id,r]));
  const rows=input.records.filter(r=>r.market===input.market&&r.instrument===input.instrument&&(!r.timeframe||!input.timeframe||r.timeframe===input.timeframe)).map(record=>{
    const created=Date.parse(record.createdAt);
    const pinned=Number.isFinite(created)&&created<=cut?revisions.filter(r=>Date.parse(r.publishedAt)<=created&&
      (hash(record.snapshotHash)&&record.snapshotHash===r.contentHash||record.partitionRefs?.some(ref=>ref.partitionId===r.partitionId&&(!ref.hash||ref.hash===r.contentHash)))):[];
    const pinnedIds=new Set(pinned.map(r=>r.id));
    const findings=revisions.flatMap(revision=>{
      if(!revision.supersedes)return [];
      const seen=new Set([revision.id]);let old=byId.get(revision.supersedes);
      while(old&&!seen.has(old.id)){
        seen.add(old.id);
        if(pinnedIds.has(old.id)){
          const before=partitions.get(old.partitionId)!,after=partitions.get(revision.partitionId)!;
          const a=[Date.parse(before.periodStart),Date.parse(before.periodEnd)],b=[Date.parse(after.periodStart),Date.parse(after.periodEnd)];
          if(old.dataset===revision.dataset&&old.timeframe===revision.timeframe&&old.contentHash!==revision.contentHash&&Date.parse(revision.publishedAt)>Date.parse(old.publishedAt)&&[...a,...b].every(Number.isFinite)&&Math.max(a[0],b[0])<=Math.min(a[1],b[1])){
            return [{revisionId:revision.id,previousRevisionId:old.id,oldHash:old.contentHash,newHash:revision.contentHash,publishedAt:revision.publishedAt,reason:'明确引用的旧分区存在同范围后续目录版本；需要人工检查，不代表所有字段已被更正。'}];
          }
        }
        old=old.supersedes?byId.get(old.supersedes):undefined;
      }
      return [];
    });
    return {id:record.id,kind:record.kind,market:record.market,instrument:record.instrument,status:findings.length?'review-required':pinned.length?'linked-no-observed-revision':'unlinked',findings,
      reason:findings.length?'只提示复核，不修改原记录或自动重跑。':pinned.length?'已关联目录分区；观察范围内没有满足引用链和区间条件的修订，不证明数据永久有效。':'缺少可核验的显式分区或Hash关联；不按时间、名称或策略猜配对。'};
  });
  return {market:input.market,instrument:input.instrument,timeframe:input.timeframe||null,asOf:input.asOf,rows,dataStatus:rows.some(r=>r.status==='review-required'||r.status==='unlinked')?'partial':rows.length?'historical':'empty',
    source:'SQLite分区、修订目录与明确保存引用',reason:'只读目录关联，不重新读取或证明Parquet文件完整性；不抓取上游、不覆盖实验、不暂停策略。',orderChanges:0,modelCalls:0};
}
