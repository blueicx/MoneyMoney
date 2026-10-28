import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import type {MarketId} from './research-contracts';
import type {DecisionRecord,EvidenceSnapshot} from './decision-intelligence';

type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'health'|'appendAudit'>;
type Availability='published'|'observed';
type DecisionSource='manual'|'rule'|'saved-ai';

export interface ReplayOrderLevel {
  price:number;
  quantity:number;
}

export interface ReplayOrderBook {
  bids:ReplayOrderLevel[];
  asks:ReplayOrderLevel[];
  capturedAt:string;
  source:string;
}

export interface ReplayFrame {
  id:string;
  kind:'bar'|'option-chain'|'prediction-book'|'evidence';
  observedAt:string;
  publishedAt:string;
  source:string;
  contentHash:string;
  fields:Record<string,unknown>;
  orderBook?:ReplayOrderBook;
}

export interface ReplayDecision {
  id:string;
  source:DecisionSource;
  referenceId:string|null;
  direction:'up'|'down'|'flat'|'yes'|'no'|'hold';
  thesis:string;
  invalidation:string;
  evidenceRefs:string[];
  availableAt:string;
  contentHash:string;
}

export interface MarketReplayInput {
  market:MarketId;
  instrument:string;
  asOf:string;
  requestId:string;
  evidenceRefs?:string[];
  decisions?:Array<{
    source:DecisionSource;
    referenceId?:string;
    direction:ReplayDecision['direction'];
    thesis:string;
    invalidation:string;
    evidenceRefs:string[];
    availableAt:string;
  }>;
}

interface Manifest {
  market:MarketId;
  instrument:string;
  asOf:string;
  availability:Availability;
  source:string;
  frameRefs:string[];
  framesHash:string;
  decisionsHash:string;
  model:'evidence-only-replay-v1';
  createdAt:number;
}

interface StoredExecutionEvaluation {
  id:string;
  frameId:string;
  side:'buy'|'sell';
  quantity:number;
  limitPrice:number|null;
  status:'filled-model'|'rejected'|'unavailable';
  reason:string;
  referencePrice:number|null;
  at:number;
  hash:string;
}

interface Row {
  id:string;
  requestHash:string;
  manifest:Manifest;
  manifestHash:string;
  frames:ReplayFrame[];
  decisions:ReplayDecision[];
  cursor:number;
  revision:number;
  status:'preview'|'active'|'paused'|'completed'|'stopped';
  confirmedAt?:number;
  executions:StoredExecutionEvaluation[];
  updatedAt:number;
}

interface Dependencies {
  resolve:(market:string,instrument:string)=>{id:string;symbol:string}|null;
  evidence:(id:string)=>EvidenceSnapshot|null;
  decision?:(id:string)=>DecisionRecord|null;
  loadBars?:(input:{market:'stocks'|'crypto';instrument:string;asOf:string;availability:Availability})=>Promise<{
    dataStatus:string;
    source:string|null;
    snapshot?:{id:string;contentHash:string;asOf?:string};
    rows:Array<Record<string,unknown>>;
  }>;
}

