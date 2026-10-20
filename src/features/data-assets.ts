import { createHash, randomUUID } from 'node:crypto';
import type { DataLakeCatalog, DataBackfillJob } from '../storage/data-lake';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import type { DataLakeBackfillWorker } from '../storage/data-lake-worker';
import type { MarketId } from './research-contracts';
import { evaluateStorageCapacity } from '../storage/capacity-budget';

type Scope = { market: string; instrument: string; timeframe: string };
type CollectionInput = Scope & { from: string; to: string };
export interface CollectionPlan {
  id: string; hash: string; market: MarketId; instrument: string; symbol: string; timeframe: string;
  from: string; to: string; provider: string; createdAt: string; expiresAt: string;
  estimates: { maxRequests: number; maxRows: number; storageBytes: number; reason: string };
  retention: string; jobId?: string;
}
const kinds = { stocks:'stock', options:'option', crypto:'crypto', prediction:'prediction' } as const;
const intervals:Record<string,number> = { '1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000 };
const hashPlan = (plan:Omit<CollectionPlan,'hash'|'jobId'>) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

/** Preview metadata only; execution and checkpoints remain in the existing backfill catalog. */
export class DataAssetService {
  constructor(private readonly catalog:DataLakeCatalog, private readonly state:SQLiteStateStore, private readonly worker:DataLakeBackfillWorker, private readonly now=Date.now) {}

  private identity(scope:Scope) {
    if (!Object.hasOwn(kinds,scope.market) || typeof scope.instrument!=='string' || typeof scope.timeframe!=='string' || !scope.timeframe || scope.timeframe.length>20) throw Error('市场或标的身份无效');
    const market=scope.market as MarketId;
    const parts=scope.instrument.split(':');
    if(parts.length!==3 || parts[0]!==kinds[market] || !/^[a-z0-9-]{1,32}$/.test(parts[1]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[2])) throw Error('请明确选择市场、交易场所和规范标的身份');
    const known=this.catalog.resolveInstrument(market,scope.instrument);
    const symbol=market==='prediction'?parts[2]:parts[2].toUpperCase();
    return {market,instrument:known?.id || `${parts[0]}:${parts[1]}:${symbol}`,symbol:known?.symbol || symbol,venue:known?.venue || parts[1]};
  }

  assets(scope:Scope) {
    const ref=this.identity(scope);
    let ownsLegacySymbol=false;
    try { ownsLegacySymbol=this.catalog.resolveInstrument(ref.market,ref.symbol)?.id===ref.instrument; } catch { /* Ambiguous legacy records remain unassociated, not guessed. */ }
    const optionScope=ref.market==='options'&&scope.timeframe==='snapshot'&&/^option:(cboe:[A-Z0-9.]+|deribit:(BTC|ETH))$/.test(ref.instrument);
    const coverage=optionScope?this.catalog.listCoverage('options',ref.instrument,'snapshot'):ownsLegacySymbol?this.catalog.listCoverage(ref.market,ref.symbol,scope.timeframe):[];
    const optionSnapshots=optionScope?this.catalog.listOptionSnapshots({market:'options',instrument:ref.instrument}).map(({snapshot,...metadata})=>metadata):[];
    const partitions=ownsLegacySymbol?this.catalog.listPartitionEvidence(ref.market,ref.symbol,scope.timeframe):[];
    const diagnostics=this.catalog.getDiagnostics();
    const discrepancies=ownsLegacySymbol?this.catalog.listDiscrepancies(ref.market,ref.symbol).filter(row=>row.timeframe===scope.timeframe):[];
    const states=coverage.map(row=>row.dataStatus);
    const dataStatus=discrepancies.length || states.includes('partial')?'partial':states.includes('unavailable')?'unavailable':coverage.length?'historical':'empty';
    return {success:true,market:ref.market,instrument:ref.instrument,dataStatus,source:'本地数据湖已登记分区',updatedAt:new Date(this.now()).toISOString(),reason:coverage.length?'覆盖范围不代表区间连续或文件可用；缺口未插值补齐':'当前身份与周期没有可明确关联的分区；不同交易场所或有歧义的旧记录不合并',evidenceRefs:[...partitions.map(p=>p.id),...optionSnapshots.map(p=>p.id)],data:{coverage,partitions,optionSnapshots,discrepancies,revisions:ownsLegacySymbol?this.catalog.listRevisions(ref.market).filter(row=>row.instrument===ref.symbol&&row.timeframe===scope.timeframe):[],providers:this.catalog.listProviderContracts(ref.market),capacity:{usageBytes:diagnostics.usageBytes,quotaBytes:diagnostics.quotaBytes,quotaState:diagnostics.quotaState},collectionCapabilities:this.worker.capabilities().filter(p=>p.market===ref.market)}};
  }

  private capacity(bytes:number) {
    const d=this.catalog.getDiagnostics();
    const disk=evaluateStorageCapacity({freeBytes:d.filesystem?.freeBytes??null,totalBytes:d.filesystem?.totalBytes??null,reserveBytes:d.filesystem?.reserveBytes,expectedBytes:bytes});
    if(d.quotaState==='blocked' || d.usageBytes+bytes>=d.quotaBytes*.9 || ['unknown','blocked'].includes(disk.state)) throw Error('容量预算不足或无法核验磁盘余量，未创建采集任务');
  }

  preview(input:CollectionInput):CollectionPlan {
    const ref=this.identity(input),from=Date.parse(input.from),to=Date.parse(input.to),interval=intervals[input.timeframe];
    const venue=ref.market==='stocks'?'us':ref.market==='crypto'?'binance':null;
    if(!venue || venue!==ref.venue) throw Error('当前市场/交易场所不支持历史采集');
    const provider=this.worker.capabilities().find(p=>p.market===ref.market && p.datasets.includes('bars') && p.timeframes.includes(input.timeframe));
    if(!provider || !interval) throw Error('当前来源不支持此周期的定界历史采集');
    if(!Number.isFinite(from) || !Number.isFinite(to) || from<=0 || from>=to || to>this.now()) throw Error('采集日期范围无效或包含未来时间');
    const maxRows=Math.ceil((to-from)/interval)+1;
    // Binance's actual endpoint returns at most 1000 rows per request; no inferred pagination.
    if(ref.market==='crypto' && maxRows>1000) throw Error('单次采集范围超过1000根上限，请缩小范围');
    if(ref.market==='stocks') {
      const days=(this.now()-from)/86400000;
      if((input.timeframe==='1m' && days>7) || (['5m','15m'].includes(input.timeframe) && days>60) || (input.timeframe==='1h' && days>730) || maxRows>10000) throw Error('采集范围超出来源支持上限');
    }
    const estimates={maxRequests:ref.market==='stocks'?4:2,maxRows,storageBytes:65536+maxRows*256,reason:'请求上限含来源主机回退及重试；存储为保守规划估计，并非来源保证；无记录或缺口会保留真实原因'};
    this.capacity(estimates.storageBytes);
    const base={id:`collection_${randomUUID()}`,market:ref.market,instrument:ref.instrument,symbol:ref.symbol,timeframe:input.timeframe,from:new Date(from).toISOString(),to:new Date(to).toISOString(),provider:provider.id,createdAt:new Date(this.now()).toISOString(),expiresAt:new Date(this.now()+600000).toISOString(),estimates,retention:'沿用现有数据湖保留政策和容量停止线；不自动删除业务历史'};
    const plan={...base,hash:hashPlan(base)};
    this.state.transaction(()=>{const ids=this.state.get<string[]>('collection-plan-index:v1')||[];if(!this.state.health.ok || !Array.isArray(ids)) throw Error('采集计划存储不可用');if(ids.length>=1000)throw Error('采集预览容量已满，未删除旧计划');this.state.set(`collection-plan:${plan.id}`,plan);this.state.set('collection-plan-index:v1',[...ids,plan.id]);});
    return plan;
  }

  list(scope:Scope) {
    const ref=this.identity(scope),ids=this.state.get<string[]>('collection-plan-index:v1')||[];
    if(!this.state.health.ok || !Array.isArray(ids))throw Error('采集计划索引不可用');
    return ids.map(id=>this.read(id)).filter(plan=>plan.market===ref.market && plan.instrument===ref.instrument && plan.timeframe===scope.timeframe).reverse().slice(0,100).map(plan=>this.status(plan.id));
  }

  read(id:string):CollectionPlan {
    if(!/^collection_[a-f0-9-]{36}$/.test(id)) throw Error('无效计划身份');
    const plan=this.state.get<CollectionPlan>(`collection-plan:${id}`);
    if(!this.state.health.ok || !plan) throw Error('采集计划不存在或存储不可用');
    const {hash,jobId,...base}=plan;
    if(hashPlan(base)!==hash) throw Error('采集计划Hash损坏');
    return plan;
  }

  status(id:string) {
    const plan=this.read(id);
    return {...plan,job:this.catalog.getBackfill(`backfill_plan_${createHash('sha256').update(plan.id).digest('hex')}`)};
  }

  confirm(id:string,hash:string):DataBackfillJob {
    const plan=this.read(id);
    if(plan.hash!==hash) throw Error('确认Hash与预览不一致');
    // Stable catalog request identity also closes the crash window between two SQLite databases.
    const existing=this.catalog.getBackfill(`backfill_plan_${createHash('sha256').update(plan.id).digest('hex')}`);
    if(existing) return existing;
    if(Date.parse(plan.expiresAt)<=this.now()) throw Error('采集预览已过期，请重新预览');
    if(!this.worker.capabilities().some(p=>p.id===plan.provider && p.market===plan.market && p.timeframes.includes(plan.timeframe))) throw Error('来源能力已变化，请重新预览');
    this.capacity(plan.estimates.storageBytes);
    const job=this.catalog.createBackfill({market:plan.market,instrument:plan.symbol,dataset:'bars',timeframe:plan.timeframe,from:plan.from,to:plan.to,requestId:plan.id});
    this.state.transaction(()=>{this.state.set(`collection-plan:${id}`,{...plan,jobId:job.id});this.state.appendAudit({id:`confirm:${id}`,action:'collection-confirm',detail:JSON.stringify({planId:id,jobId:job.id,hash})});});
    return job;
  }

  control(id:string,action:'pause'|'resume'|'cancel') {
    const plan=this.read(id),job=this.catalog.getBackfill(`backfill_plan_${createHash('sha256').update(plan.id).digest('hex')}`);
    if(!job) throw Error('采集计划尚未确认');
    if(['succeeded','failed','cancelled'].includes(job.status)) return job;
    if(action==='resume')this.capacity(plan.estimates.storageBytes);
    const result=this.catalog.controlBackfill(job.id,action);
    this.state.appendAudit({id:randomUUID(),action:`collection-${action}`,detail:JSON.stringify({planId:id,jobId:job.id})});
    return result;
  }
}
