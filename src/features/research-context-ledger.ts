import { createHash, randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import type { MarketId } from './research-contracts';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const prefixes={stocks:'stock:',options:'option:',crypto:'crypto:',prediction:'prediction:'};
type Universe={id:string;market:MarketId;instruments:string[];source:string;observedAt:number;hash:string};
type Trial={id:string;market:MarketId;experimentId:string|null;strategyVersion:string|null;dataHash:string|null;parameters:Record<string,number|string|boolean>;split:string;status:'running'|'succeeded'|'failed';at:number;completedAt?:number;configurationHash:string};
/** Append-only observed context. Never backdates membership or reconstitutes unrecorded attempts. */
export class ResearchContextLedger{
  constructor(private store:Pick<SQLiteStateStore,'get'|'set'|'transaction'|'health'>){}
  private key(market:string){if(!Object.hasOwn(prefixes,market))throw Error('研究台账市场无效');return 'research-context-ledger:v1:'+market;}
  private read(market:MarketId){const key=this.key(market),value=this.store.get<{universes:Universe[];trials:Trial[]}>(key);if(!this.store.health.ok)throw Error('研究台账存储异常，不覆盖历史');if(value&&(!Array.isArray(value.universes)||!Array.isArray(value.trials)))throw Error('研究台账格式异常');return value||{universes:[],trials:[]};}
  capture(market:MarketId,instruments:string[],source:string,at=Date.now()){
    const key=this.key(market);
    if(!Array.isArray(instruments)||!instruments.length||instruments.length>500||instruments.some(id=>typeof id!=='string'||!id.startsWith(prefixes[market])||!/^\w+:[^\s:]{1,40}:[^\s]{1,180}$/.test(id))||new Set(instruments).size!==instruments.length)throw Error('股票池必须是同市场、明确身份的1–500个标的');
    if(typeof source!=='string'||!source.trim()||source.length>200||!Number.isFinite(at)||Math.abs(Date.now()-at)>60000)throw Error('只能记录当前实际观察的股票池，不接受追溯填写历史成分');
    const row:Universe={id:'universe_'+randomUUID(),market,instruments:[...instruments],source,observedAt:at,hash:digest({market,instruments,source,observedAt:at})};
    return this.store.transaction(()=>{const state=this.read(market);if(state.universes.length>=1000)throw Error('股票池观察台账容量已满，未删除历史');state.universes.push(row);this.store.set(key,state);return structuredClone(row);});
  }
  recordTrial(input:{market:MarketId;experimentId?:string|null;strategyVersion?:string|null;dataHash?:string|null;parameters?:Record<string,number|string|boolean>;split:string;status:string;inputHash?:string}){
    const key=this.key(input.market),parameters=input.parameters||{};
    if(typeof parameters!=='object'||Array.isArray(parameters)||!['running','succeeded','failed'].includes(input.status)||!['train-validation-oos','unspecified'].includes(input.split)||input.dataHash!=null&&!/^[a-f0-9]{64}$/i.test(input.dataHash)||Object.keys(parameters).length>64||Object.entries(parameters).some(([k,v])=>!/^[\w.-]{1,64}$/.test(k)||!['number','string','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&v.length>256))throw Error('参数试验记录无效');
    for(const id of [input.experimentId,input.strategyVersion])if(id!=null&&(typeof id!=='string'||id.length>200))throw Error('试验引用无效');
    if(input.inputHash!=null&&!/^[a-f0-9]{64}$/.test(input.inputHash))throw Error('试验输入Hash无效');
    const sorted=Object.fromEntries(Object.entries(parameters).sort(([a],[b])=>a.localeCompare(b))),row:Trial={id:'trial_'+randomUUID(),market:input.market,experimentId:input.experimentId||null,strategyVersion:input.strategyVersion||null,dataHash:input.dataHash||null,parameters:sorted,split:input.split,status:input.status as Trial['status'],at:Date.now(),configurationHash:input.inputHash||digest({market:input.market,strategyVersion:input.strategyVersion||null,dataHash:input.dataHash||null,parameters:sorted,split:input.split})};
    return this.store.transaction(()=>{const state=this.read(input.market);if(state.trials.length>=10000)throw Error('试验台账容量已满，未删除旧尝试');state.trials.push(row);this.store.set(key,state);return structuredClone(row);});
  }
  finishTrial(market:MarketId,id:string,experimentId:string|null){
    return this.store.transaction(()=>{const state=this.read(market),row=state.trials.find(r=>r.id===id);if(!row||row.status!=='running')throw Error('试验完成引用无效');row.status=experimentId?'succeeded':'failed';row.experimentId=experimentId;row.completedAt=Date.now();this.store.set(this.key(market),state);});
  }
  list(market:MarketId,asOf=Date.now()){
    if(!Number.isFinite(asOf)||asOf<0||asOf>Date.now()+1000)throw Error('台账时点无效');
    const state=this.read(market),universes=state.universes.filter(r=>r.observedAt<=asOf),trials=state.trials.filter(r=>r.at<=asOf).map(r=>r.completedAt&&r.completedAt>asOf?{...r,status:'running' as const,experimentId:null,completedAt:undefined}:r);
    return {market,asOf,universes:universes.slice(-100),trials:trials.slice(-200),attempts:trials.length,uniqueConfigurations:new Set(trials.map(r=>r.configurationHash)).size,ranking:null,
      reason:(universes.length?'股票池仅代表记录时观察，不证明两个观察间成员未变。':'无可用的当时股票池观察，当前成分不得回填；存在幸存者偏差风险。')+' 试验次数仅包含启用台账后实际记录，旧尝试数量未知；多重试验及过拟合风险不因样本外标签消失，未实施统计校正。'};
  }
}
export function executeRecordedTrial<T extends {experiment:{id:string}}>(ledger:ResearchContextLedger,input:{context:any;split?:unknown;prices:unknown;signals:unknown},execute:()=>T,persist?:(result:T&{configurationId:string;trialId:string})=>void){
  const context=input.context;
  if(!context||!Object.hasOwn(prefixes,context.market))throw Error('试验市场无效，未执行研究');
  // Record before execution; a process crash remains running/unknown, never fabricated success.
  const common={market:context.market as MarketId,strategyVersion:typeof context.strategyVersion==='string'?context.strategyVersion:null,dataHash:typeof context.dataSnapshotHash==='string'&&/^[a-f0-9]{64}$/i.test(context.dataSnapshotHash)?context.dataSnapshotHash:null,parameters:context.parameters||{},split:input.split?'train-validation-oos':'unspecified'};
  const attempt=ledger.recordTrial({...common,inputHash:digest(input),status:'running'});
  try{
    const result=execute(),configurationId=(result as T&{configurationId?:string}).configurationId||result.experiment.id,id='run_'+randomUUID();
    const saved={...result,experiment:{...result.experiment,id},configurationId,trialId:attempt.id};
    // Keep the attempt running until the experiment repository has actually accepted the result.
    persist?.(saved);
    ledger.finishTrial(common.market,attempt.id,id);
    return saved;
  }catch(error){ledger.finishTrial(common.market,attempt.id,null);throw error;}
}
