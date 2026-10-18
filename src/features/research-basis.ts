import { createHash, randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
export interface ResearchBasisScope {market:string;instrument:string;timeframe:string}
export interface ResearchBasisOption extends ResearchBasisScope {id:string;contentHash:string;source:string;publishedAt:string;fetchedAt:string;timezone:string;adjustment:string;fieldVersion:string;units:Record<string,string>;status:string;qualityValid:boolean}
interface BasisRecord extends ResearchBasisOption {selectionId:string;reason:string;asOf:string;selectedAt:string}
interface BasisState {revision:number;records:BasisRecord[]}
function context(value:ResearchBasisScope){
  const prefixes:Record<string,string>={stocks:'stock:',options:'option:',crypto:'crypto:',prediction:'prediction:'};
  if(!prefixes[value.market]||typeof value.instrument!=='string'||!value.instrument.startsWith(prefixes[value.market])||!/^\w+:[^\s:]{1,40}:[^\s]{1,180}$/.test(value.instrument)||!/^[A-Za-z0-9]{1,12}$/.test(value.timeframe))throw Error('需要同市场规范标的和周期');
  return {market:value.market,instrument:value.instrument,timeframe:value.timeframe};
}
export class ResearchBasisStore {
  constructor(private store:Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'>,private catalog:(scope:ResearchBasisScope)=>ResearchBasisOption[]){}
  private key(scope:ResearchBasisScope){return 'research-basis:admin:v1:'+createHash('sha256').update(JSON.stringify(context(scope))).digest('hex');}
  private state(scope:ResearchBasisScope){const saved=this.store.get<BasisState>(this.key(scope));if(!this.store.health.ok)throw Error('研究口径状态不可核验');if(saved&&(!Number.isSafeInteger(saved.revision)||saved.revision<0||!Array.isArray(saved.records)||saved.records.length>1000))throw Error('研究口径历史无效');return saved||{revision:0,records:[]};}
  read(scope:ResearchBasisScope){const key=context(scope),state=this.state(key);return {...key,...state,options:this.catalog(key).filter(row=>row.market===key.market&&row.instrument===key.instrument&&row.timeframe===key.timeframe).slice(0,200),reason:'仅记录研究口径，不改变行情来源、争议分区、既有实验、模拟盘或跑单；目录健康不等于物理文件已核验。'};}
  select(input:ResearchBasisScope&{revision:number;partitionId:string;reason:string;asOf:string}){
    if(Object.keys(input).some(key=>!['market','instrument','timeframe','revision','partitionId','reason','asOf'].includes(key)))throw Error('研究口径不接受额外参数或来源覆盖');
    const scope=context(input),asOf=Date.parse(input.asOf);
    if(!Number.isFinite(asOf)||asOf>Date.now()||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw Error('需要有效的历史时点和选择原因');
    return this.store.transaction(()=>{
      const state=this.state(scope);if(state.revision!==input.revision)throw Error('版本已变化，请刷新后重试');if(state.records.length>=1000)throw Error('已达研究口径历史上限，未删除旧记录');
      const options=this.catalog(scope).filter(row=>row.id===input.partitionId&&row.market===scope.market&&row.instrument===scope.instrument&&row.timeframe===scope.timeframe);
      if(options.length!==1)throw Error('研究分区不存在或身份不唯一');const option=options[0];
      if(option.status!=='committed'||option.qualityValid!==true||!option.source||!/^[a-f0-9]{64}$/.test(option.contentHash)||![option.publishedAt,option.fetchedAt].every(v=>Number.isFinite(Date.parse(v))&&Date.parse(v)<=asOf))throw Error('分区未发布、质量不合格或在研究时点尚不可用；不解除隔离');
      const record:BasisRecord={...structuredClone(option),selectionId:randomUUID(),reason:input.reason.trim(),asOf:new Date(asOf).toISOString(),selectedAt:new Date().toISOString()};
      this.store.set(this.key(scope),{revision:state.revision+1,records:[...state.records,record]},1);
      this.store.appendAudit({id:record.selectionId,action:'research_basis_selected',detail:JSON.stringify({market:scope.market,instrument:scope.instrument,timeframe:scope.timeframe,partitionId:option.id,contentHash:option.contentHash,reason:record.reason})});
      return this.read(scope);
    });
  }
}
