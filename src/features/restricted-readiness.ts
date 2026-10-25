import {createHash} from 'node:crypto';
import type {DatasetPartition,DataRevision,PointInTimeSnapshot} from '../storage/data-lake';
import {buildResearchRevisionImpact} from './research-revision-impact';
import {buildForwardEvidenceTimeline} from './forward-evidence-timeline';
import type { RegisteredWindowProof } from './restricted-validation-proof';

interface Input {session:any;version:any;experiment:any;snapshot:PointInTimeSnapshot|null;partitions:DatasetPartition[];revisions:DataRevision[];signals:any[];identity?:{id:string;symbol:string}|null;execution?:Record<string,any>}
/** Read-only metadata audit. Never publishes candidates or treats observed prices as executed trades. */
export function buildRestrictedReadiness(input:Input,now=Date.now()){
 const {session:s,version:v,experiment:r,snapshot:p,signals}=input,e=r?.experiment;
 if(s.market!=='stocks'||!/^stock:(us|cn):[^:]+$/.test(s.instrument)||!Number.isFinite(now))throw Error('当前证据核验仅支持明确股票观察');
 if(!Array.isArray(s.signalIds)||new Set(s.signalIds).size!==s.signalIds.length||signals.length!==s.signalIds.length||signals.some((signal,i)=>signal.id!==s.signalIds[i]||signal.forwardObservation?.sessionId!==s.id))throw Error('观察信号引用血缘不一致，不猜测关联');
 const checks:Array<{id:string;status:'met'|'blocked'|'unknown';reason:string}>=[];
 const check=(id:string,ok:boolean,reason:string)=>checks.push({id,status:ok?'met':'blocked',reason});
 const versionOk=v?.id===s.strategyId&&v.hash===s.strategyHash&&v.market===s.market&&v.definition?.timeframe===s.timeframe&&/^[a-f0-9]{64}$/.test(s.strategyHash);
 check('version',versionOk,versionOk?'已明确关联已保存的不可变版本及Hash':'策略版本、市场或周期未明确关联');
 const experimentOk=versionOk&&e?.id===s.experimentId&&e.market===s.market&&e.instrument===s.instrument&&e.strategyId===s.strategyId&&e.strategyVersion===s.strategyHash&&e.timeframe===s.timeframe&&e.dataSource===s.source&&r.executionModel==='restricted-next-open-v1'&&Number.isFinite(Date.parse(e.createdAt))&&Date.parse(e.createdAt)<=now;
 check('experiment',experimentOk,experimentOk?'关联既有股票历史实验；不是样本外或实际成交证明':'历史实验身份、版本、周期、来源或创建时间不一致');
 const identity=input.identity,identities=identity&&identity.id===s.instrument?[s.instrument,identity.symbol]:[];
 const ids=typeof p?.partitionId==='string'?p.partitionId.split(','):[],partitions=new Map(input.partitions.map(row=>[row.id,row]));
 const selected=ids.map(id=>partitions.get(id)),cut=Date.parse(p?.asOf||'');
 const snapshotOk=experimentOk&&!!p&&p.id===r.evidenceRefs?.[0]&&r.evidenceRefs.length===1&&p.market===s.market&&identities.includes(p.instrument)&&p.dataset==='bars'&&p.timeframe===s.timeframe&&p.source===s.source&&p.contentHash===e.dataSnapshotHash&&Number.isFinite(cut)&&cut<=now&&Number.isFinite(Date.parse(p.createdAt))&&Date.parse(p.createdAt)<=now&&ids.length>0&&ids.length<=2000&&new Set(ids).size===ids.length&&selected.every(row=>row&&row.market===s.market&&identities.includes(row.instrument)&&row.dataset==='bars'&&row.timeframe===s.timeframe&&row.status==='committed'&&/^[a-f0-9]{64}$/.test(row.contentHash)&&Number.isFinite(Date.parse(row.publishedAt))&&Date.parse(row.publishedAt)<=cut)&&createHash('sha256').update(selected.map(row=>row!.contentHash).join('|')).digest('hex')===p.contentHash;
 check('snapshot',!!snapshotOk,snapshotOk?'快照与目录分区Hash/身份/发布时间匹配；未重读Parquet文件，不等于文件或字段覆盖验收':'缺少快照、分区或Hash/身份/发布时间不一致，不验证数据覆盖');
 let revisions:any[]=[];
 if(snapshotOk){const symbol=selected[0]!.instrument,impact=buildResearchRevisionImpact({market:s.market,instrument:symbol,timeframe:s.timeframe,asOf:new Date(now).toISOString(),partitions:input.partitions.filter(row=>row.market===s.market&&row.instrument===symbol&&row.timeframe===s.timeframe),revisions:input.revisions.filter(row=>row.market===s.market&&row.instrument===symbol&&row.timeframe===s.timeframe),records:[{id:e.id,kind:'experiment',market:s.market,instrument:symbol,timeframe:s.timeframe,createdAt:e.createdAt,partitionRefs:selected.map(row=>({partitionId:row!.id,hash:row!.contentHash}))}]});revisions=impact.rows[0]?.findings||[];checks.push({id:'revision',status:revisions.length?'blocked':'unknown',reason:revisions.length?'明确引用的分区存在后续修订，需人工复核；原实验未改写':'未观察到满足明确引用链的后续修订，不证明数据永远有效'});}else checks.push({id:'revision',status:'unknown',reason:'快照引用尚未核验，不能推断修订状态'});
 const costsOk=experimentOk&&e.feeRate===v.definition.costs.feeBps/10000&&e.slippage===v.definition.costs.slippageBps/10000&&e.parameters?.allocationPct===v.definition.position.maxAllocationPct&&e.parameters?.startingBalance===1000&&[r.backtest?.totalFees,r.backtest?.totalSlippage].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0);
 check('costs',!!costsOk,costsOk?'历史实验声明成本与冻结版本一致；仍为下一根开盘理论模型，非真实点差/撮合证明':'成本或资金比例与冻结版本不一致，或缺少费用/滑点记录');
 let units=0,closed=0;const trades=r?.backtest?.trades,sampleOk=Array.isArray(trades)&&trades.length<=100000&&trades.every((t:any)=>['buy','sell'].includes(t.direction)&&Number.isSafeInteger(t.volume)&&t.volume>0);
 if(sampleOk)for(const trade of trades){units+=trade.direction==='buy'?trade.volume:-trade.volume;if(trade.direction==='sell'&&units===0)closed++;if(units<0)break;}
 check('sample',experimentOk&&sampleOk&&units>=0&&closed===r.quality?.closedTrades&&closed>=20,!experimentOk?'历史实验未明确关联，不采纳该记录的样本':sampleOk&&units>=0&&closed===r.quality?.closedTrades?`历史模型完整平仓 ${closed} 笔；${closed<20?'不足20笔，不提供可靠胜率或排名':'样本门槛不等于统计或样本外验证'}`:'历史模型成交和报告的完整平仓样本不可核验');
 check('oos',false,'此历史实验未实现受控样本外流程；即使记录附带汇总OOS数值也不采信为晋级证据');
 // Input is supplied only by the server's immutable receipt verifier, never by
 // readiness query parameters or client metrics. The original observation stays read-only.
 const x=input.execution,executionOk=x?.model==='bilateral-quote-paper-v1'&&x.observationId===s.id&&x.accountId==='research-forward:'+s.id&&x.market===s.market&&x.instrument===s.instrument&&x.strategyHash===s.strategyHash&&Number.isSafeInteger(x.closedTrades)&&x.closedTrades>=0&&x.closedTrades===x.pairedFills&&Number.isSafeInteger(x.orders)&&x.orders>=2*x.closedTrades&&Array.isArray(x.evidenceRefs)&&x.evidenceRefs.length===x.orders&&new Set(x.evidenceRefs).size===x.orders;
 const forward={signals:signals.length,mature20:signals.filter(signal=>signal.forwardObservation?.horizons?.[20]?.mature===true).length,pairedFills:executionOk?x!.closedTrades:0};
 check('forward',!!executionOk&&forward.pairedFills>=20,executionOk?`同一版本已核验双边报价纸面模型完整平仓 ${forward.pairedFills} 笔；${forward.pairedFills<20?'不足20笔，不排名':'仅为模拟执行证据，不是实盘成交或深度证明'}`:x?.reason?String(x.reason).slice(0,500):`手动走势信号 ${forward.signals} 个，20根成熟 ${forward.mature20} 个；未关联模拟成交，不能当作成交样本或收益排名`);
 checks.push({id:'corporate-actions',status:'unknown',reason:'本成交模型未完成拆股、分红及退市收益归因验收'});
 check('approval',false,'当前观察没有明确关联的人工审批记录；不按版本或时间猜测配对，不修改已有审批或监控状态');
 const pack={schemaVersion:1,market:s.market,instrument:s.instrument,timeframe:s.timeframe,checkedAt:new Date(now).toISOString(),source:s.source,dataStatus:'partial',strategyId:s.strategyId,strategyHash:s.strategyHash,experimentId:s.experimentId,observationId:s.id,snapshot:p?{id:p.id,contentHash:p.contentHash,asOf:p.asOf}:null,evidenceRefs:[...new Set([...(r?.evidenceRefs||[]),...signals.flatMap(signal=>signal.evidenceRefs||[])])],checks,blockers:checks.filter(row=>row.status!=='met').map(row=>row.reason),forward,revisions,validation:null as RegisteredWindowProof|null,promotionAllowed:false,monitoringAllowed:false,orderChanges:0,modelCalls:0,reason:'只读证据检查，不是策略审批；无新采集、模型调用、任务或订单'};
 if(executionOk)pack.evidenceRefs=[...new Set([...pack.evidenceRefs,...x!.evidenceRefs])];
 const evidenceTimeline=(()=>{try{return buildForwardEvidenceTimeline({session:s,signals,execution:x,executionVerified:!!executionOk});}catch{return {schemaVersion:1,signals:[],costCoverage:'unknown',actualTradingVerified:false,promotionAllowed:false,reason:'旧记录缺少可核验的完整信号血缘，无法生成逐信号明细；原证据检查和阻止项保留'};}})();
 const enriched={...pack,evidenceTimeline};
 return {...enriched,contentHash:createHash('sha256').update(JSON.stringify(enriched)).digest('hex')};
}
