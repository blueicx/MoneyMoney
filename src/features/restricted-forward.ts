import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import type {SignalOutcome} from './decision-intelligence';
import {restrictedStrategy} from './strategy-definitions';
import {observeForwardSignal} from './signal-forward';
import {buildRestrictedReadiness} from './restricted-readiness';
import type {PointInTimeSnapshot,DatasetPartition,DataRevision} from '../storage/data-lake';
type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'|'acquireLease'|'getLease'|'releaseLease'>;
type History={dataStatus:string;source:string|null;updatedAt:string|null;reason?:string;snapshot?:{id:string;contentHash:string};rows:Array<Record<string,any>>};
type Dependencies={definition:(id:string,hash:string)=>any;experiment:(id:string)=>any;resolve:(market:string,instrument:string)=>{id:string;symbol:string}|null;signals:{get:(id:string)=>SignalOutcome|null;list:()=>SignalOutcome[];save:(s:SignalOutcome)=>unknown};catalog?:{snapshot:(id:string)=>PointInTimeSnapshot|null;partitions:()=>DatasetPartition[];revisions:()=>DataRevision[]}};
interface Session {id:string;mode:'observation-only';market:'stocks';instrument:string;strategyId:string;strategyHash:string;timeframe:string;experimentId:string;source:string;startedAt:number;observingSince:number;status:'active'|'paused'|'stopped';revision:number;signalIds:string[];captures:Array<{id:string;at:number;snapshotId:string|null;dataHash:string|null;reason:string}>;reason:string;dataStatus:string;lastBarTime:number|null;lease?:{owner:string;expiresAt:number};updatedAt:number}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const timestamp=(v:unknown)=>v instanceof Date?v.getTime():Date.parse(String(v));
export class RestrictedForwardStore {
 constructor(private state:State,private deps:Dependencies,private now=Date.now){}
 private index(){const rows=this.state.get<string[]>('restricted-forward:index')||[];if(!this.state.health.ok||!Array.isArray(rows)||rows.length>50)throw Error('前向观察目录不可核验');return rows;}
 read(id:string,market='stocks'):Session {if(!/^forward_[a-f0-9]{64}$/.test(id))throw Error('前向观察ID无效');const row=this.state.get<Session>('restricted-forward:'+id);if(!this.state.health.ok||!row||row.id!==id||row.market!==market||row.mode!=='observation-only'||!Array.isArray(row.signalIds)||!Array.isArray(row.captures))throw Error('前向观察不存在、损坏或市场不匹配');return structuredClone(row);}
 list(market:string){if(!['stocks','crypto','options','prediction'].includes(market))throw Error('市场无效');return this.index().map(id=>this.read(id)).filter(row=>row.market===market);}
 private linkedSignal(row:Session,key:string){const signal=this.deps.signals.get(key);if(!signal||signal.id!==key||signal.market!=='stocks'||signal.instrument!==row.instrument||signal.strategyVersion!==row.strategyHash||signal.strategyId!==row.strategyId||signal.experimentId!==row.experimentId||signal.timeframe!==row.timeframe||signal.source!==row.source||signal.triggeredAt<row.startedAt||signal.triggeredAt>this.now()||(signal as any).forwardObservation?.sessionId!==row.id)throw Error('已有信号血缘不一致，不猜测配对或更新');return signal;}
 signals(id:string){const row=this.read(id);return row.signalIds.map(key=>this.linkedSignal(row,key));}
 readiness(id:string){const session=this.read(id),catalog=this.deps.catalog;if(!catalog)throw Error('目录核验服务未配置');const experiment=this.deps.experiment(session.experimentId);return buildRestrictedReadiness({session,identity:this.deps.resolve(session.market,session.instrument),version:this.deps.definition(session.strategyId,session.strategyHash),experiment,snapshot:experiment?.evidenceRefs?.length===1?catalog.snapshot(experiment.evidenceRefs[0]):null,partitions:catalog.partitions(),revisions:catalog.revisions(),signals:this.signals(id)},this.now());}
 start(strategyId:string,input:{market:string;instrument:string;hash:string;experimentId:string;requestId:string}){
  if(input.market!=='stocks'||!/^[a-f0-9]{64}$/.test(input.hash)||!/^[a-f0-9-]{36}$/.test(input.requestId))throw Error('仅支持明确股票版本及有效请求ID的手动前向观察');
  const version=this.deps.definition(strategyId,input.hash),e=this.deps.experiment(input.experimentId),ref=this.deps.resolve(input.market,input.instrument);
  if(!ref||ref.id!==input.instrument||version.market!==input.market)throw Error('标的或策略市场身份尚未核验');
  if(e?.executionModel!=='restricted-next-open-v1'||e.experiment?.market!==input.market||e.experiment?.instrument!==input.instrument||e.experiment?.strategyId!==strategyId||e.experiment?.strategyVersion!==input.hash||e.experiment?.timeframe!==version.definition.timeframe||!e.experiment.dataSource||!/^[a-f0-9]{64}$/.test(e.experiment.dataSnapshotHash))throw Error('需要同一已保存版本、标的和周期的历史实验引用');
  return this.state.transaction(()=>{const id='forward_'+hash(input.requestId),old=this.state.get<Session>('restricted-forward:'+id);if(old){if(old.strategyId!==strategyId||old.strategyHash!==input.hash||old.instrument!==input.instrument||old.experimentId!==input.experimentId)throw Error('请求ID已绑定其他观察配置');return this.read(id);}
   const index=this.index();if(index.length>=50)throw Error('已达50个观察上限，保留已有历史');const at=this.now();const row:Session={id,mode:'observation-only',market:'stocks',instrument:input.instrument,strategyId,strategyHash:input.hash,timeframe:version.definition.timeframe,experimentId:input.experimentId,source:e.experiment.dataSource,startedAt:at,observingSince:at,status:'active',revision:1,signalIds:[],captures:[],reason:'等待启动后完成的K线；点击才读取已有归档，不自动采集或下单',dataStatus:'empty',lastBarTime:null,updatedAt:at};this.state.set('restricted-forward:'+id,row);this.state.set('restricted-forward:index',[...index,id]);this.audit(row,'start');return structuredClone(row);
  });
 }
 control(id:string,revision:number,action:string){return this.state.transaction(()=>{const row=this.read(id);if(row.revision!==revision)throw Error('观察版本已变化，请重新读取');if(!['pause','resume','stop'].includes(action)||row.status==='stopped'||action==='pause'&&row.status!=='active'||action==='resume'&&row.status!=='paused')throw Error('观察状态不允许此操作');row.status=action==='pause'?'paused':action==='resume'?'active':'stopped';if(action==='resume')row.observingSince=this.now();row.revision++;row.updatedAt=this.now();row.reason=action==='resume'?'等待恢复后新完成的K线，不补记暂停期信号':action==='pause'?'已暂停手动观察，保留已有信号':'已停止观察，历史保留且不能恢复';this.state.set('restricted-forward:'+id,row);this.audit(row,action);return row;});}
 private audit(row:Session,action:string){this.state.appendAudit({id:randomUUID(),action:'restricted-forward-'+action,at:new Date(this.now()).toISOString(),detail:JSON.stringify({id:row.id,market:row.market,revision:row.revision,strategyHash:row.strategyHash})});}
 async capture(id:string,revision:number,load:(scope:{market:'stocks';instrument:string;timeframe:string;asOf:string})=>Promise<History>):Promise<Session>{
  const leaseKey='research:restricted-forward-capture',owner=randomUUID(),claim=this.state.transaction(()=>{const row=this.read(id);if(row.revision!==revision||row.status!=='active')throw Error('观察版本已变化或已暂停');if(!this.state.acquireLease(leaseKey,owner,this.now(),90000))throw Error('另一次观察正在读取归档，请稍后重试');row.lease={owner,expiresAt:this.now()+90000};row.revision++;this.state.set('restricted-forward:'+id,row);return row;});
  let history:History|undefined,failure:string|undefined;try{history=await load({market:'stocks',instrument:claim.instrument,timeframe:claim.timeframe,asOf:new Date(this.now()).toISOString()});}catch(e){failure=e instanceof Error?e.message:'归档请求失败';}
  const result=this.state.transaction(()=>{const row=this.read(id),lease=this.state.getLease(leaseKey,this.now());
   const valid=row.status==='active'&&row.revision===claim.revision&&row.lease?.owner===owner&&lease?.owner===owner&&!lease.expired;
   const ownRowLease=row.lease?.owner===owner;this.state.releaseLease(leaseKey,owner);if(ownRowLease)delete row.lease;
   if(!valid){if(ownRowLease)this.state.set('restricted-forward:'+id,row);return {error:'观察已暂停、状态变化或租约失效，迟到结果未写入'};}
   let reason=failure||history?.reason||'',status=history?.dataStatus||'failed';const snapshot=history?.snapshot,checkpoint=row.lastBarTime,pendingSignals:SignalOutcome[]=[];
   try{
    if(failure)throw Error(failure);if(history?.dataStatus!=='historical'||!snapshot||!/^[a-f0-9]{64}$/.test(snapshot.contentHash))throw Error(reason||'缺少可核验的归档快照');
    if(history.source!==row.source)throw Error('来源与冻结实验不同，不跨来源补位');
    const at=timestamp(history.updatedAt);if(!Number.isFinite(at)||at>this.now()||this.now()-at>90000)throw Error('归档来源过期或发布时间未知，不确认新前向点位');
    const ref=this.deps.resolve('stocks',row.instrument),version=this.deps.definition(row.strategyId,row.strategyHash),interval=restrictedStrategy.capabilities.intervals[row.timeframe];
    if(!ref||ref.id!==row.instrument||history.rows.some(b=>b.market!=='stocks'||b.instrument!==ref.symbol||b.timeframe!==row.timeframe||b.source!==row.source||!Number.isFinite(timestamp(b.published_at))||timestamp(b.published_at)>this.now()))throw Error('归档市场、来源、发布时间或标的身份不一致');
    const bars=history.rows.map(b=>({time:timestamp(b.timestamp),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,closed:b.closed})),evaluated=restrictedStrategy.evaluate(version.definition,bars,this.now()),completed=bars.filter(b=>b.closed!==false&&b.time+interval<=this.now()),last=completed.at(-1);
    if(row.signalIds.length>=1000||row.captures.length>=200)throw Error('观察已达保留容量上限，请停止；旧记录未删除');
    for(const key of row.signalIds){const signal=this.linkedSignal(row,key);
     const forward=observeForwardSignal(signal,completed,this.now()),horizons:Record<string,any>={},previous=(signal as any).forwardObservation;let gap=false;
     forward.points.slice(0,20).forEach((p,i,points)=>{const expected=i?Date.parse(points[i-1].at)+interval:(Math.floor(signal.triggeredAt/interval)+2)*interval;if(interval<86400000&&Date.parse(p.at)!==expected)gap=true;for(const n of [1,3,5,20])if(i===n-1){const part=points.slice(0,n);horizons[n]={mature:!gap,returnPct:gap?null:p.returnPct,mfePct:gap?null:(Math.max(...part.map(v=>v.high))/signal.entryPrice-1)*100,maePct:gap?null:(Math.min(...part.map(v=>v.low))/signal.entryPrice-1)*100,reason:gap?'观察区间有缺口，未插值':null,snapshotId:snapshot.id,dataHash:snapshot.contentHash,observedAt:this.now()};}});
     for(const n of [1,3,5,20])horizons[n]??={mature:false,returnPct:null,mfePct:null,maePct:null,reason:'后续已完成K线尚不足'};
     for(const n of [1,3,5,20])if(previous?.horizons?.[n]?.mature)horizons[n]=previous.horizons[n];
     const end=completed.find(b=>b.time+interval===Date.parse(forward.points[19]?.at||''));
     pendingSignals.push({...signal,...(signal.exitPrice==null&&horizons[20].mature&&end?{exitPrice:end.close,mfePct:horizons[20].mfePct,maePct:horizons[20].maePct}:{}),dataGap:gap,forwardObservation:{...previous,sessionId:id,executionEnabled:false,horizons,snapshotId:snapshot.id,dataHash:snapshot.contentHash,observedAt:this.now(),reason:'仅标的后续涨跌；到期首次观察固定，不是成交收益，也不模拟做空'}} as SignalOutcome);
    }
    if(!last||last.time+interval<=row.observingSince||last.time<=(row.lastBarTime??-Infinity)){reason='等待启动/恢复后新完成的K线；已观察或错过的历史不补记';}
    else if(this.now()-(last.time+interval)>interval){reason='最新归档K线过期，未补记旧信号';}
    else {row.lastBarTime=last.time;const point=evaluated.points.find((p:any)=>p.time===last.time);reason=point?'最新完成K线满足条件；只保存前向走势观察，不创建订单':evaluated.latest?.reason||'最新完成K线未触发所选版本';
     if(point){if(this.deps.signals.list().length>=5000)throw Error('信号容量已满，未覆盖或删除旧信号');const signalId='rf_signal_'+hash([id,last.time,point.direction]);if(this.deps.signals.get(signalId)&&!row.signalIds.includes(signalId))throw Error('信号ID已存在但未明确关联，不猜测配对');if(!this.deps.signals.get(signalId)){pendingSignals.push({id:signalId,market:'stocks',instrument:row.instrument,strategyId:row.strategyId,strategyVersion:row.strategyHash,experimentId:row.experimentId,timeframe:row.timeframe,source:row.source,triggeredAt:this.now(),entryPrice:point.price,action:point.direction==='sell'?'SELL':'BUY',sample:'live',status:'confirmed',confirmationDelayMs:this.now()-(last.time+interval),statusReason:'手动前向观察确认；参考收盘价，不是成交价或交易指令',evidenceRefs:[snapshot.id],forwardObservation:{sessionId:id,barTime:last.time,executionEnabled:false,horizons:{},observedAt:this.now(),reason:'仅后续标的涨跌'}} as SignalOutcome);}if(!row.signalIds.includes(signalId))row.signalIds.push(signalId);}
    }
    status='historical';
   }catch(e){reason=e instanceof Error?e.message:'观察计算失败';status='unavailable';row.lastBarTime=checkpoint;}
   if(status==='historical')for(const signal of pendingSignals)this.deps.signals.save(signal);
   const receiptId=hash([snapshot?.contentHash||null,row.lastBarTime,status,status==='historical'?null:reason]);if(!row.captures.some(c=>c.id===receiptId)&&row.captures.length<200)row.captures.push({id:receiptId,at:this.now(),snapshotId:snapshot?.id||null,dataHash:snapshot?.contentHash||null,reason});row.reason=reason;row.dataStatus=status;row.revision++;row.updatedAt=this.now();this.state.set('restricted-forward:'+id,row);return {row};
  });if(result.error)throw Error(result.error);return result.row!;
 }
}
