import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import {verifyEvidenceSnapshotHash,type EvidenceSnapshot} from './decision-intelligence';

type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'health'|'appendAudit'>;

interface HypothesisInput {
  statement:string;
  relation:'observed'|'associated'|'causal'|'scenario';
  evidenceRefs:string[];
}
interface ScenarioInput {
  id:string;
  label:string;
  evidenceRef:string;
  baseField:string;
  growthPct:number;
  years:number;
  operatingMarginPct:number;
  multiple:number;
}

export interface CompanyMacroResearchInput {
  market:'stocks';
  instrument:string;
  asOf:string;
  requestId:string;
  evidenceRefs:string[];
  hypotheses:HypothesisInput[];
  scenarios?:ScenarioInput[];
}

interface StoredRow {
  id:string;
  requestHash:string;
  input:CompanyMacroResearchInput;
  evidence:EvidenceSnapshot[];
  result:CompanyMacroResearchResult;
  resultHash:string;
  status:'preview'|'confirmed'|'stopped';
  revision:number;
  createdAt:number;
  updatedAt:number;
}

export interface CompanyMacroResearchResult {
  market:'stocks';
  instrument:string;
  asOf:string;
  evidenceRefs:string[];
  facts:Array<{id:string;source:string;observedAt:string;fetchedAt:string;dataStatus:string;fields:Record<string,unknown>}>;
  revisions:Array<{
    before:string;
    after:string;
    changes:Array<{field:string;before:{present:boolean;value:unknown};after:{present:boolean;value:unknown}}>;
    status:'comparable'|'missing';
    reason:string;
  }>;
  hypotheses:Array<HypothesisInput&{evidenceStatus:'supported'|'missing';inferenceClass:'direct-observation'|'association-only'|'causal-not-established'|'scenario-assumption';reason:string}>;
  scenarios:Array<{
    id:string;
    label:string;
    status:'calculated'|'missing';
    evidenceRef:string;
    baseField:string;
    baseValue:number|null;
    projectedValue:number|null;
    modeledEquityValue:number|null;
    assumptions:{growthPct:number|null;years:number|null;operatingMarginPct:number|null;multiple:number|null};
    reason:string;
  }>;
  coverage:{evidence:number;hypotheses:number;supportedHypotheses:number;scenarios:number;calculatedScenarios:number;revisionPairs:number};
  model:'evidence-only-company-macro-v1';
  executionEnabled:false;
  modelCalls:0;
  ordersCreated:0;
  reason:string;
  contentHash:string;
}

