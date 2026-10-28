import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import {createEvidenceRef,type EvidenceRef} from './evidence-contract';

type State=Pick<SQLiteStateStore,'get'|'set'|'health'|'appendAudit'|'transaction'>;
type NodeKind='company'|'industry'|'fund'|'person'|'event';
type EdgeKind='supplier'|'customer'|'shareholder'|'industry-membership'|'event-exposure';
type EdgeBasis='source-assertion'|'research-inference';
type RecordStatus='preview'|'confirmed';

export interface CompanyGraphNodeInput {
  id:string;
  kind:NodeKind;
  label:string;
  instrument?:string;
  description?:string;
}

export interface CompanyGraphEdgeInput {
  id:string;
  from:string;
  to:string;
  kind:EdgeKind;
  basis:EdgeBasis;
  evidence:EvidenceRef;
  effectiveFrom:string;
  effectiveTo?:string;
  exposurePct?:number;
}

export interface CompanyIndustryGraphInput {
  market:'stocks';
  requestId:string;
  asOf:string;
  nodes:CompanyGraphNodeInput[];
  edges:CompanyGraphEdgeInput[];
  note?:string;
}

interface StoredGraph {
  id:string;
  requestHash:string;
  manifest:CompanyIndustryGraphInput;
  manifestHash:string;
  result:CompanyIndustryGraphResult;
  contentHash:string;
  status:RecordStatus;
  revision:number;
  createdAt:number;
  updatedAt:number;
  confirmedBy?:string;
  confirmedAt?:string;
  confirmationKey?:string;
  confirmationHash?:string;
}

interface GraphEdgeResult {
  id:string;
  factStatus:'supported'|'inferred'|'unverified';
  eligibleForConcentration:boolean;
  reason:string;
}

export interface CompanyIndustryGraphResult {
  market:'stocks';
  asOf:string;
  summary:{
    companies:number;
    industries:number;
    events:number;
    edges:number;
    supportedEdges:number;
    inferredEdges:number;
    unverifiedEdges:number;
    edgesWithExposure:number;
  };
  edges:GraphEdgeResult[];
  model:'company-industry-relations-v1';
  executionEnabled:false;
  modelCalls:0;
  ordersCreated:0;
  reason:string;
  contentHash:string;
}

export interface CompanyIndustryGraphView extends CompanyIndustryGraphResult {
  id:string;
  status:RecordStatus;
  revision:number;
  manifestHash:string;
  contentHash:string;
  createdAt:string;
  updatedAt:string;
  confirmedBy:string|null;
  confirmedAt:string|null;
  manifest:CompanyIndustryGraphInput;
}

export interface CompanyGraphConcentrationInput {
  asOf:string;
  maxHops?:1|2|3;
  positions:Array<{instrument:string;weightPct:number}>;
}

