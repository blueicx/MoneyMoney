import crypto from 'node:crypto';
import type { PointInTimeSnapshot } from '../storage/data-lake';

const KEY='snapshot-comparisons:v1',MAX_RECORDS=1000;
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isText=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export interface SnapshotObservation { snapshot:PointInTimeSnapshot;rows:Array<Record<string,unknown>>;dataStatus:'historical'|'unavailable';updatedAt?:string|null;publishedAt?:string|null;sourceCapturedAt?:string|null;serverFetchedAt?:string|null;adjustment?:string;currency?:string|null;session?:string|null;coverage?:{start?:string|null;end?:string|null;rows?:number}|null;source?:string|null;unavailableReason?:string; }
export interface SnapshotChoice {id:string;requestId:string;idempotencyKey:string;market:string;instrument:string;timeframe:string;references:Array<{id:string;contentHash:string}>;choice:string;reason:string;createdAt:string;requestHash:string;contentHash:string;}
type Doc={version:1;records:SnapshotChoice[]};
function validRecord(record:any):boolean { if(!record||typeof record!=='object')return false;const {contentHash,...payload}=record;return typeof contentHash==='string'&&/^[a-f0-9]{64}$/.test(contentHash)&&hash(payload)===contentHash; }

export function compareSavedSnapshots(input:{market:string;instrument:string;timeframe:string;references:PointInTimeSnapshot[];observations:SnapshotObservation[]}) {
  const {market,instrument,timeframe,references,observations}=input;
  if(!Array.isArray(references)||references.length<2||references.length>4)throw Error('请选择 2 到 4 个快照引用');
  if(!isText(market,30)||!isText(instrument,200)||!isText(timeframe,40))throw Error('比较范围必须包含市场、规范标的和周期');
  if(new Set(references.map(r=>r.id)).size!==references.length)throw Error('快照引用不能重复');
  if(references.some(r=>r.market!==market||r.instrument!==instrument||r.dataset!=='bars'||r.timeframe!==timeframe))throw Error('快照与明确市场、标的、周期范围不符');
  const byId=new Map(observations.map(o=>[o.snapshot.id,o]));
  const rows=references.map(ref=>{const item=byId.get(ref.id);if(!item||item.snapshot.contentHash!==ref.contentHash||item.snapshot.partitionId!==ref.partitionId)throw Error(`快照证据不可核验: ${ref.id}`);const bar=item.rows.at(-1),price=Number(bar?.close);let priceAt:string|null=null;try{if(bar?.timestamp)priceAt=new Date(String(bar.timestamp)).toISOString();}catch{}return {ref,item,price:Number.isFinite(price)&&price>0?price:null,priceAt};}).sort((a,b)=>Date.parse(a.ref.asOf)-Date.parse(b.ref.asOf));
  const alignment=['adjustment','currency','session'] as const;
  const missing=alignment.filter(key=>rows.some(r=>!r.item[key]||['unknown','mixed'].includes(String(r.item[key])))||new Set(rows.map(r=>r.item[key])).size>1);
  const noPrice=rows.some(r=>r.price===null||r.item.dataStatus!=='historical');
  const comparable=!missing.length&&!noPrice;
  const explanations=comparable?rows.slice(1).map((current,index)=>{const prior=rows[index];return {fromSnapshotId:prior.ref.id,toSnapshotId:current.ref.id,fromPrice:prior.price,toPrice:current.price,fromPriceAt:prior.priceAt,toPriceAt:current.priceAt,change:Number((current.price!-prior.price!).toPrecision(12)),changePct:Number(((current.price!/prior.price!-1)*100).toFixed(6)),evidenceRefs:[prior.ref.id,current.ref.id]};}):[];
  return {market,instrument,dataset:'bars',timeframe,dataStatus:comparable?'historical' as const:'unavailable' as const,references:rows.map(({ref,item,price,priceAt})=>({id:ref.id,contentHash:ref.contentHash,partitionId:ref.partitionId,asOf:ref.asOf,source:item.source??ref.source,snapshotRecordedAt:ref.createdAt,serverFetchedAt:item.serverFetchedAt??null,sourceDataTime:null,partitionPublishedAt:item.publishedAt??null,sourceCapturedAt:null,adjustment:item.adjustment||'unknown',currency:item.currency||'unknown',session:item.session||'unknown',price,priceAt,coverage:item.coverage??null,reason:item.unavailableReason??null})),explanations,reason:comparable?'仅说明已保存快照末条收盘价的算术变化；不代表收益或因果。':`快照价格不可比较：${[...missing.map(x=>`${x} 未对齐`),...(noPrice?['价格或历史覆盖不可用']:[]),...rows.map(r=>r.item.unavailableReason).filter((x):x is string=>Boolean(x))].join('；')}`};
}

