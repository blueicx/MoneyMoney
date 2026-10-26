import { createHash, randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import { MARKET_IDS, type MarketId } from './research-contracts';

export type ReviewKind = 'research-reference-revision' | 'forward-maturity' | 'forecast-awaiting-score' | 'source-recheck';
export interface ReviewCandidate { kind: ReviewKind; referenceId: string; version: string; title: string; market?: MarketId; instrument?: string; summary?: string; evidenceRefs?: string[]; observedAt?:string }
export interface ReviewItem extends ReviewCandidate { id: string; market: MarketId; invalidReason: string | null; contentHash:string }
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const contentDigest=(item:Record<string,unknown>)=>{const {contentHash,...content}=item;return digest(content);};
const validKinds: ReviewKind[] = ['research-reference-revision','forward-maturity','forecast-awaiting-score','source-recheck'];
type State = Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'>;

/** Versioned review queue. Reads never mutate source records. Completion is an audited, separate action. */
export class ReviewQueueStore {
  constructor(private state: State, private now = () => new Date().toISOString()) {}
  build(market: MarketId, candidates: ReviewCandidate[], validate: (candidate: ReviewCandidate) => {valid:boolean;reason?:string} = () => ({valid:true})): ReviewItem[] {
    this.healthy(); if (!MARKET_IDS.includes(market) || !Array.isArray(candidates) || candidates.length > 5000) throw Error('市场无效或单市场复查候选超过5000项容量');
    return candidates.filter(x => {if(!x||typeof x!=='object'||x.market!==undefined&&!MARKET_IDS.includes(x.market))throw Error('复查引用无效');return x.market === undefined || x.market === market;}).map(x => {
      if (!x || Object.keys(x).some(k=>!['kind','referenceId','version','title','market','instrument','summary','evidenceRefs','observedAt'].includes(k)) || !validKinds.includes(x.kind) || typeof x.referenceId!=='string' || !x.referenceId.trim() || x.referenceId.length > 200 || typeof x.version!=='string' || !x.version.trim() || x.version.length > 200 || typeof x.title!=='string' || !x.title.trim() || x.title.length > 300 || x.market!==undefined&&!MARKET_IDS.includes(x.market) || x.instrument!==undefined&&(typeof x.instrument!=='string'||x.instrument.length>200) || x.summary!==undefined&&(typeof x.summary!=='string'||x.summary.length>2000) || x.evidenceRefs!==undefined&&(!Array.isArray(x.evidenceRefs)||x.evidenceRefs.length>30||x.evidenceRefs.some(y=>typeof y!=='string'||y.length>300)) || x.observedAt!==undefined&&(typeof x.observedAt!=='string'||!Number.isFinite(Date.parse(x.observedAt)))) throw Error('复查引用无效');
      let check: {valid:boolean;reason?:string}; try { check = validate(x); } catch (error) { check = {valid:false,reason:error instanceof Error?error.message:'引用无法核验'}; }
      const identity = {market,kind:x.kind,referenceId:x.referenceId,version:x.version};
      const item:any={...structuredClone(x),market,id:'rq_'+digest(identity),invalidReason:check.valid?null:String(check.reason || '引用无法核验').slice(0,300)};item.contentHash=contentDigest(item);return item;
    });
  }
  retain(owner:string,items:ReviewItem[]){this.healthy();if(typeof owner!=='string'||!owner||owner.length>80||!Array.isArray(items)||items.length>120000||new Set(items.map(x=>x?.id)).size!==items.length)throw Error('复查保留范围无效、超过120000项或包含重复版本');return this.state.transaction(()=>{const markets=new Set<MarketId>(items.map(x=>x.market)),result:Record<string,number>={};for(const market of markets){const key=`review-queue:items:${owner}:${market}`,existing=this.state.get<Record<string,ReviewItem>>(key)||{};if(!existing||typeof existing!=='object'||Array.isArray(existing)||Object.keys(existing).length>25000)throw Error('复查队列快照损坏或超出每市场25000项容量');for(const [id,old] of Object.entries(existing))this.verifyItem(id,old,market);const incoming=items.filter(x=>x.market===market);for(const item of incoming)this.verifyItem(item.id,item,market);for(const item of incoming)existing[item.id]=structuredClone(item);if(Object.keys(existing).length>25000)throw Error(`复查队列${market}市场容量已满（25000）；需显式归档历史版本`);this.state.set(key,existing);result[market]=Object.keys(existing).length;}return result;});}
  retained(owner:string,market:MarketId){this.healthy();if(typeof owner!=='string'||!owner||owner.length>80||!MARKET_IDS.includes(market))throw Error('复查保留范围无效');const rows=this.state.get<Record<string,ReviewItem>>(`review-queue:items:${owner}:${market}`)||{};if(!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length>25000)throw Error('复查队列快照损坏或超出每市场25000项容量');return Object.entries(rows).map(([id,item])=>{this.verifyItem(id,item,market);return structuredClone(item);});}
  getRetained(owner:string,market:MarketId,id:string,version:string){const item=this.retained(owner,market).find(row=>row.id===id&&row.version===version);return item||null;}
  assertItem(item:ReviewItem,market:MarketId,id:string,version:string){this.healthy();this.verifyItem(id,item,market);if(item.version!==version)throw Error('复查版本与指定版本不匹配');return structuredClone(item);}
  withInvalidReason(item:ReviewItem,reason:string){this.verifyItem(item?.id,item,item?.market);if(typeof reason!=='string'||!reason.trim()||reason.length>300)throw Error('复查失效原因无效');const updated:any={...structuredClone(item),invalidReason:reason};updated.contentHash=contentDigest(updated);return updated as ReviewItem;}
  list(owner: string, market: MarketId) {
    this.healthy(); if(typeof owner!=='string'||!owner||owner.length>80||!MARKET_IDS.includes(market))throw Error('复查队列范围无效'); const rows = this.state.get<Record<string, any>>(`review-queue:completion:${owner}`) || {};
    if(!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length>120000)throw Error('复查完成记录损坏或超过120000项容量');return Object.entries(rows).flatMap(([id,x])=>{this.verifyCompletion(id,x);return x.market===market?[structuredClone(x)]:[];});
  }
  completionForIds(owner:string, ids:string[]){this.healthy();if(typeof owner!=='string'||!owner||owner.length>80||!Array.isArray(ids)||ids.length>120000||ids.some(id=>typeof id!=='string'||!/^rq_[a-f0-9]{64}$/.test(id)))throw Error('复查ID列表无效或超过120000项容量');const rows=this.state.get<Record<string,any>>(`review-queue:completion:${owner}`)||{};if(!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length>120000)throw Error('复查完成目录损坏或超过120000项容量');const result:any[]=[];for(let offset=0;offset<ids.length;offset+=500)for(const id of ids.slice(offset,offset+500)){const row=rows[id];if(row){this.verifyCompletion(id,row);result.push(structuredClone(row));}}return result;}
  complete(owner: string, item: ReviewItem, expectedRevision: number, idempotencyKey: string) {
    this.healthy(); if (typeof owner!=='string'||!owner||owner.length>80||!item||!MARKET_IDS.includes(item.market)||!Number.isSafeInteger(expectedRevision)||typeof idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) throw Error('完成操作引用、版本或幂等键无效');this.verifyItem(item.id,item,item.market);
    return this.state.transaction(() => {
      const key=`review-queue:completion:${owner}`, rows=this.state.get<Record<string, any>>(key)||{}, old=rows[item.id];if(!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length>120000)throw Error('复查完成记录目录损坏或超过120000项容量');if(!old&&Object.keys(rows).length>=120000)throw Error('复查完成容量已满；需显式归档审计记录');
      if (old) { if (old.idempotencyKey === idempotencyKey && old.revision === expectedRevision) return structuredClone(old); throw Error('复查版本已完成或幂等键冲突'); }
      if(Object.values(rows).some((row:any)=>row.idempotencyKey===idempotencyKey))throw Error('幂等键已用于其他复查版本');
      if (expectedRevision !== 1) throw Error('复查版本已变化，请刷新');
      const saved:any={id:item.id,market:item.market,kind:item.kind,referenceId:item.referenceId,version:item.version,completed:true,revision:1,completedAt:this.now(),idempotencyKey};saved.contentHash=digest(saved);
      rows[item.id]=saved; this.state.set(key,rows);
      this.state.appendAudit({id:`review-queue:${owner}:${randomUUID()}`,action:'review_queue_complete',detail:JSON.stringify(saved),at:saved.completedAt});
      return structuredClone(saved);
    });
  }
  private verifyCompletion(id:string,row:any){if(!row||row.id!==id||!MARKET_IDS.includes(row.market)||!validKinds.includes(row.kind)||typeof row.referenceId!=='string'||typeof row.version!=='string'||row.completed!==true||row.revision!==1||typeof row.completedAt!=='string'||!Number.isFinite(Date.parse(row.completedAt))||typeof row.idempotencyKey!=='string'||!/^rq_[a-f0-9]{64}$/.test(id))throw Error('复查完成记录结构无效');const {contentHash,...content}=row;if(digest(content)!==contentHash||id!=='rq_'+digest({market:row.market,kind:row.kind,referenceId:row.referenceId,version:row.version}))throw Error('复查完成记录Hash无效');}
  private verifyItem(id:string,item:any,market:MarketId){if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['kind','referenceId','version','title','market','instrument','summary','evidenceRefs','observedAt','id','invalidReason','contentHash'].includes(k))||item.id!==id||item.market!==market||!validKinds.includes(item.kind)||typeof item.referenceId!=='string'||!item.referenceId||item.referenceId.length>200||typeof item.version!=='string'||!item.version||item.version.length>200||typeof item.title!=='string'||!item.title||item.title.length>300||item.instrument!==undefined&&(typeof item.instrument!=='string'||item.instrument.length>200)||item.summary!==undefined&&(typeof item.summary!=='string'||item.summary.length>2000)||item.evidenceRefs!==undefined&&(!Array.isArray(item.evidenceRefs)||item.evidenceRefs.length>30||item.evidenceRefs.some((x:any)=>typeof x!=='string'||x.length>300))||item.observedAt!==undefined&&(typeof item.observedAt!=='string'||!Number.isFinite(Date.parse(item.observedAt)))||item.invalidReason!==null&&(typeof item.invalidReason!=='string'||item.invalidReason.length>300)||id!=='rq_'+digest({market:item.market,kind:item.kind,referenceId:item.referenceId,version:item.version})||!/^([a-f0-9]{64})$/.test(item.contentHash)||contentDigest(item)!==item.contentHash)throw Error('复查条目内容Hash或结构无效');}
  private healthy(){if(!this.state.health.ok)throw Error('复查队列状态库不可用');}
}

/** Adapter output for the existing action-center renderer; completion remains owned by ReviewQueueStore. */
export function reviewQueueActionItems(items: ReviewItem[]) {
  return items.map(item=>({id:item.id,market:item.market,instrument:item.instrument,kind:'review' as const,title:item.title,summary:item.summary,observedAt:item.observedAt||(Number.isFinite(Date.parse(item.version))?new Date(Date.parse(item.version)).toISOString():null),source:'已保存研究记录',dataStatus:item.invalidReason?'unavailable':'historical',reason:item.invalidReason||`${item.kind} · ${item.version}`,evidenceRefs:item.evidenceRefs||[],reviewKind:item.kind,reviewReferenceId:item.referenceId,reviewVersion:item.version})).filter(item=>item.observedAt!==null);
}
export function reviewCoverage(total:number,shown:number,market?:MarketId,warning?:string|null){const scope=market||'overview';return {total,shown,hasMore:total>shown||!!warning,queuePath:`/api/research/review-queue?market=${encodeURIComponent(scope)}&limit=500`};}