interface ExposurePath {
  from:string;
  edgeId:string;
  kind:EdgeKind;
  basis:EdgeBasis;
  exposurePct:number;
  path:string[];
}

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nodeKinds:NodeKind[]=['company','industry','fund','person','event'];
const edgeKinds:EdgeKind[]=['supplier','customer','shareholder','industry-membership','event-exposure'];
const stockPattern=/^stock:us:[A-Z0-9.-]{1,20}$/;
const nodePattern=/^[A-Za-z0-9][A-Za-z0-9:_-]{2,159}$/;
const edgePattern=/^[a-z0-9][a-z0-9:_-]{2,159}$/;
const requestIdPattern=/^[A-Za-z0-9._:-]{8,128}$/;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const timestamp=(value:unknown,label:string)=>{
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||!/(?:Z|[+-]\d\d:\d\d)$/i.test(value))throw Error(`${label}必须包含有效时区`);
  return new Date(Date.parse(value)).toISOString();
};
const text=(value:unknown,label:string,max:number)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}不能为空或超过${max}字`);
  return value.trim();
};
const optionalText=(value:unknown,label:string,max:number)=>{
  if(value===undefined||value===null||value==='')return undefined;
  return text(value,label,max);
};

function relationFacts(edge:CompanyGraphEdgeInput,source:CompanyGraphNodeInput,target:CompanyGraphNodeInput):GraphEdgeResult{
  const factStatus=edge.basis==='research-inference'?'inferred':edge.evidence.coverage==='complete'?'supported':'unverified';
  const eligibleForConcentration=factStatus==='supported'&&finite(edge.exposurePct)&&['supplier','customer','shareholder','industry-membership'].includes(edge.kind);
  const reason=factStatus==='inferred'
    ? '研究推测关系只用于提出复查问题，不当作已披露事实，也不参与集中度传播'
    : factStatus==='unverified'
      ? '关系证据不完整，只保留为待核验关系，不参与集中度传播'
      : eligibleForConcentration
        ? '来源完整且管理员确认；按显式暴露比例参与可追溯的间接集中度传播'
        : edge.exposurePct===undefined
          ? `${source.label}→${target.label} 的关系已确认，但缺少可核验暴露比例；只显示缺口`
          : '关系已确认，但该关系类型不用于集中度传播';
  return {id:edge.id,factStatus,eligibleForConcentration,reason};
}

/** Versioned evidence graph for company, supply-chain and ownership relationships. */
export class CompanyIndustryGraphStore {
  constructor(private state:State,private now=Date.now){}

  private index(){
    if(!this.state.health.ok)throw Error('公司与产业关系图目录不可用');
    const rows=this.state.get<string[]>('company-industry-graph:index:v1')||[];
    if(!Array.isArray(rows)||rows.length>200||rows.some(id=>!/^cgraph_[a-f0-9]{64}$/.test(id)))throw Error('公司与产业关系图目录不可核验');
    return rows;
  }

  private read(id:string){
    this.index();
    if(!/^cgraph_[a-f0-9]{64}$/.test(id))throw Error('公司与产业关系图ID无效');
    const row=this.state.get<StoredGraph>('company-industry-graph:'+id);
    if(!row||row.id!==id||digest(row.manifest)!==row.manifestHash){throw Error('公司与产业关系图清单Hash不可核验');}
    const {contentHash,...payload}=row.result;
    if(digest(payload)!==contentHash||digest(payload)!==row.contentHash)throw Error('公司与产业关系图结果Hash不可核验');
    return structuredClone(row);
  }

  private view(id:string):CompanyIndustryGraphView{
    const row=this.read(id);
    return {
      ...row.result,
      id:row.id,
      status:row.status,
      revision:row.revision,
      manifestHash:row.manifestHash,
      contentHash:row.contentHash,
      createdAt:new Date(row.createdAt).toISOString(),
      updatedAt:new Date(row.updatedAt).toISOString(),
      confirmedBy:row.confirmedBy||null,
      confirmedAt:row.confirmedAt||null,
      manifest:row.manifest,
    };
  }

  private save(row:StoredGraph,action:string){
    row.revision++;
    row.updatedAt=this.now();
    this.state.set('company-industry-graph:'+row.id,row);
    this.state.appendAudit({
      id:randomUUID(),
      at:new Date(this.now()).toISOString(),
      action:'company-industry-graph-'+action,
      detail:JSON.stringify({id:row.id,revision:row.revision,contentHash:row.contentHash,manifestHash:row.manifestHash,status:row.status}),
    });
    return this.view(row.id);
  }

  list(instrument?:string,asOf?:string){
    if(instrument!==undefined&&!stockPattern.test(instrument))throw Error('关系图股票标的无效');
    const cutoff=asOf===undefined?this.now():Date.parse(asOf);
    if(!Number.isFinite(cutoff))throw Error('关系图截止时间无效');
    return this.index()
      .map(id=>this.read(id))
      .filter(row=>row.manifest.asOf<=new Date(cutoff).toISOString())
      .filter(row=>!instrument||row.manifest.nodes.some(node=>node.instrument===instrument))
      .sort((left,right)=>right.manifest.asOf.localeCompare(left.manifest.asOf)||right.updatedAt-left.updatedAt)
      .map(row=>({
        id:row.id,
        asOf:row.manifest.asOf,
        status:row.status,
        revision:row.revision,
        contentHash:row.contentHash,
        manifestHash:row.manifestHash,
        instruments:[...new Set(row.manifest.nodes.flatMap(node=>node.instrument?[node.instrument]:[]))],
        summary:row.result.summary,
        confirmedAt:row.confirmedAt||null,
        updatedAt:new Date(row.updatedAt).toISOString(),
      }));
  }

  get(id:string){return this.view(id);}

  preview(input:CompanyIndustryGraphInput){
    const allowed=['market','requestId','asOf','nodes','edges','note'];
    if(!input||Object.keys(input).some(key=>!allowed.includes(key))||input.market!=='stocks')throw Error('公司与产业关系图只接受股票市场和允许字段');
    if(!requestIdPattern.test(String(input.requestId||'')))throw Error('关系图请求ID无效');
    const asOf=timestamp(input.asOf,'关系图截止时间');
    if(Date.parse(asOf)>this.now())throw Error('关系图截止时间来自未来');
    if(!Array.isArray(input.nodes)||input.nodes.length<2||input.nodes.length>50)throw Error('关系图需要2–50个节点');
    if(!Array.isArray(input.edges)||input.edges.length<1||input.edges.length>100)throw Error('关系图需要1–100条关系');
    const nodes=input.nodes.map((node,index)=>{
      if(!node||Object.keys(node).some(key=>!['id','kind','label','instrument','description'].includes(key)))throw Error(`第${index+1}个节点包含未允许字段`);
      if(!nodePattern.test(String(node.id||''))||!nodeKinds.includes(node.kind))throw Error(`第${index+1}个节点ID或类型无效`);
      const instrument=node.instrument===undefined?undefined:String(node.instrument);
      if(instrument!==undefined&&!stockPattern.test(instrument))throw Error(`第${index+1}个节点股票身份无效`);
      return {
        id:node.id,
        kind:node.kind,
        label:text(node.label,'节点名称',200),
        ...(instrument?{instrument}:{}),
        ...(optionalText(node.description,'节点说明',1000)?{description:optionalText(node.description,'节点说明',1000)}:{}),
      };
    });
    if(new Set(nodes.map(node=>node.id)).size!==nodes.length)throw Error('关系图节点ID必须唯一');
    const instruments=nodes.flatMap(node=>node.instrument?[node.instrument]:[]);
    if(new Set(instruments).size!==instruments.length)throw Error('关系图同一股票身份只能绑定一个节点');
    const byNode=new Map(nodes.map(node=>[node.id,node]));
    const edges=input.edges.map((edge,index)=>{
      if(!edge||Object.keys(edge).some(key=>!['id','from','to','kind','basis','evidence','effectiveFrom','effectiveTo','exposurePct'].includes(key)))throw Error(`第${index+1}条关系包含未允许字段`);
      if(!edgePattern.test(String(edge.id||''))||!edgeKinds.includes(edge.kind)||!['source-assertion','research-inference'].includes(edge.basis))throw Error(`第${index+1}条关系ID、类型或依据无效`);
      if(!byNode.has(edge.from)||!byNode.has(edge.to)||edge.from===edge.to)throw Error(`第${index+1}条关系节点不存在或形成自环`);
      const effectiveFrom=timestamp(edge.effectiveFrom,`第${index+1}条关系生效时间`);
      const effectiveTo=edge.effectiveTo===undefined?undefined:timestamp(edge.effectiveTo,`第${index+1}条关系结束时间`);
      if(effectiveTo&&Date.parse(effectiveTo)<Date.parse(effectiveFrom))throw Error(`第${index+1}条关系结束时间早于生效时间`);
      const evidence=createEvidenceRef(edge.evidence);
      if(evidence.market!=='stocks')throw Error(`第${index+1}条关系证据必须是股票市场证据`);
      if([evidence.publishedAt,evidence.observedAt,evidence.fetchedAt].some(value=>value&&Date.parse(value)>Date.parse(asOf)))throw Error(`第${index+1}条关系证据晚于关系图截止时间`);
      const endpointInstruments=[byNode.get(edge.from)!.instrument,byNode.get(edge.to)!.instrument].filter(Boolean);
      if(evidence.instrument&&endpointInstruments.length&&!endpointInstruments.includes(evidence.instrument))throw Error(`第${index+1}条关系证据标的与节点身份不一致`);
      const exposurePct=edge.exposurePct===undefined?undefined:Number(edge.exposurePct);
      if(exposurePct!==undefined&&(!finite(exposurePct)||exposurePct<=0||exposurePct>100))throw Error(`第${index+1}条关系暴露比例必须在0–100%之间`);
      return {
        id:edge.id,
        from:edge.from,
        to:edge.to,
        kind:edge.kind,
        basis:edge.basis,
        evidence,
        effectiveFrom,
        ...(effectiveTo?{effectiveTo}:{}),
        ...(exposurePct!==undefined?{exposurePct}:{}),
      };
    });
    if(new Set(edges.map(edge=>edge.id)).size!==edges.length)throw Error('关系ID必须唯一');
    const note=optionalText(input.note,'关系图说明',2000);
    const manifest:CompanyIndustryGraphInput={market:'stocks',requestId:input.requestId,asOf,nodes,edges,...(note?{note}:{})};
    const edgeResults=edges.map(edge=>relationFacts(edge,byNode.get(edge.from)!,byNode.get(edge.to)!));
    const resultBase:Omit<CompanyIndustryGraphResult,'contentHash'> = {
      market:'stocks',
      asOf,
      summary:{
        companies:nodes.filter(node=>node.kind==='company').length,
        industries:nodes.filter(node=>node.kind==='industry').length,
        events:nodes.filter(node=>node.kind==='event').length,
        edges:edges.length,
        supportedEdges:edgeResults.filter(edge=>edge.factStatus==='supported').length,
        inferredEdges:edgeResults.filter(edge=>edge.factStatus==='inferred').length,
        unverifiedEdges:edgeResults.filter(edge=>edge.factStatus==='unverified').length,
        edgesWithExposure:edges.filter(edge=>edge.exposurePct!==undefined).length,
      },
      edges:edgeResults,
      model:'company-industry-relations-v1',
      executionEnabled:false,
      modelCalls:0,
      ordersCreated:0,
      reason:'关系、推测、证据覆盖和暴露比例分别保存；只有来源完整的已披露关系及明确暴露比例可用于间接集中度，人工确认不会把推测升级为事实',
    };
    const result:CompanyIndustryGraphResult={...resultBase,contentHash:digest(resultBase)};
    const id='cgraph_'+digest(input.requestId),manifestHash=digest(manifest),requestHash=digest(manifest);
    const old=this.state.get<StoredGraph>('company-industry-graph:'+id);
    if(old){
      const existing=this.read(id);
      if(existing.requestHash!==requestHash)throw Error('请求ID已绑定另一关系图清单');
      return this.view(id);
    }
    if(this.index().length>=200)throw Error('公司与产业关系图已达200项，旧记录保留');
    return this.state.transaction(()=>{
      const duplicate=this.state.get<StoredGraph>('company-industry-graph:'+id);
      if(duplicate){
        const existing=this.read(id);
        if(existing.requestHash!==requestHash)throw Error('请求ID已绑定另一关系图清单');
        return this.view(id);
      }
      const now=this.now(),row:StoredGraph={id,requestHash,manifest,manifestHash,result,contentHash:result.contentHash,status:'preview',revision:0,createdAt:now,updatedAt:now};
      this.state.set('company-industry-graph:index:v1',[...this.index(),id]);
      return this.save(row,'preview');
    });
  }

  confirm(id:string,input:{expectedVersion:number;contentHash:string;acknowledge:boolean;confirmationKey:string;actor:string}){
    return this.state.transaction(()=>{
      const row=this.read(id),confirmationHash=digest({id,expectedVersion:input.expectedVersion,contentHash:input.contentHash,acknowledge:input.acknowledge});
      if(row.confirmationKey===input.confirmationKey){
        if(row.confirmationHash!==confirmationHash)throw Error('确认幂等键已用于不同关系图确认');
        return this.view(id);
      }
      if(row.status!=='preview'||row.revision!==input.expectedVersion||row.contentHash!==input.contentHash||input.acknowledge!==true)throw Error('需要有效预览版本、结果Hash及明确确认');
      row.status='confirmed';
      row.confirmedBy=input.actor;
      row.confirmedAt=new Date(this.now()).toISOString();
      row.confirmationKey=input.confirmationKey;
      row.confirmationHash=confirmationHash;
      return this.save(row,'confirm');
    });
  }

  concentration(input:CompanyGraphConcentrationInput){
    const asOf=timestamp(input?.asOf,'集中度截止时间');
    if(Date.parse(asOf)>this.now())throw Error('集中度截止时间来自未来');
    if(!Array.isArray(input.positions)||input.positions.length<1||input.positions.length>20)throw Error('集中度需要1–20个组合头寸');
    if(new Set(input.positions.map(row=>row.instrument)).size!==input.positions.length)throw Error('组合头寸标的不重复');
    const positions=input.positions.map((row,index)=>{
      if(!row||Object.keys(row).some(key=>!['instrument','weightPct'].includes(key))||!stockPattern.test(String(row.instrument||''))||!finite(row.weightPct)||row.weightPct<=0||row.weightPct>100)throw Error(`第${index+1}个头寸标的或权重无效`);
      return {instrument:row.instrument,weightPct:row.weightPct};
    });
    if(Math.abs(positions.reduce((sum,row)=>sum+row.weightPct,0)-100)>1e-6)throw Error('组合权重必须合计100%');
    const maxHops=input.maxHops??2;
    if(![1,2,3].includes(maxHops))throw Error('关系传播最多1–3跳');
    const records=this.index().map(id=>this.read(id)).filter(row=>row.status==='confirmed'&&row.manifest.asOf<=asOf&&(!row.confirmedAt||row.confirmedAt<=asOf)).sort((left,right)=>left.manifest.asOf.localeCompare(right.manifest.asOf)||String(left.confirmedAt).localeCompare(String(right.confirmedAt)));
    const nodeMap=new Map<string,CompanyGraphNodeInput>();
    const edgeMap=new Map<string,CompanyGraphEdgeInput>();
    for(const record of records){
      for(const node of record.manifest.nodes)nodeMap.set(node.id,node);
      for(const edge of record.manifest.edges){
        const effective=Date.parse(edge.effectiveFrom)<=Date.parse(asOf)&&(!edge.effectiveTo||Date.parse(edge.effectiveTo)>=Date.parse(asOf));
        if(effective)edgeMap.set(edge.id,edge);
        else edgeMap.delete(edge.id);
      }
    }
    const outgoing=new Map<string,CompanyGraphEdgeInput[]>();
    for(const edge of edgeMap.values())outgoing.set(edge.from,[...(outgoing.get(edge.from)||[]),edge]);
    const nodesByInstrument=new Map<string,CompanyGraphNodeInput[]>();
    for(const node of nodeMap.values())if(node.instrument)nodesByInstrument.set(node.instrument,[...(nodesByInstrument.get(node.instrument)||[]),node]);
    const directByNode=new Map<string,{nodeId:string;instrument:string;weightPct:number}>();
    const direct=positions.map(position=>{
      const nodes=nodesByInstrument.get(position.instrument)||[];
      if(nodes.length!==1)return {...position,nodeId:null as string|null,status:'missing' as const,reason:nodes.length?'该标的同时关联多个关系图节点，拒绝猜测组合身份':'截止时点没有已确认关系图节点绑定该标的'};
      const node=nodes[0];
      directByNode.set(node.id,{nodeId:node.id,instrument:position.instrument,weightPct:position.weightPct});
      return {...position,nodeId:node.id,status:'mapped' as const,reason:'该头寸通过已确认关系图中的明确股票身份定位'};
    });
    const paths:Array<{nodeId:string;weightPct:number;path:ExposurePath[]}>= [];
    const exclusions:Array<{edgeId:string;nodeId:string;reason:string}>=[];
    for(const source of directByNode.values()){
      type QueueItem={nodeId:string;depth:number;weight:number;path:string[];steps:ExposurePath[]};
      const queue:QueueItem[]=[{nodeId:source.nodeId,depth:0,weight:source.weightPct,path:[source.nodeId],steps:[]}];
      while(queue.length){
        const current=queue.shift()!;
        if(current.depth>=maxHops)continue;
        for(const edge of outgoing.get(current.nodeId)||[]){
          const fact=relationFacts(edge,nodeMap.get(edge.from)!,nodeMap.get(edge.to)!);
          if(!fact.eligibleForConcentration){
            exclusions.push({edgeId:edge.id,nodeId:current.nodeId,reason:fact.reason});
            continue;
          }
          if(current.path.includes(edge.to)){
            exclusions.push({edgeId:edge.id,nodeId:current.nodeId,reason:'关系路径形成环路，未重复累计'});
            continue;
          }
          const weight=current.weight*edge.exposurePct!/100;
          if(!(weight>0)||!Number.isFinite(weight))continue;
          const step:ExposurePath={from:edge.from,edgeId:edge.id,kind:edge.kind,basis:edge.basis,exposurePct:edge.exposurePct!,path:[...current.path,edge.to]};
          const nextSteps=[...current.steps,step],nextPath=[...current.path,edge.to];
          paths.push({nodeId:edge.to,weightPct:weight,path:nextSteps});
          queue.push({nodeId:edge.to,depth:current.depth+1,weight,path:nextPath,steps:nextSteps});
        }
      }
    }
    const indirectExposures=[...new Set(paths.map(row=>row.nodeId))].map(nodeId=>{
      const node=nodeMap.get(nodeId),rows=paths.filter(row=>row.nodeId===nodeId);
      return {
        nodeId,
        label:node?.label||nodeId,
        kind:node?.kind||'company',
        instrument:node?.instrument||null,
        maxPathWeightPct:Math.max(...rows.map(row=>row.weightPct)),
        upperBoundWeightPct:rows.reduce((sum,row)=>sum+row.weightPct,0),
        paths:rows.sort((left,right)=>right.weightPct-left.weightPct).slice(0,20).map(row=>row.path),
      };
    }).sort((left,right)=>right.maxPathWeightPct-left.maxPathWeightPct||right.upperBoundWeightPct-left.upperBoundWeightPct);
    const directTotal=positions.reduce((sum,row)=>sum+row.weightPct,0);
    const lowerNodeWeights=new Map<string,number>();
    for(const row of direct)if(row.nodeId)lowerNodeWeights.set(row.nodeId,row.weightPct);
    for(const row of indirectExposures)lowerNodeWeights.set(row.nodeId,(lowerNodeWeights.get(row.nodeId)||0)+row.maxPathWeightPct);
    const hhiLower=([...lowerNodeWeights.values()].reduce((sum,value)=>sum+(value/100)**2,0));
    const upperNodeWeights=new Map(lowerNodeWeights);
    for(const row of indirectExposures)upperNodeWeights.set(row.nodeId,(upperNodeWeights.get(row.nodeId)||0)+(row.upperBoundWeightPct-row.maxPathWeightPct));
    const hhiUpper=([...upperNodeWeights.values()].reduce((sum,value)=>sum+(value/100)**2,0));
    const uniqueExclusions=[...new Map(exclusions.map(row=>[row.edgeId+'\0'+row.nodeId+'\0'+row.reason,row])).values()];
    const mapped=direct.filter(row=>row.status==='mapped').length;
    const incomplete=mapped<positions.length||uniqueExclusions.length>0;
    return {
      asOf,
      maxHops,
      status:records.length&&mapped?'calculated':records.length?'partial':'unavailable',
      direct,
      indirectExposures,
      aggregateExposure:{
        directWeightPct:directTotal,
        indirectUpperBoundWeightPct:indirectExposures.reduce((sum,row)=>sum+row.upperBoundWeightPct,0),
        hhiLower:Number(hhiLower.toFixed(12)),
        hhiUpper:Number(hhiUpper.toFixed(12)),
        depthLabel:`${maxHops}跳上限；同一节点多路径同时展示最大单路径值与上界合计，不用隐含相关性推算净额`,
      },
      coverage:{
        complete:!incomplete,
        records:records.length,
        mappedPositions:mapped,
        totalPositions:positions.length,
        activeEdges:edgeMap.size,
        exclusions:uniqueExclusions.slice(0,200),
      },
      reason:incomplete?'关系缺失、证据不足、暴露比例缺失或路径环路存在；HHI 与间接集中度只是已覆盖路径的可追溯区间，不是完整组合事实':'所有头寸和当前有效关系均有完整证据与显式暴露比例；HHI 仍是关系路径模型，不代表市场价格相关性',
      executionEnabled:false as const,
      ordersCreated:0 as const,
      modelCalls:0 as const,
    };
  }
}
