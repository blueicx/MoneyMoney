import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import {verifyEvidenceSnapshotHash,type EvidenceSnapshot} from './decision-intelligence';
import type {MarketId} from './research-contracts';

type State=Pick<SQLiteStateStore,'get'|'appendAudit'|'health'>;
export interface ResearchAssistantInput {
  mode:'evidence'|'model';
  requestId:string;
  market:MarketId;
  instrument:string;
  asOf:string;
  question:string;
  evidenceRefs:string[];
  model?:{provider:'openrouter';model:string;maxCostUsd:number;feeAcknowledged:boolean};
}
type ModelConfig=NonNullable<ResearchAssistantInput['model']>;
interface ModelResult{answer:string;actualModel:string;costUsd:number}

interface Dependencies {
  evidence:(id:string)=>EvidenceSnapshot|null;
  model?:(input:{question:string;evidence:EvidenceSnapshot[];model:ModelConfig},signal:AbortSignal)=>Promise<ModelResult>;
}

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp=(value:unknown)=>Date.parse(String(value));

/** Default path is deterministic evidence extraction; paid-model execution is opt-in and injected. */
export class EvidenceResearchAssistant {
  constructor(private state:State,private deps:Dependencies,private now=Date.now){}
  async run(input:ResearchAssistantInput){
    if(!this.state.health.ok)throw Error('研究助手审计目录不可用');
    const allowed=['mode','requestId','market','instrument','asOf','question','evidenceRefs','model'];
    if(!input||Object.keys(input).some(key=>!allowed.includes(key))||!['stocks','crypto','options','prediction'].includes(input.market)||!['evidence','model'].includes(input.mode)||!/^[a-f0-9-]{36}$/.test(String(input.requestId||'')))throw Error('研究助手模式、请求ID、市场或字段无效');
    const asOf=stamp(input.asOf);
    if(!Number.isFinite(asOf)||asOf>this.now()||typeof input.question!=='string'||!input.question.trim()||input.question.length>2000)throw Error('研究问题或截止时间无效');
    if(!Array.isArray(input.evidenceRefs)||input.evidenceRefs.length<1||input.evidenceRefs.length>20||new Set(input.evidenceRefs).size!==input.evidenceRefs.length)throw Error('请选择1–20份不同的明确证据引用');
    const evidence=input.evidenceRefs.map(id=>{
      const item=this.deps.evidence(id);
      if(!item||item.id!==id||!verifyEvidenceSnapshotHash(item)||item.market!==input.market||item.instrument!==input.instrument||stamp(item.fetchedAt)>asOf||stamp(item.observedAt)>asOf)throw Error('证据不存在、Hash/市场/标的不一致或来自未来');
      return item;
    });
    const requestHash=digest(input),id='assistant_'+digest(input.requestId);
    if(input.mode==='model'){
      const model=input.model;
      if(!model||Object.keys(model).some(key=>!['provider','model','maxCostUsd','feeAcknowledged'].includes(key))||model.provider!=='openrouter'||!model.model?.trim()||model.feeAcknowledged!==true||!Number.isFinite(model.maxCostUsd)||model.maxCostUsd<=0||model.maxCostUsd>5||!this.deps.model){
        this.state.appendAudit({id:randomUUID(),at:new Date(this.now()).toISOString(),action:'research-assistant-model-blocked',detail:JSON.stringify({id,requestHash,reason:!this.deps.model?'模型执行未配置':'模型选择、费用确认或限额不足'})});
        throw Error(!this.deps.model?'模型执行未配置；默认证据模式不会调用模型':'模型选择、费用确认或限额无效');
      }
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
      try{
        const generated=await this.deps.model({question:input.question.trim(),evidence,model},controller.signal);
        if(typeof generated.answer!=='string'||!generated.answer.trim()||generated.answer.length>12000||!Number.isFinite(generated.costUsd)||generated.costUsd<0||generated.costUsd>model.maxCostUsd)throw Error('模型返回内容或费用超出已确认限额');
        const result={id,mode:'model' as const,market:input.market,instrument:input.instrument,asOf:new Date(asOf).toISOString(),question:input.question.trim(),evidenceRefs:input.evidenceRefs,answer:generated.answer.trim(),actualModel:generated.actualModel,costUsd:generated.costUsd,modelCalls:1,budget:{maxCostUsd:model.maxCostUsd,feeAcknowledged:true},executionEnabled:false,ordersCreated:0,reason:'显式确认限额的模型摘要；证据引用固定，失败和费用写入审计'};
        const output={...result,contentHash:digest(result)};
        this.state.appendAudit({id:randomUUID(),at:new Date(this.now()).toISOString(),action:'research-assistant-model-completed',detail:JSON.stringify({id,requestHash,actualModel:generated.actualModel,costUsd:generated.costUsd,contentHash:output.contentHash})});
        return output;
      }catch(error){
        this.state.appendAudit({id:randomUUID(),at:new Date(this.now()).toISOString(),action:'research-assistant-model-failed',detail:JSON.stringify({id,requestHash,reason:error instanceof Error?error.message:'模型失败'})});
        throw error;
      }finally{clearTimeout(timer);}
    }
    if(input.model!==undefined)throw Error('证据模式不接受模型参数');
    const facts=evidence.map(item=>({evidenceRef:item.id,source:item.source.name,observedAt:item.observedAt,fetchedAt:item.fetchedAt,dataStatus:item.dataStatus,fields:item.fields}));
    const comparisons=evidence.slice(1).map((after,index)=>{
      const before=evidence[index],fields=new Set([...Object.keys(before.fields),...Object.keys(after.fields)]);
      const changes=[...fields].filter(field=>digest(before.fields[field])!==digest(after.fields[field])).map(field=>({field,before:before.fields[field]??null,after:after.fields[field]??null}));
      return {before:before.id,after:after.id,changes,status:(changes.length?'changed':'unchanged') as 'changed'|'unchanged'};
    });
    const result={id,mode:'evidence' as const,market:input.market,instrument:input.instrument,asOf:new Date(asOf).toISOString(),question:input.question.trim(),evidenceRefs:input.evidenceRefs,facts,comparisons,
      answer:facts.length?`基于 ${facts.length} 份明确证据：${facts.map(item=>`${item.source}（${item.observedAt}，${item.dataStatus}）`).join('；')}。字段变化只按保存内容列出，不推断因果。`:'没有可用证据',
      limitations:['摘要只读取显式引用，不代表完整信息环境','来源抓取时间不证明最早公开发布时间','共同变化不自动建立因果关系','没有引用、历史或交易时段证据时保持缺失'],
      modelCalls:0,estimatedCostUsd:0,executionEnabled:false,ordersCreated:0,reason:'默认证据模式；未调用模型、采集、通知或订单'};
    const output={...result,contentHash:digest(result)};
    this.state.appendAudit({id:randomUUID(),at:new Date(this.now()).toISOString(),action:'research-assistant-evidence',detail:JSON.stringify({id,requestHash,contentHash:output.contentHash,modelCalls:0})});
    return output;
  }
}