const markets:MarketId[]=['stocks','crypto','options','prediction'];
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timestamp=(value:unknown)=>value instanceof Date?value.getTime():Date.parse(String(value));
const canonical=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
};
const contentHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function finitePositive(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>0;}
function cleanText(value:unknown,label:string,max=2000):string{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}不能为空或超过${max}字`);
  return value.trim();
}
function normalizeBook(input:unknown,frameAt:string):ReplayOrderBook|undefined{
  if(input===undefined)return undefined;
  if(!input||typeof input!=='object')throw Error('盘口证据格式无效');
  const value=input as Record<string,unknown>,at=timestamp(value.capturedAt),source=String(value.source||'').trim();
  if(!Number.isFinite(at)||at>timestamp(frameAt)+1000||!source)throw Error('盘口抓取时间或来源不可核验');
  const levels=(raw:unknown,side:'bids'|'asks')=>{
    if(!Array.isArray(raw)||raw.length<1||raw.length>100)throw Error(`盘口${side}层级缺失或超过上限`);
    const rows=raw.map(item=>{
      const row=item as Record<string,unknown>,price=Number(row.price),quantity=Number(row.quantity);
      if(!finitePositive(price)||!finitePositive(quantity))throw Error(`盘口${side}价格或数量无效`);
      return {price,quantity};
    });
    if(side==='bids'&&rows.some((row,index)=>index>0&&row.price>=rows[index-1].price))throw Error('买盘必须按价格严格降序');
    if(side==='asks'&&rows.some((row,index)=>index>0&&row.price<=rows[index-1].price))throw Error('卖盘必须按价格严格升序');
    return rows;
  };
  const bids=levels(value.bids,'bids'),asks=levels(value.asks,'asks');
  if(bids[0].price>=asks[0].price)throw Error('盘口交叉，不能作为可用报价');
  return {bids,asks,capturedAt:new Date(at).toISOString(),source};
}

/** Read-only step-through replay across all markets; execution is always a local quote check. */
export class MarketReplayStore {
 constructor(private state:State,private deps:Dependencies,private now=Date.now){}
 private index(){if(!this.state.health.ok)throw Error('回放状态库不可用');const rows=this.state.get<string[]>('market-replay:index:v1')||[];if(!Array.isArray(rows)||rows.length>100||rows.some(id=>!/^replay_[a-f0-9]{64}$/.test(id)))throw Error('回放目录不可核验');return rows;}
 private read(id:string):Row {
  this.index();
  if(!/^replay_[a-f0-9]{64}$/.test(id))throw Error('回放ID无效');
  const row=this.state.get<Row>('market-replay:'+id);
  if(!row||row.id!==id||digest(row.manifest)!==row.manifestHash||digest(row.frames)!==row.manifest.framesHash||digest(row.decisions)!==row.manifest.decisionsHash||!Array.isArray(row.executions)||!Number.isSafeInteger(row.cursor)||row.cursor<0||row.cursor>=row.frames.length||!markets.includes(row.manifest.market))throw Error('回放清单、帧或决策Hash不可核验');
  if(row.frames.some((frame,index)=>!markets.includes(row.manifest.market)||!Number.isFinite(timestamp(frame.observedAt))||!Number.isFinite(timestamp(frame.publishedAt))||timestamp(frame.publishedAt)>timestamp(row.manifest.asOf)||timestamp(frame.observedAt)>timestamp(row.manifest.asOf)||!frame.source||!/^[a-f0-9]{64}$/.test(frame.contentHash)||contentHash({...frame,contentHash:undefined})!==frame.contentHash||index>0&&timestamp(frame.observedAt)<timestamp(row.frames[index-1].observedAt)))throw Error('回放帧身份、时间、顺序或内容Hash不可核验');
  if(row.decisions.some(decision=>!['manual','rule','saved-ai'].includes(decision.source)||!['up','down','flat','yes','no','hold'].includes(decision.direction)||timestamp(decision.availableAt)>timestamp(row.manifest.asOf)||decision.contentHash!==digest({...decision,contentHash:undefined})))throw Error('回放决策来源、时间或Hash不可核验');
  for(const execution of row.executions){const {hash,...payload}=execution;if(hash!==digest(payload)||!row.frames.some(frame=>frame.id===execution.frameId))throw Error('回放执行评估Hash不可核验');}
  return structuredClone(row);
 }
 private save(row:Row,action:string){row.revision++;row.updatedAt=this.now();this.state.set('market-replay:'+row.id,row);this.state.appendAudit({id:randomUUID(),at:new Date(this.now()).toISOString(),action:'market-replay-'+action,detail:JSON.stringify({id:row.id,market:row.manifest.market,revision:row.revision,manifestHash:row.manifestHash,cursor:row.cursor})});return this.view(row.id);}
 private writable(id:string,revision:number){const row=this.read(id);if(row.revision!==revision)throw Error('回放版本已变化，请重新读取');if(row.status!=='active')throw Error('回放当前不可逐步推进');return row;}
 private frozenDecision(input:NonNullable<MarketReplayInput['decisions']>[number],market:MarketId,instrument:string,asOf:number):ReplayDecision{
  if(!input||!['manual','rule','saved-ai'].includes(input.source)||!['up','down','flat','yes','no','hold'].includes(input.direction))throw Error('回放决策来源或方向无效');
  let availableAt=timestamp(input.availableAt);if(!Number.isFinite(availableAt)||availableAt>asOf)throw Error('回放决策来自未来');
  let evidenceRefs=[...new Set(input.evidenceRefs||[])],direction=input.direction,thesis=input.thesis,invalidation=input.invalidation;
  if(evidenceRefs.length<1||evidenceRefs.length>20||evidenceRefs.some(id=>typeof id!=='string'||!id))throw Error('决策至少需要一份证据引用，且不能超过20项');
  let referenceId:string|null=input.referenceId?.trim()||null;
  if(input.source==='saved-ai'){
    if(!referenceId||!this.deps.decision)throw Error('已保存 AI 决策需要服务端可核验引用');
    const saved=this.deps.decision(referenceId);
    if(!saved||saved.market!==market||saved.instrument!==instrument||timestamp(saved.createdAt)>asOf||timestamp(saved.createdAt)!==availableAt)throw Error('已保存 AI 决策引用、市场、身份或时点不一致');
    direction=market==='prediction'?saved.direction==='long'?'yes':saved.direction==='short'?'no':'hold':saved.direction==='long'?'up':saved.direction==='short'?'down':'flat';
    thesis=saved.thesis;invalidation=`${saved.invalidation.field} ${saved.invalidation.operator} ${saved.invalidation.value}`;evidenceRefs=[...new Set(saved.evidenceIds)];
  }else if(referenceId&&!/^[A-Za-z0-9:._-]{1,200}$/.test(referenceId))throw Error('决策引用格式无效');
  if(evidenceRefs.length<1||evidenceRefs.length>20||evidenceRefs.some(id=>typeof id!=='string'||!id))throw Error('决策至少需要一份证据引用，且不能超过20项');
  for(const id of evidenceRefs){const evidence=this.deps.evidence(id);if(!evidence||evidence.market!==market||evidence.instrument!==instrument||timestamp(evidence.fetchedAt)>availableAt)throw Error('决策引用的证据市场、身份或时点不可核验');}
  const payload={
    id:'replay_decision_'+randomUUID(),source:input.source,referenceId,
    direction,thesis:cleanText(thesis,'决策假设'),invalidation:cleanText(invalidation,'失效条件'),
    evidenceRefs,availableAt:new Date(availableAt).toISOString(),
  };
  return {...payload,contentHash:digest(payload)};
 }
 private evidenceFrame(evidence:EvidenceSnapshot):ReplayFrame{
  const base={id:evidence.id,kind:'evidence' as const,observedAt:evidence.observedAt,publishedAt:evidence.observedAt,source:evidence.source.name,
    fields:{...evidence.fields,dataStatus:evidence.dataStatus,fetchedAt:evidence.fetchedAt,evidenceHash:evidence.hash,quality:evidence.quality},
    ...(evidence.fields.orderBook?{orderBook:normalizeBook(evidence.fields.orderBook,evidence.fetchedAt)}:{})};
  return {...base,contentHash:contentHash(base)};
 }
 list(market:string){
  if(!markets.includes(market as MarketId))throw Error('市场无效');
  return this.index().map(id=>this.read(id)).filter(row=>row.manifest.market===market).map(row=>({id:row.id,market:row.manifest.market,instrument:row.manifest.instrument,status:row.status,revision:row.revision,cursor:row.cursor,totalFrames:row.frames.length,manifestHash:row.manifestHash,updatedAt:row.updatedAt}));
 }
 view(id:string){
  const row=this.read(id),visible=row.confirmedAt===undefined?[]:row.frames.slice(0,row.cursor+1),current=visible.at(-1)||null;
  const visibleDecisionIds=new Set(visible.map(frame=>frame.id));
  const decisions=row.decisions.filter(decision=>row.confirmedAt!==undefined&&timestamp(decision.availableAt)<=timestamp(current?.observedAt||0)&&decision.evidenceRefs.every(ref=>visibleDecisionIds.has(ref)));
  return {id:row.id,market:row.manifest.market,instrument:row.manifest.instrument,asOf:row.manifest.asOf,availability:row.manifest.availability,source:row.manifest.source,
    manifestHash:row.manifestHash,status:row.status,revision:row.revision,cursor:row.cursor,totalFrames:row.frames.length,frames:visible,current,
    decisions:row.confirmedAt===undefined?[]:decisions,decisionsBySource:{manual:decisions.filter(d=>d.source==='manual'),rule:decisions.filter(d=>d.source==='rule'),'saved-ai':decisions.filter(d=>d.source==='saved-ai')},
    executionChecks:row.confirmedAt===undefined?[]:row.executions.filter(item=>visible.some(frame=>frame.id===item.frameId)),
    executionEnabled:false,ordersCreated:0,modelCalls:0,
    reason:row.confirmedAt===undefined?'仅冻结已有快照与明确决策，尚未开始揭示':current?.orderBook?'当前帧含可核验盘口，但仍只做本地理论成交检查，不创建订单':'当前帧缺少有效盘口；任何成交推断均被拒绝'};
 }
 reference(id:string){const row=this.read(id);return {market:row.manifest.market,instrument:row.manifest.instrument,hash:digest({manifestHash:row.manifestHash,status:row.status,cursor:row.cursor,revision:row.revision}),updatedAt:new Date(row.updatedAt).toISOString(),status:row.status,progress:(row.cursor+1)/row.frames.length*100};}
 async preview(input:MarketReplayInput){
  if(!input||!markets.includes(input.market)||Object.keys(input).some(key=>!['market','instrument','asOf','requestId','evidenceRefs','decisions'].includes(key)))throw Error('回放市场或字段无效，不接受客户端行情结果或执行参数');
  const asOf=timestamp(input.asOf),ref=this.deps.resolve(input.market,input.instrument);
  if(!ref||ref.id!==input.instrument||!Number.isFinite(asOf)||asOf>this.now()||!/^[a-f0-9-]{36}$/.test(input.requestId))throw Error('回放身份、时点或请求ID无效');
  const id='replay_'+digest(input.requestId),requestHash=digest(input),old=this.state.get<Row>('market-replay:'+id);
  if(old){if(old.requestHash!==requestHash)throw Error('请求ID已绑定另一回放');return this.view(id);}
  if(this.index().length>=100)throw Error('回放目录已达100项，旧记录保留');
  const evidenceRefs=[...new Set(input.evidenceRefs||[])];
  if(evidenceRefs.length>200)throw Error('回放证据最多200项');
  const decisions=(input.decisions||[]).map(row=>this.frozenDecision(row,input.market,input.instrument,asOf));
  let frames:ReplayFrame[]=[];
  if(input.market==='stocks'||input.market==='crypto'){
    if(!this.deps.loadBars)throw Error('价格市场回放加载器不可用');
    const bars=await this.deps.loadBars({market:input.market,instrument:input.instrument,asOf:input.asOf,availability:'observed'});
    if(bars.dataStatus!=='historical'||!bars.snapshot||!/^[a-f0-9]{64}$/.test(bars.snapshot.contentHash)||!bars.rows.length)throw Error('价格市场需要可核验的 observed 固定快照');
    frames=bars.rows.filter(row=>timestamp(row.timestamp)<=asOf&&Number.isFinite(timestamp(row.availabilityObservedAt))&&timestamp(row.availabilityObservedAt)<=asOf).slice(0,200).map((bar,index)=>{
      const fields=JSON.parse(JSON.stringify(bar)) as Record<string,unknown>,observedAt=timestamp(fields.availabilityObservedAt),base={id:String(bars.snapshot!.id)+':'+String(fields.timestamp)+':'+index,kind:'bar' as const,observedAt:new Date(observedAt).toISOString(),publishedAt:new Date(timestamp(fields.published_at)).toISOString(),source:String(fields.source||bars.source||'')||'unknown',fields};
      return {...base,contentHash:contentHash(base)};
    });
    const evidenceFrames=evidenceRefs.map(refId=>{const evidence=this.deps.evidence(refId);if(!evidence||evidence.market!==input.market||evidence.instrument!==input.instrument||timestamp(evidence.fetchedAt)>asOf||timestamp(evidence.observedAt)>asOf)throw Error('回放证据不存在、市场/标的或时点不一致');return this.evidenceFrame(evidence);});
    frames=[...frames,...evidenceFrames].sort((a,b)=>timestamp(a.observedAt)-timestamp(b.observedAt)||a.id.localeCompare(b.id));
  }else{
    if(evidenceRefs.length<2)throw Error('期权与预测市场需要至少2份明确固定证据快照');
    frames=evidenceRefs.map(refId=>{const evidence=this.deps.evidence(refId);if(!evidence||evidence.market!==input.market||evidence.instrument!==input.instrument||timestamp(evidence.fetchedAt)>asOf)throw Error('回放证据不存在、市场/标的或时点不一致');return this.evidenceFrame(evidence);}).sort((a,b)=>timestamp(a.observedAt)-timestamp(b.observedAt)||a.id.localeCompare(b.id));
    if(new Set(frames.map(frame=>frame.id)).size!==frames.length)throw Error('回放证据引用重复');
  }
  if(frames.length<2||frames.length>200)throw Error('回放需要2–200个按时间排列的固定帧');
  if(frames.some((frame,index)=>index>0&&timestamp(frame.observedAt)<timestamp(frames[index-1].observedAt)))throw Error('回放帧顺序不一致');
  if(decisions.some(decision=>decision.evidenceRefs.some(refId=>!frames.some(frame=>frame.id===refId))))throw Error('决策引用了不属于本次回放的证据');
  const sources=[...new Set(frames.map(frame=>frame.source))];
  const manifest:Manifest={market:input.market,instrument:input.instrument,asOf:new Date(asOf).toISOString(),availability:input.market==='stocks'||input.market==='crypto'?'observed':'published',source:sources.join(' / '),frameRefs:frames.map(frame=>frame.id),framesHash:digest(frames),decisionsHash:digest(decisions),model:'evidence-only-replay-v1',createdAt:this.now()};
  return this.state.transaction(()=>{
    const duplicate=this.state.get<Row>('market-replay:'+id);if(duplicate){if(duplicate.requestHash!==requestHash)throw Error('请求ID已绑定另一回放');return this.view(id);}
    const row:Row={id,requestHash,manifest,manifestHash:digest(manifest),frames,decisions,cursor:0,revision:0,status:'preview',executions:[],updatedAt:this.now()};
    this.state.set('market-replay:index:v1',[...this.index(),id]);
    return this.save(row,'preview');
  });
 }
 confirm(id:string,revision:number,hash:string,ack:boolean){return this.state.transaction(()=>{const row=this.read(id);if(row.status!=='preview'||row.revision!==revision||row.manifestHash!==hash||ack!==true)throw Error('需要有效预览版本及明确确认');row.status='active';row.confirmedAt=this.now();return this.save(row,'confirm');});}
 advance(id:string,revision:number){return this.state.transaction(()=>{const row=this.writable(id,revision);if(row.cursor>=row.frames.length-1)throw Error('已揭示全部回放帧');row.cursor++;if(row.cursor===row.frames.length-1)row.status='completed';return this.save(row,'advance');});}
 control(id:string,revision:number,action:string){return this.state.transaction(()=>{const row=this.read(id);if(row.revision!==revision||!['pause','resume','stop'].includes(action)||action==='pause'&&row.status!=='active'||action==='resume'&&row.status!=='paused'||action==='stop'&&!['preview','active','paused'].includes(row.status))throw Error('回放版本或状态不允许操作');row.status=action==='pause'?'paused':action==='resume'?'active':'stopped';return this.save(row,action);});}
 executionCheck(id:string,revision:number,input:{frameId:string;side:string;quantity:number;limitPrice?:number}){
  return this.state.transaction(()=>{
    const row=this.read(id);if(row.revision!==revision||row.status!=='active')throw Error('回放版本或状态不允许成交检查');
    if(!input||Object.keys(input).some(key=>!['frameId','side','quantity','limitPrice'].includes(key))||!['buy','sell'].includes(input.side)||!Number.isSafeInteger(input.quantity)||input.quantity<1||input.quantity>1_000_000||input.limitPrice!==undefined&&(!Number.isFinite(input.limitPrice)||input.limitPrice<=0))throw Error('成交检查参数无效');
    const frame=row.frames.slice(0,row.cursor+1).find(item=>item.id===input.frameId);if(!frame)throw Error('成交检查帧尚未揭示或不存在');
    let status:StoredExecutionEvaluation['status']='unavailable',reason='当前帧没有可核验盘口，拒绝推演成交',referencePrice:number|null=null;
    if(frame.orderBook){const levels=input.side==='buy'?frame.orderBook.asks:frame.orderBook.bids,crossed=levels.find(level=>input.limitPrice===undefined||(input.side==='buy'?level.price<=input.limitPrice!:level.price>=input.limitPrice!));
      if(!crossed){status='rejected';reason=input.side==='buy'?'限价低于当前卖一，未模拟成交':'限价高于当前买一，未模拟成交';referencePrice=levels[0]?.price??null;}
      else if(crossed.quantity<input.quantity){status='rejected';reason='当前盘口可见数量不足，未按隐藏深度假设成交';referencePrice=crossed.price;}
      else {status='filled-model';reason='仅命中当前冻结盘口可见数量；这是本地理论检查，不创建订单或持仓';referencePrice=crossed.price;}
    }
    const payload={id:'replay_execution_'+randomUUID(),frameId:frame.id,side:input.side as 'buy'|'sell',quantity:input.quantity,limitPrice:input.limitPrice??null,status,reason,referencePrice,at:this.now()};
    row.executions.push({...payload,hash:digest(payload)});return this.save(row,'execution-check');
  });
 }
}

export {MarketReplayStore as ReplayStore};
