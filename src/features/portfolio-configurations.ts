import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';

type State=Pick<SQLiteStateStore,'get'|'set'|'health'|'appendAudit'|'transaction'>;
type Market='stocks'|'crypto'|'options'|'prediction';

export interface PortfolioConfigurationInput {
  market:Market;
  name:string;
  requestId:string;
  simulationIds:string[];
  weights?:Record<string,number>;
  constraints:{
    maxPositions:number;
    maxInvestedPct:number;
    maxSinglePositionPct:number;
    maxDrawdownPct:number;
    feeBps:number;
    slippageBps:number;
  };
}
interface StoredConfiguration {
  id:string;
  requestHash:string;
  manifest:PortfolioConfigurationInput;
  calculations:PortfolioConfigurationCalculation;
  manifestHash:string;
  createdAt:number;
  updatedAt:number;
}

interface PortfolioConfigurationCalculation {
  market:Market;
  currency:string;
  sources:Array<{simulationId:string;source:string;snapshotIds:string[];manifestHash:string}>;
  weights:Record<string,number>;
  observed:Array<{simulationId:string;startingCash:number|null;endingEquity:number|null;returnPct:number|null;maxDrawdownPct:number|null;orders:number;complete:boolean}>;
  aggregate:{observedWeight:number;underweightPct:number;weightedReturnPct:number|null;worstDrawdownPct:number|null;weightedFeeBps:number;weightedSlippageBps:number};
  correlation:{status:'computed'|'unavailable';value:number|null;observations:number;reason:string};
  constraints:PortfolioConfigurationInput['constraints'];
  executionEnabled:false;
  ordersCreated:0;
  modelCalls:0;
  reason:string;
  contentHash:string;
}

interface Dependencies {
  simulation:(id:string)=>any;
}

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

function correlations(curves:number[][]){
  if(curves.length<2||curves.some(curve=>curve.length<3)||new Set(curves.map(curve=>curve.length)).size!==1)return {status:'unavailable' as const,value:null,observations:0,reason:'缺少同长度历史权益曲线，不推算相关性'};
  const returns=curves.map(curve=>curve.slice(1).map((value,index)=>value/curve[index]-1));
  if(returns.some(series=>series.some(value=>!Number.isFinite(value))))return {status:'unavailable' as const,value:null,observations:0,reason:'权益曲线包含无效值，不推算相关性'};
  const pairs:number[]=[];
  for(let left=0;left<returns.length;left++)for(let right=left+1;right<returns.length;right++){
    const a=returns[left],b=returns[right],ma=a.reduce((sum,value)=>sum+value,0)/a.length,mb=b.reduce((sum,value)=>sum+value,0)/b.length;
    const numerator=a.reduce((sum,value,index)=>sum+(value-ma)*(b[index]-mb),0),denominator=Math.sqrt(a.reduce((sum,value)=>sum+(value-ma)**2,0)*b.reduce((sum,value)=>sum+(value-mb)**2,0));
    if(!(denominator>0))return {status:'unavailable' as const,value:null,observations:a.length,reason:'至少一条权益曲线方差为零，相关性不可识别'};
    pairs.push(numerator/denominator);
  }
  return {status:'computed' as const,value:pairs.reduce((sum,value)=>sum+value,0)/pairs.length,observations:returns[0].length,reason:'仅从已保存权益曲线的共同历史窗口计算平均配对相关；不推断未来相关性，也不跨币种合并'};
}

