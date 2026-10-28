import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import {verifyEvidenceSnapshotHash,type EvidenceSnapshot} from './decision-intelligence';

type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'health'|'appendAudit'>;
type Member={instrument:string;industry:string|null;status:'active'|'delisted'|'unknown'};
interface UniverseInput {market:'stocks';evidenceId:string;asOf:string;requestId:string}
interface UniverseRecord {
 id:string;market:'stocks';asOf:string;observedAt:string;fetchedAt:string;source:EvidenceSnapshot['source'];
 evidenceId:string;evidenceHash:string;members:Member[];createdAt:string;reason:string;contentHash:string;
}
interface Index {ids:string[];requests:Record<string,{requestHash:string;id:string}>}
const indexKey='historical-universe:index:v1';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hasTimezone=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/i.test(value);

/** A frozen observation, not proof of continuous membership between observations. */
export class HistoricalUniverseStore {
 constructor(private state:State,private evidence:(id:string)=>EvidenceSnapshot|null,private now=Date.now){}
 private index():Index {
  const value=this.state.get<Index>(indexKey)||{ids:[],requests:{}};
  if(!this.state.health.ok||!Array.isArray(value.ids)||!value.requests||typeof value.requests!=='object')throw Error('历史标的池目录不可核验');
  return structuredClone(value);
 }
 read(id:string):UniverseRecord {
  if(!/^historical_universe_[a-f0-9-]{36}$/.test(id))throw Error('标的池身份无效');
  const row=this.state.get<UniverseRecord>('historical-universe:record:'+id);
  if(!row||row.id!==id||row.market!=='stocks'||!Array.isArray(row.members))throw Error('历史标的池不存在或损坏');
  const {contentHash,...payload}=row;
  if(contentHash!==digest(payload))throw Error('历史标的池内容Hash不一致');
  return structuredClone(row);
 }
 list(asOf:string){
  const t=Date.parse(asOf);if(!hasTimezone(asOf)||!Number.isFinite(t)||t>this.now())throw Error('查询时点必须包含有效时区');
  return this.index().ids.map(id=>this.read(id)).filter(row=>Date.parse(row.fetchedAt)<=t&&Date.parse(row.observedAt)<=t&&Date.parse(row.createdAt)<=t);
 }
 capture(input:UniverseInput):UniverseRecord {
  if(!input||Object.keys(input).some(k=>!['market','evidenceId','asOf','requestId'].includes(k))||input.market!=='stocks'||typeof input.evidenceId!=='string'||!input.evidenceId||typeof input.requestId!=='string'||!/^[\w-]{16,128}$/.test(input.requestId))throw Error('历史标的池请求或身份无效');
  const cutoff=Date.parse(input.asOf);if(!hasTimezone(input.asOf)||!Number.isFinite(cutoff)||cutoff>this.now())throw Error('历史标的池时点必须包含有效时区');
  const requestHash=digest(input),prior=this.index().requests[input.requestId];
  if(prior){if(prior.requestHash!==requestHash)throw Error('请求ID已绑定其他输入');return this.read(prior.id);}
  const evidence=this.evidence(input.evidenceId);
  if(!evidence||evidence.id!==input.evidenceId||evidence.market!=='stocks'||!verifyEvidenceSnapshotHash(evidence))throw Error('股票池证据不存在或Hash不可核验');
  if(!['historical','live','delayed','cached','partial','stale'].includes(evidence.dataStatus))throw Error('证据来源状态不可用，不能保存成员观察');
  const observed=Date.parse(evidence.observedAt),fetched=Date.parse(evidence.fetchedAt);
  if(!Number.isFinite(observed)||!Number.isFinite(fetched)||observed>fetched||fetched>cutoff)throw Error('来源观察或抓取时间晚于所选时点');
  const raw=evidence.fields.members;
  if(!Array.isArray(raw)||!raw.length||raw.length>500)throw Error('证据须包含1–500个明确成员');
  const seen=new Set<string>(),members:Member[]=raw.map(value=>{
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['instrument','industry','status'].includes(k)))throw Error('成员字段无效');
   const {instrument,industry,status}=value as Record<string,unknown>;
   if(typeof instrument!=='string'||!/^stock:us:[A-Z][A-Z0-9.-]{0,14}$/.test(instrument)||seen.has(instrument))throw Error('成员身份无效或重复');
   if(industry!==null&&(typeof industry!=='string'||!industry.trim()||industry.length>120)||!['active','delisted','unknown'].includes(String(status)))throw Error('成员行业或退市状态无效');
   seen.add(instrument);return {instrument,industry:industry===null?null:(industry as string).trim(),status:status as Member['status']};
  });
  const payload={id:'historical_universe_'+randomUUID(),market:'stocks' as const,asOf:new Date(cutoff).toISOString(),observedAt:evidence.observedAt,fetchedAt:evidence.fetchedAt,source:structuredClone(evidence.source),evidenceId:evidence.id,evidenceHash:evidence.hash,members,createdAt:new Date(this.now()).toISOString(),reason:'仅为来源在该时点的观察；不证明区间内持续成员或完整覆盖，缺失行业和退市证据保持未知。'};
  const record={...payload,contentHash:digest(payload)};
  return this.state.transaction(()=>{
   const index=this.index(),existing=index.requests[input.requestId];
   if(existing){if(existing.requestHash!==requestHash)throw Error('请求ID已绑定其他输入');return this.read(existing.id);}
   if(index.ids.length>=1000)throw Error('历史标的池容量已满，保留原记录');
   this.state.set('historical-universe:record:'+record.id,record,1);index.ids.push(record.id);index.requests[input.requestId]={requestHash,id:record.id};this.state.set(indexKey,index,1);
   this.state.appendAudit({id:randomUUID(),at:record.createdAt,action:'historical-universe-captured',detail:JSON.stringify({id:record.id,evidenceId:record.evidenceId,contentHash:record.contentHash})});
   return structuredClone(record);
  });
 }
}