type Dependencies={evidence:(id:string)=>EvidenceSnapshot|null};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp=(value:unknown)=>value instanceof Date?value.getTime():Date.parse(String(value));
const clean=(value:unknown,label:string,max=2000)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}不能为空或超过${max}字`);
  return value.trim();
};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

/** Evidence-only company and macro research. Causal claims are never inferred from co-movement. */
export class CompanyMacroResearchStore {
  constructor(private state:State,private deps:Dependencies,private now=Date.now){}
  private index(){
    if(!this.state.health.ok)throw Error('公司与宏观研究目录不可用');
    const rows=this.state.get<string[]>('company-macro-research:index:v1')||[];
    if(!Array.isArray(rows)||rows.length>100||rows.some(id=>!/^company_research_[a-f0-9]{64}$/.test(id)))throw Error('公司与宏观研究目录不可核验');
    return rows;
  }
  private read(id:string){
    this.index();
    if(!/^company_research_[a-f0-9]{64}$/.test(id))throw Error('公司与宏观研究ID无效');
    const row=this.state.get<StoredRow>('company-macro-research:'+id);
    if(!row||row.id!==id||digest(row.input)!==row.requestHash||digest(row.result)!==row.resultHash||row.evidence.some(item=>!verifyEvidenceSnapshotHash(item)))throw Error('公司与宏观研究清单、证据或结果Hash不可核验');
    return structuredClone(row);
  }
  private save(row:StoredRow,action:string){
    row.revision++;row.updatedAt=this.now();this.state.set('company-macro-research:'+row.id,row);
    this.state.appendAudit({id:randomUUID(),at:new Date(this.now()).toISOString(),action:'company-macro-research-'+action,detail:JSON.stringify({id:row.id,instrument:row.input.instrument,resultHash:row.resultHash,revision:row.revision})});
    return this.view(row.id);
  }
  view(id:string){
    const row=this.read(id);
    return {...row.result,id:row.id,status:row.status,revision:row.revision,resultHash:row.resultHash,updatedAt:new Date(row.updatedAt).toISOString(),modelCalls:0,ordersCreated:0,executionEnabled:false as const};
  }
  list(market:string){
    if(market!=='stocks')throw Error('公司与宏观研究当前只接受股票规范标的');
    return this.index().map(id=>this.read(id)).filter(row=>row.input.market===market).map(row=>({id:row.id,instrument:row.input.instrument,asOf:row.input.asOf,status:row.status,revision:row.revision,resultHash:row.resultHash,updatedAt:new Date(row.updatedAt).toISOString()}));
  }
  async preview(input:CompanyMacroResearchInput){
    const allowed=['market','instrument','asOf','requestId','evidenceRefs','hypotheses','scenarios'];
    if(!input||input.market!=='stocks'||Object.keys(input).some(key=>!allowed.includes(key))||!/^stock:us:[A-Z0-9.-]+$/.test(String(input.instrument||''))||!/^[a-f0-9-]{36}$/.test(String(input.requestId||'')))throw Error('公司与宏观研究市场、规范标的或请求ID无效');
    const asOf=stamp(input.asOf);
    if(!Number.isFinite(asOf)||asOf>this.now())throw Error('研究截止时间无效或来自未来');
    if(!Array.isArray(input.evidenceRefs)||input.evidenceRefs.length<1||input.evidenceRefs.length>20||new Set(input.evidenceRefs).size!==input.evidenceRefs.length)throw Error('请选择1–20份不同且明确的证据快照');
    if(!Array.isArray(input.hypotheses)||input.hypotheses.length<1||input.hypotheses.length>20)throw Error('需要1–20条研究假设');
    if(input.scenarios!==undefined&&(!Array.isArray(input.scenarios)||input.scenarios.length>12))throw Error('估值情景最多12组');
    const evidence=input.evidenceRefs.map(id=>{
      const item=this.deps.evidence(id);
      if(!item||item.id!==id||!verifyEvidenceSnapshotHash(item)||item.market!=='stocks'||item.instrument!==input.instrument||stamp(item.fetchedAt)>asOf||stamp(item.observedAt)>asOf)throw Error('证据不存在、Hash无效、市场/标的不一致或来自所选时点之后');
      return item;
    }).sort((left,right)=>stamp(left.fetchedAt)-stamp(right.fetchedAt)||left.id.localeCompare(right.id));
    const refs=new Set(input.evidenceRefs);
    const hypotheses=input.hypotheses.map((hypothesis,index)=>{
      if(!hypothesis||Object.keys(hypothesis).some(key=>!['statement','relation','evidenceRefs'].includes(key))||!['observed','associated','causal','scenario'].includes(hypothesis.relation)||!Array.isArray(hypothesis.evidenceRefs)||hypothesis.evidenceRefs.length<1||hypothesis.evidenceRefs.length>20||hypothesis.evidenceRefs.some(ref=>!refs.has(ref)))throw Error(`第${index+1}条假设字段、关系或证据引用无效`);
      const evidenceStatus=hypothesis.evidenceRefs.length?'supported':'missing';
      const inferenceClass=hypothesis.relation==='observed'?'direct-observation':hypothesis.relation==='associated'?'association-only':hypothesis.relation==='causal'?'causal-not-established':'scenario-assumption';
      return {...hypothesis,statement:clean(hypothesis.statement,'假设内容'),evidenceRefs:[...new Set(hypothesis.evidenceRefs)],evidenceStatus:evidenceStatus as 'supported'|'missing',inferenceClass:inferenceClass as 'direct-observation'|'association-only'|'causal-not-established'|'scenario-assumption',reason:hypothesis.relation==='causal'?'固定快照只能证明共同变化或先后关系；缺少可识别机制和反事实证据，不能自动建立因果':hypothesis.relation==='associated'?'仅报告证据中的共同变化，不推断原因':hypothesis.relation==='scenario'?'这是用户假设情景，不作为已观察事实':'仅引用当时已获得的固定证据；内容真实性仍受来源证据边界约束'};
    });
    const revisions=evidence.slice(1).map((after,index)=>{
      const before=evidence[index],fields=new Set([...Object.keys(before.fields),...Object.keys(after.fields)]),changes=[...fields].filter(field=>digest(before.fields[field])!==digest(after.fields[field])).sort().map(field=>({field,before:{present:before.fields[field]!==undefined&&before.fields[field]!==null,value:before.fields[field]??null},after:{present:after.fields[field]!==undefined&&after.fields[field]!==null,value:after.fields[field]??null}}));
      return {before:before.id,after:after.id,changes,status:'comparable' as const,reason:before.workspace===after.workspace&&before.source.id===after.source.id?'同来源与工作区快照；字段差异只说明保存内容不同，不自动解释原因':'来源或工作区不同；可显示字段差异，但不能归因为修订'};
    });
    const evidenceById=new Map(evidence.map(item=>[item.id,item]));
    const scenarios=(input.scenarios||[]).map((scenario,index)=>{
      if(!scenario||Object.keys(scenario).some(key=>!['id','label','evidenceRef','baseField','growthPct','years','operatingMarginPct','multiple'].includes(key)))throw Error(`第${index+1}组估值情景字段无效`);
      const id=clean(scenario.id,'情景ID',100),label=clean(scenario.label,'情景名称',200),baseField=clean(scenario.baseField,'基础字段',120),source=evidenceById.get(String(scenario.evidenceRef));
      const assumptions={growthPct:finite(scenario.growthPct)?scenario.growthPct:null,years:Number.isSafeInteger(scenario.years)&&scenario.years>=0&&scenario.years<=20?scenario.years:null,operatingMarginPct:finite(scenario.operatingMarginPct)?scenario.operatingMarginPct:null,multiple:finite(scenario.multiple)&&scenario.multiple>0?scenario.multiple:null};
      const raw=source?.fields[baseField],baseValue=finite(raw)?raw:null;
      const valid=baseValue!==null&&assumptions.growthPct!==null&&Math.abs(assumptions.growthPct)<=200&&assumptions.years!==null&&assumptions.operatingMarginPct!==null&&assumptions.operatingMarginPct>=-100&&assumptions.operatingMarginPct<=200&&assumptions.multiple!==null&&assumptions.multiple<=200;
      if(!valid)return {id,label,status:'missing' as const,evidenceRef:String(scenario.evidenceRef||''),baseField,baseValue,projectedValue:null,modeledEquityValue:null,assumptions,reason:'基础字段不是有限数值，或增长、年限、利润率、倍数假设缺失/超出支持范围；不生成估值结果'};
      const projectedValue=baseValue*Math.pow(1+assumptions.growthPct!/100,assumptions.years!),modeledEquityValue=projectedValue*assumptions.operatingMarginPct!/100*assumptions.multiple!;
      if(!Number.isFinite(projectedValue)||!Number.isFinite(modeledEquityValue))return {id,label,status:'missing' as const,evidenceRef:source!.id,baseField,baseValue,projectedValue:null,modeledEquityValue:null,assumptions,reason:'计算结果溢出，不发布估值'};
      return {id,label,status:'calculated' as const,evidenceRef:source!.id,baseField,baseValue,projectedValue,modeledEquityValue,assumptions,reason:'服务端按明确增长、年限、利润率和倍数假设计算；这是情景模型输出，不是目标价或事实预测'};
    });
    const base={market:'stocks' as const,instrument:input.instrument,asOf:new Date(asOf).toISOString(),evidenceRefs:input.evidenceRefs,facts:evidence.map(item=>({id:item.id,source:item.source.name,observedAt:item.observedAt,fetchedAt:item.fetchedAt,dataStatus:item.dataStatus,fields:structuredClone(item.fields)})),revisions,hypotheses,scenarios,
      coverage:{evidence:evidence.length,hypotheses:hypotheses.length,supportedHypotheses:hypotheses.filter(item=>item.evidenceStatus==='supported').length,scenarios:scenarios.length,calculatedScenarios:scenarios.filter(item=>item.status==='calculated').length,revisionPairs:revisions.length},
      model:'evidence-only-company-macro-v1' as const,executionEnabled:false as const,modelCalls:0 as const,ordersCreated:0 as const,
      reason:'只使用明确选择且当时已获得的保存证据；修订差异、关联、因果和估值情景分开标记，缺失证据不回填'};
    const result:CompanyMacroResearchResult={...base,contentHash:digest(base)};
    const id='company_research_'+digest(input.requestId),requestHash=digest(input),old=this.state.get<StoredRow>('company-macro-research:'+id);
    if(old){if(old.requestHash!==requestHash)throw Error('请求ID已绑定另一公司与宏观研究');return this.view(id);}
    if(this.index().length>=100)throw Error('公司与宏观研究已达100项，旧记录保留');
    return this.state.transaction(()=>{
      const duplicate=this.state.get<StoredRow>('company-macro-research:'+id);if(duplicate){if(duplicate.requestHash!==requestHash)throw Error('请求ID已绑定另一公司与宏观研究');return this.view(id);}
      const row:StoredRow={id,requestHash,input:structuredClone(input),evidence:structuredClone(evidence),result,resultHash:digest(result),status:'preview',revision:0,createdAt:this.now(),updatedAt:this.now()};
      this.state.set('company-macro-research:index:v1',[...this.index(),id]);
      return this.save(row,'preview');
    });
  }
  confirm(id:string,revision:number,hash:string,ack:boolean){
    return this.state.transaction(()=>{
      const row=this.read(id);
      if(row.status!=='preview'||row.revision!==revision||row.resultHash!==hash||ack!==true)throw Error('需要有效预览、结果Hash及明确确认');
      row.status='confirmed';return this.save(row,'confirm');
    });
  }
  stop(id:string,revision:number){
    return this.state.transaction(()=>{const row=this.read(id);if(row.revision!==revision||row.status==='stopped')throw Error('研究版本或状态不允许停止');row.status='stopped';return this.save(row,'stop');});
  }
}