/** Immutable portfolio configuration records over existing paper simulations. */
export class PortfolioConfigurationStore {
  constructor(private state:State,private deps:Dependencies,private now=Date.now){}
  private index(){
    if(!this.state.health.ok)throw Error('组合配置目录不可用');
    const rows=this.state.get<string[]>('portfolio-configuration:index:v1')||[];
    if(!Array.isArray(rows)||rows.length>100||rows.some(id=>!/^pconfig_[a-f0-9]{64}$/.test(id)))throw Error('组合配置目录不可核验');
    return rows;
  }
  private read(id:string){
    this.index();
    if(!/^pconfig_[a-f0-9]{64}$/.test(id))throw Error('组合配置ID无效');
    const row=this.state.get<StoredConfiguration>('portfolio-configuration:'+id);
    if(!row||row.id!==id||digest(row.manifest)!==row.manifestHash)throw Error('组合配置清单或结果Hash不可核验');
    const {contentHash,...calculationPayload}=row.calculations;
    if(digest(calculationPayload)!==contentHash)throw Error('组合配置清单或结果Hash不可核验');
    return structuredClone(row);
  }
  private view(id:string){const row=this.read(id);return {...row.calculations,id:row.id,name:row.manifest.name,manifestHash:row.manifestHash,updatedAt:new Date(row.updatedAt).toISOString()};}
  list(market:string){
    if(!['stocks','crypto','options','prediction'].includes(market))throw Error('市场无效');
    return this.index().map(id=>this.read(id)).filter(row=>row.manifest.market===market).map(row=>({id:row.id,name:row.manifest.name,market:row.manifest.market,currency:row.calculations.currency,manifestHash:row.manifestHash,updatedAt:new Date(row.updatedAt).toISOString()}));
  }
  save(input:PortfolioConfigurationInput){
    const allowed=['market','name','requestId','simulationIds','weights','constraints'];
    if(!input||Object.keys(input).some(key=>!allowed.includes(key))||!['stocks','crypto','options','prediction'].includes(input.market)||!/^[a-f0-9-]{36}$/.test(String(input.requestId||''))||typeof input.name!=='string'||!input.name.trim()||input.name.length>200)throw Error('组合配置市场、名称或请求ID无效');
    if(!Array.isArray(input.simulationIds)||input.simulationIds.length<1||input.simulationIds.length>5||new Set(input.simulationIds).size!==input.simulationIds.length||input.simulationIds.some(id=>!/^psim_[a-f0-9]{64}$/.test(id)))throw Error('组合配置需要1–5份不同的明确模拟引用');
    const c=input.constraints;
    if(!c||Object.keys(c).some(key=>!['maxPositions','maxInvestedPct','maxSinglePositionPct','maxDrawdownPct','feeBps','slippageBps'].includes(key))||!Number.isSafeInteger(c.maxPositions)||c.maxPositions<1||c.maxPositions>20||!finite(c.maxInvestedPct)||c.maxInvestedPct<=0||c.maxInvestedPct>100||!finite(c.maxSinglePositionPct)||c.maxSinglePositionPct<=0||c.maxSinglePositionPct>100||!finite(c.maxDrawdownPct)||c.maxDrawdownPct<=0||c.maxDrawdownPct>100||!finite(c.feeBps)||c.feeBps<0||c.feeBps>500||!finite(c.slippageBps)||c.slippageBps<0||c.slippageBps>500||c.maxSinglePositionPct>c.maxInvestedPct)throw Error('组合约束、费用或滑点范围无效');
    const views=input.simulationIds.map(id=>{const view=this.deps.simulation(id);if(!view||view.id!==id||view.market!==input.market)throw Error('模拟引用不存在、Hash不可核验或市场不一致');return view;});
    const currency=views[0].currency;
    if(typeof currency!=='string'||views.some(view=>view.currency!==currency))throw Error('组合引用结算币种不一致；缺少汇率证据时不合并');
    const equalWeight=100/views.length,weights=input.weights||Object.fromEntries(input.simulationIds.map(id=>[id,equalWeight]));
    if(Object.keys(weights).length!==input.simulationIds.length||input.simulationIds.some(id=>!finite(weights[id])||weights[id]<=0||weights[id]>100)||Math.abs(Object.values(weights).reduce((sum,value)=>sum+value,0)-100)>1e-6)throw Error('组合权重必须覆盖全部引用且合计100%');
    const observed=views.map(view=>{
      const performance=view.shared?.performance||null,startingCash=finite(performance?.startingCash)?performance.startingCash:null,endingEquity=finite(performance?.equity)?performance.equity:null;
      return {simulationId:view.id,startingCash,endingEquity,returnPct:finite(performance?.totalReturnPct)?performance.totalReturnPct:null,maxDrawdownPct:finite(performance?.maxDrawdownPct)?performance.maxDrawdownPct:null,orders:Array.isArray(view.shared?.orders)?view.shared.orders.length:0,complete:performance?.dataStatus?performance.dataStatus==='complete':startingCash!==null&&endingEquity!==null};
    });
    const observedWeight=observed.filter(row=>row.returnPct!==null).reduce((sum,row)=>sum+weights[row.simulationId],0),underweight=Math.max(0,100-observedWeight);
    const weightedReturnPct=underweight>1e-6?null:observed.reduce((sum,row)=>sum+row.returnPct!*weights[row.simulationId]/100,0);
    const worstDrawdownPct=observed.some(row=>row.maxDrawdownPct===null)?null:Math.max(...observed.map(row=>row.maxDrawdownPct!));
    const curves=views.map(view=>(view.shared?.equityCurve||[]).filter(finite));
    const sourceRows=views.map(view=>({simulationId:String(view.id),source:String(view.source||'unknown'),snapshotIds:[...new Set((view.evidenceRefs||[]).map(String) as string[])].sort(),manifestHash:String(view.manifestHash)}));
    if(sourceRows.some(row=>!row.snapshotIds.length||!/^[a-f0-9]{64}$/.test(row.manifestHash)))throw Error('模拟来源或固定快照证据不完整');
    const base={market:input.market,currency,sources:sourceRows,weights,observed,aggregate:{observedWeight,underweightPct:underweight,weightedReturnPct,worstDrawdownPct,weightedFeeBps:c.feeBps,weightedSlippageBps:c.slippageBps},correlation:correlations(curves),constraints:{...c},executionEnabled:false as const,ordersCreated:0 as const,modelCalls:0 as const,
      reason:underweight>1e-6?'部分模拟尚无已保存收益，组合只显示覆盖权重，不将缺失子集当作完整组合':worstDrawdownPct===null?'收益权重已覆盖，但部分回撤缺失；不从其他模拟推算':'组合指标仅基于已保存模拟历史与明确的同币种权重；不是可执行组合或未来预测'};
    const calculations:PortfolioConfigurationCalculation={...base,contentHash:digest(base)};
    const id='pconfig_'+digest(input.requestId),requestHash=digest(input);
    return this.state.transaction(()=>{
      const old=this.state.get<StoredConfiguration>('portfolio-configuration:'+id);
      if(old){if(old.requestHash!==requestHash)throw Error('请求ID已绑定另一组合配置');return this.view(id);}
      if(this.index().length>=100)throw Error('组合配置已达100项，旧记录保留');
      const manifest=structuredClone(input),now=this.now(),row:StoredConfiguration={id,requestHash,manifest,calculations,manifestHash:digest(manifest),createdAt:now,updatedAt:now};
      this.state.set('portfolio-configuration:'+id,row);
      this.state.set('portfolio-configuration:index:v1',[...this.index(),id]);
      this.state.appendAudit({id:randomUUID(),at:new Date(now).toISOString(),action:'portfolio-configuration-save',detail:JSON.stringify({id,market:input.market,currency,manifestHash:row.manifestHash,contentHash:calculations.contentHash})});
      return this.view(id);
    });
  }
  compare(ids:string[]){
    if(!Array.isArray(ids)||ids.length<2||ids.length>5||new Set(ids).size!==ids.length)throw Error('组合配置对比需要2–5份不同配置');
    const rows=ids.map(id=>this.view(id)),market=rows[0].market,currency=rows[0].currency;
    if(rows.some(row=>row.market!==market||row.currency!==currency))throw Error('跨市场或跨币种配置缺少汇率和统一结算证据，不能合并比较');
    const result={market,currency,columns:rows,currencyGroups:{[currency]:rows.map(row=>row.id)},crossCurrencyConversion:null,ranking:rows.every(row=>row.aggregate.underweightPct===0)?rows.slice().sort((a,b)=>(b.aggregate.weightedReturnPct??-Infinity)-(a.aggregate.weightedReturnPct??-Infinity)).map(row=>row.id):null,
      reason:'并列比较保存的来源、权重、覆盖、费用和风险；历史收益不证明未来优于其他方案，缺失汇率或相关性时不推算'};
    return {...result,contentHash:digest(result)};
  }
}
