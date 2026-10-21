import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'health'|'appendAudit'>;
type Market='stocks'|'crypto';
type Input={market:string;instrument:string;timeframe:string;asOf:string;from:string;count:number;requestId:string};
type Dependencies={resolve:(market:string,instrument:string)=>{id:string;symbol:string}|null;load:(scope:{market:Market;instrument:string;timeframe:string;asOf:string})=>Promise<{dataStatus:string;source:string|null;reason?:string;snapshot?:{id:string;contentHash:string};rows:Array<Record<string,any>>}>};
type Bar={time:number;open:number;high:number;low:number;close:number;volume:number;publishedAt:number};
type Judgment={id:string;cursor:number;direction:'up'|'down'|'flat';hypothesis:string;invalidation:string;at:number;knowledgeAt:number;barHash:string;previousHash:string;hash:string};
type Correction={decisionId:string;note:string;at:number;previousHash:string;hash:string};
type Row={id:string;requestHash:string;manifest:{market:Market;instrument:string;timeframe:string;interval:number;source:string;snapshotId:string;snapshotHash:string;barsHash:string;createdAt:number};manifestHash:string;bars:Bar[];cursor:number;revision:number;status:'preview'|'active'|'completed'|'stopped';confirmedAt?:number;decisions:Judgment[];corrections:Correction[];updatedAt:number};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const intervals:Record<string,number>={'5m':300000,'15m':900000,'1h':3600000,'1d':86400000};
const timestamp=(v:unknown)=>v instanceof Date?v.getTime():Date.parse(String(v));
/** Private training metadata over frozen archived bars. Never calls an execution or model service. */
export class BlindSessionStore {
 constructor(private state:State,private deps:Dependencies,private now=Date.now){}
 private healthy(){if(!this.state.health.ok)throw Error('盲测状态库不可用');}
 private index(){this.healthy();const ids=this.state.get<string[]>('blind-session:index')||[];if(!Array.isArray(ids)||ids.length>50)throw Error('盲测目录不可核验');return ids;}
 private read(id:string):Row {
  this.healthy();if(!/^blind_[a-f0-9]{64}$/.test(id))throw Error('盲测ID无效');const r=this.state.get<Row>('blind-session:'+id);
  if(!r||r.id!==id||digest(r.manifest)!==r.manifestHash||digest(r.bars)!==r.manifest.barsHash||!Array.isArray(r.decisions)||!Array.isArray(r.corrections)||!Number.isSafeInteger(r.cursor)||r.cursor<19||r.cursor>=r.bars.length)throw Error('盲测清单、数据Hash或进度不可核验');
  let previous=r.manifestHash;const indexes=new Set<number>();for(const d of r.decisions){const {hash,...payload}=d;if(hash!==digest(payload)||d.previousHash!==previous||indexes.has(d.cursor)||d.cursor>r.cursor||d.cursor<19||d.barHash!==digest(r.bars[d.cursor])||d.knowledgeAt!==r.bars[d.cursor].time+r.manifest.interval)throw Error('判断记录Hash或时间边界不可核验');indexes.add(d.cursor);previous=hash;}
  if(r.decisions.some((d,i)=>d.cursor!==19+i)||r.decisions.length<r.cursor-19||r.confirmedAt===undefined&&(r.cursor!==19||r.decisions.length>0)||r.status==='completed'&&r.cursor!==r.bars.length-1)throw Error('盲测进度与逐次判断记录不一致，不能跳过揭示');
  previous=r.manifestHash;for(const c of r.corrections){const {hash,...payload}=c;if(hash!==digest(payload)||c.previousHash!==previous||!r.decisions.some(d=>d.id===c.decisionId))throw Error('修正记录Hash不可核验');previous=hash;}
  return structuredClone(r);
 }
 private save(r:Row,action:string){r.revision++;r.updatedAt=this.now();this.state.set('blind-session:'+r.id,r);this.state.appendAudit({id:randomUUID(),at:new Date(this.now()).toISOString(),action:'blind-session-'+action,detail:JSON.stringify({id:r.id,market:r.manifest.market,revision:r.revision,manifestHash:r.manifestHash})});return this.view(r.id);}
 private writable(id:string,revision:number){const r=this.read(id);if(r.revision!==revision)throw Error('盲测版本已变化，请重新读取');if(r.status!=='active')throw Error('盲测状态不是进行中或已停止');return r;}
 view(id:string){const r=this.read(id),shown=r.confirmedAt===undefined?[]:r.bars.slice(0,r.cursor+1),last=shown.at(-1),assessments=r.decisions.filter(d=>d.cursor<r.cursor&&r.confirmedAt!==undefined).map(d=>{const before=r.bars[d.cursor].close,after=r.bars[d.cursor+1].close,actual=after>before?'up':after<before?'down':'flat';return {decisionId:d.id,horizonBars:1,mature:true,returnPct:(after/before-1)*100,directionCorrect:actual===d.direction,reason:'仅下一根已揭示收线方向；不是成交收益，不评判文字失效条件是否遵守'};});
  return {id:r.id,market:r.manifest.market,instrument:r.manifest.instrument,timeframe:r.manifest.timeframe,source:r.manifest.source,snapshotId:r.manifest.snapshotId,manifestHash:r.manifestHash,snapshotHash:r.manifest.snapshotHash,status:r.status,revision:r.revision,bars:shown,remaining:r.bars.length-r.cursor-1,totalBars:r.bars.length,knowledgeAt:last?new Date(last.time+r.manifest.interval).toISOString():null,decisions:r.status==='preview'?[]:r.decisions,corrections:r.status==='preview'?[]:r.corrections,assessments,updatedAt:r.updatedAt,executionEnabled:false,ranking:null,events:{available:false,reason:'本切片只揭示已核验发布时间的K线，未接入事件/新闻；不假装已还原完整信息环境'},reason:r.status==='preview'?'仅冻结已有归档，确认后揭示最初20根；不会采集或下单':'每次先提交判断再揭示一根；训练不是访问控制，管理员仍能另行查看原历史。少于20个成熟判断不排名。'};
 }
 list(market:string){if(!['stocks','crypto','options','prediction'].includes(market))throw Error('市场无效');return this.index().map(id=>this.view(id)).filter(r=>r.market===market).map(({bars,decisions,corrections,assessments,...summary})=>summary);}
 async preview(input:Input){
  this.healthy();const {market,instrument,timeframe,asOf,from,count,requestId}=input||{},interval=intervals[timeframe],cut=timestamp(asOf),start=timestamp(from),ref=this.deps.resolve(market,instrument);
  if(!['stocks','crypto'].includes(market))throw Error('当前市场盲测仅支持股票/虚拟币价格K线，其他市场缺少已核验模型');
  if(!ref||!interval||!Number.isFinite(cut)||cut>this.now()||!Number.isFinite(start)||start>=cut||!Number.isSafeInteger(count)||count<21||count>200||!/^[a-f0-9-]{36}$/.test(requestId))throw Error('身份、周期、历史时点或范围无效，不读取未来数据');
  const id='blind_'+digest(requestId),requestHash=digest({market,instrument:ref.id,timeframe,asOf,from,count}),old=this.state.get<Row>('blind-session:'+id);if(old){if(old.requestHash!==requestHash)throw Error('请求ID已绑定另一范围');return this.view(id);}
  if(this.index().length>=50)throw Error('盲测已达50个，未删除旧记录');const history=await this.deps.load({market:market as Market,instrument:ref.id,timeframe,asOf});
  if(history.dataStatus!=='historical'||!history.source||!history.snapshot?.id||!/^[a-f0-9]{64}$/.test(history.snapshot.contentHash))throw Error(history.reason||'归档快照或来源不可核验');
  const selected=history.rows.filter(b=>timestamp(b.timestamp)>=start&&timestamp(b.timestamp)+interval<=cut).sort((a,b)=>timestamp(a.timestamp)-timestamp(b.timestamp)).slice(0,count);
  if(selected.length!==count)throw Error('归档已完成K线覆盖不足；请调整范围或先核验数据资产，不自动回补');
  const bars:Bar[]=selected.map((b,i)=>{const time=timestamp(b.timestamp),publishedAt=timestamp(b.published_at),prices=[b.open,b.high,b.low,b.close];
   if(b.market!==market||b.instrument!==ref.symbol||b.timeframe!==timeframe||b.source!==history.source||b.closed===false||!Number.isFinite(time)||i>0&&time<=timestamp(selected[i-1].timestamp))throw Error('归档市场、标的、来源或时间身份不一致');
   if(i>0&&interval<86400000&&time!==timestamp(selected[i-1].timestamp)+interval)throw Error('日内窗口存在缺口或跨休市区间，请选择连续窗口；不插值补齐');
   if(prices.some(p=>typeof p!=='number'||!Number.isFinite(p)||p<=0)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.high<b.low||typeof b.volume!=='number'||!Number.isFinite(b.volume)||b.volume<0)throw Error('OHLC价格或成交量无效');
   if(!Number.isFinite(publishedAt)||publishedAt>time+interval)throw Error('缺少当时已发布证据或存在事后修订，不能用于盲测');
   return {time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,publishedAt};
  });
  const manifest={market:market as Market,instrument:ref.id,timeframe,interval,source:history.source,snapshotId:history.snapshot.id,snapshotHash:history.snapshot.contentHash,barsHash:digest(bars),createdAt:this.now()};
  return this.state.transaction(()=>{const duplicate=this.state.get<Row>('blind-session:'+id);if(duplicate){if(duplicate.requestHash!==requestHash)throw Error('请求ID已绑定另一范围');return this.view(id);}const ids=this.index();if(ids.length>=50)throw Error('盲测容量已满');const r:Row={id,requestHash,manifest,manifestHash:digest(manifest),bars,cursor:19,revision:0,status:'preview',decisions:[],corrections:[],updatedAt:this.now()};this.state.set('blind-session:index',[...ids,id]);return this.save(r,'preview');});
 }
 confirm(id:string,revision:number,hash:string,ack:boolean){return this.state.transaction(()=>{const r=this.read(id);if(r.status!=='preview'||r.revision!==revision||hash!==r.manifestHash||ack!==true)throw Error('需要有效预览版本及明确确认');r.status='active';r.confirmedAt=this.now();return this.save(r,'confirm');});}
 judge(id:string,revision:number,input:{direction:string;hypothesis:string;invalidation:string}){return this.state.transaction(()=>{const r=this.writable(id,revision);if(r.decisions.some(d=>d.cursor===r.cursor))throw Error('当前判断已提交，不可重复改写；使用追加修正');if(!input||Object.keys(input).some(k=>!['direction','hypothesis','invalidation'].includes(k))||!['up','down','flat'].includes(input.direction)||[input.hypothesis,input.invalidation].some(s=>typeof s!=='string'||!s.trim()||s.length>2000))throw Error('需要方向、假设及失效条件，不接收行情或结果');const payload={id:randomUUID(),cursor:r.cursor,direction:input.direction as Judgment['direction'],hypothesis:input.hypothesis.trim(),invalidation:input.invalidation.trim(),at:this.now(),knowledgeAt:r.bars[r.cursor].time+r.manifest.interval,barHash:digest(r.bars[r.cursor]),previousHash:r.decisions.at(-1)?.hash||r.manifestHash};r.decisions.push({...payload,hash:digest(payload)});return this.save(r,'judge');});}
 correct(id:string,revision:number,decisionId:string,note:string){return this.state.transaction(()=>{const r=this.writable(id,revision);if(!r.decisions.some(d=>d.id===decisionId)||typeof note!=='string'||!note.trim()||note.length>2000||r.corrections.length>=400)throw Error('修正引用或内容无效，不能替换原判断');const payload={decisionId,note:note.trim(),at:this.now(),previousHash:r.corrections.at(-1)?.hash||r.manifestHash};r.corrections.push({...payload,hash:digest(payload)});return this.save(r,'correct');});}
 advance(id:string,revision:number){return this.state.transaction(()=>{const r=this.writable(id,revision);if(!r.decisions.some(d=>d.cursor===r.cursor))throw Error('先提交当前判断，之后才能揭示下一根');if(r.cursor>=r.bars.length-1)throw Error('已揭示全部窗口');r.cursor++;if(r.cursor===r.bars.length-1)r.status='completed';return this.save(r,'advance');});}
 stop(id:string,revision:number){return this.state.transaction(()=>{const r=this.read(id);if(r.revision!==revision||!['preview','active'].includes(r.status))throw Error('盲测版本或状态不允许停止');r.status='stopped';return this.save(r,'stop');});}
}