export function createSnapshotComparisonStore(options:{state:{get<T>(key:string):T|null;set<T>(key:string,value:T):void;transaction<T>(fn:()=>T):T;appendAudit(input:{id:string;action:string;detail:string;at?:string}):void;health?:{ok:boolean}};resolveSnapshot:(id:string)=>PointInTimeSnapshot|null;resolveIdentity:(market:string,instrument:string)=>{market:string;instrument:string}|null}) {
  const read=():Doc=>{if(options.state.health?.ok===false)throw Error('状态存储健康检查失败');const value=options.state.get<Doc>(KEY);if(value===null)return {version:1,records:[]};if(!value||value.version!==1||!Array.isArray(value.records)||value.records.length>MAX_RECORDS||!value.records.every(validRecord))throw Error('快照选择历史损坏或哈希校验失败');return value;};
  const listChoices=(scope:{market:string;instrument:string})=>{validateScope(scope.market,scope.instrument);return read().records.filter(r=>r.market===scope.market&&r.instrument===scope.instrument);};
  function validateScope(market:string,instrument:string){if(!isText(market,30)||!isText(instrument,200))throw Error('查询必须指定市场和规范标的');const resolved=options.resolveIdentity(market,instrument);if(!resolved||resolved.market!==market||resolved.instrument!==instrument)throw Error('规范标的身份不可核验或有歧义');}
  return {listChoices,
    saveChoice(input:{requestId:string;idempotencyKey:string;market:string;instrument:string;timeframe:string;references:string[];choice:string;reason:string}){
      if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['requestId','idempotencyKey','market','instrument','timeframe','references','choice','reason'].includes(k)))throw Error('选择输入包含不支持字段');
      if(!isText(input.requestId,80)||!isText(input.idempotencyKey,120)||!isText(input.timeframe,40)||!isText(input.choice,240)||!isText(input.reason,2000))throw Error('选择请求字段类型或长度无效');
      validateScope(input.market,input.instrument);
      if(!Array.isArray(input.references)||input.references.length<2||input.references.length>4||input.references.some(id=>!isText(id,240)))throw Error('必须提供 2 到 4 个快照 ID');
      if(new Set(input.references).size!==input.references.length)throw Error('快照引用不能重复');
      const refs=input.references.map(id=>{const ref=options.resolveSnapshot(id);if(!ref)throw Error(`找不到已保存快照: ${id}`);return ref;});
      if(refs.some(r=>r.market!==input.market||r.dataset!=='bars'||r.timeframe!==input.timeframe||options.resolveIdentity(input.market,r.instrument)?.instrument!==input.instrument))throw Error('快照与明确市场、规范标的、周期不符');
      if(!refs.some(r=>r.id===input.choice))throw Error('选择必须引用本次比较中的快照');
      const normalized={...input,requestId:input.requestId.trim(),idempotencyKey:input.idempotencyKey.trim(),instrument:input.instrument.trim(),reason:input.reason.trim(),references:refs.map(r=>({id:r.id,contentHash:r.contentHash}))};
      const requestHash=hash(normalized);
      return options.state.transaction(()=>{const doc=read(),prior=doc.records.find(r=>r.requestId===normalized.requestId||r.idempotencyKey===normalized.idempotencyKey);if(prior){if(prior.requestHash!==requestHash)throw Error('request ID 或 idempotency key 已用于不同选择');return prior;}if(doc.records.length>=MAX_RECORDS)throw Error('快照选择历史已达 1000 条上限');
        const payload={id:`sc_${crypto.randomUUID()}`,requestId:normalized.requestId,idempotencyKey:normalized.idempotencyKey,market:normalized.market,instrument:normalized.instrument,timeframe:normalized.timeframe,references:normalized.references,choice:normalized.choice,reason:normalized.reason,createdAt:new Date().toISOString(),requestHash};const record={...payload,contentHash:hash(payload)};doc.records.push(record);options.state.set(KEY,doc);options.state.appendAudit({id:record.id,action:'snapshot_comparison_choice',detail:JSON.stringify({market:record.market,instrument:record.instrument,choice:record.choice,contentHash:record.contentHash})});return record;});
    }
  };
}
