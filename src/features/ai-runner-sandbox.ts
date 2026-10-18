import { createHash } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import type { RunnerDecisionObservation } from './runner-execution-evidence';
import type { AiRunnerModelEvidence } from './ai-runner-model';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface SandboxConfig {runnerId:string;market:string;model:string;promptVersion:string;name:string;decisionIds:string[]}
interface SandboxRound {decisionId:string;at:string;instrument:string;snapshotHash:string;modelRequestRef:string;modelEvidence:AiRunnerModelEvidence}
interface Sandbox {id:string;runnerId:string;market:string;model:string;promptVersion:string;name:string;createdAt:string;rounds:SandboxRound[];modelCalls:0;orderChanges:0;readOnly:true;hash:string}

/** Frozen saved-output research only. No runtime/model client or account mutator is a dependency. */
export class AiRunnerSandboxStore {
  constructor(private readonly store:Pick<SQLiteStateStore,'get'|'set'|'transaction'>){}
  list(runnerId:string,market:string):Sandbox[] {
    const rows=this.store.get<Sandbox[]>('ai-runner:research-sandboxes');
    if(!Array.isArray(rows))return [];
    return rows.slice(0,100).filter(row=>{
      if(!row||row.runnerId!==runnerId||row.market!==market)return false;
      const {hash:checksum,...content}=row;return checksum===hash(content)&&row.readOnly===true&&row.modelCalls===0&&row.orderChanges===0;
    }).map(row=>structuredClone(row));
  }
  create(config:SandboxConfig,observations:RunnerDecisionObservation[],now=new Date().toISOString()):Sandbox {
    if(!config||Object.keys(config).some(key=>!['runnerId','market','model','promptVersion','name','decisionIds'].includes(key))||typeof config.runnerId!=='string'||!config.runnerId||!['stocks','options','crypto','prediction'].includes(config.market)||typeof config.model!=='string'||!config.model.trim()||config.model.length>160||/^openrouter\/(free|auto)$/i.test(config.model))throw Error('沙箱需要明确固定模型，不允许动态路由或改变跑单配置');
    if(typeof config.promptVersion!=='string'||!config.promptVersion||config.promptVersion.length>100||typeof config.name!=='string'||!config.name.trim()||config.name.length>120||!Array.isArray(config.decisionIds)||config.decisionIds.length<1||config.decisionIds.length>20||new Set(config.decisionIds).size!==config.decisionIds.length||!Number.isFinite(Date.parse(now)))throw Error('沙箱名称、提示词版本或决策引用无效');
    let promptHash:string|undefined,returnedModel:string|undefined;
    const rounds:SandboxRound[]=config.decisionIds.map(id=>{
      const matching=observations.filter(row=>row.runnerId===config.runnerId&&row.accountId==='ai-runner:'+config.runnerId&&row.decision.id===id&&row.decision.runnerId===config.runnerId&&row.decision.market===config.market);
      if(matching.length!==1)throw Error('决策观察证据未唯一关联当前跑单和市场');
      const {decision:d,snapshot}=matching[0],e=d.modelEvidence;
      if(!e||!d.modelRequestRef||d.modelCallStatus!=='success'||d.modelVersion!==e.returnedModel||e.requestedModel!==config.model||e.promptVersion!==config.promptVersion||!Number.isFinite(Date.parse(d.at))||Date.parse(d.at)>Date.parse(now)||snapshot.hash!==d.snapshotHash||snapshot.id!=='rs_'+d.snapshotHash||snapshot.market!==config.market||snapshot.payload.instrument!==d.instrument||e.input?.market!==config.market||e.output?.market&&e.output.market!==config.market||e.output?.instrument!==d.instrument||e.inputHash!==hash(e.input)||e.outputHash!==hash(e.output)||!/^[a-f0-9]{64}$/.test(e.promptHash)||JSON.stringify(e).length>80000)throw Error('原始模型输入/输出、版本、时点或快照证据无法核验');
      if(promptHash&&promptHash!==e.promptHash||returnedModel&&returnedModel!==e.returnedModel)throw Error('沙箱不能混入不同提示词Hash或实际模型版本');
      promptHash=e.promptHash;returnedModel=e.returnedModel;
      return {decisionId:d.id,at:d.at,instrument:d.instrument,snapshotHash:d.snapshotHash!,modelRequestRef:d.modelRequestRef,modelEvidence:structuredClone(e)};
    });
    const frozen={runnerId:config.runnerId,market:config.market,model:config.model,promptVersion:config.promptVersion,name:config.name.trim(),rounds};
    const id='ais_'+hash(frozen);
    return this.store.transaction(()=>{
      const key='ai-runner:research-sandboxes',rows=this.store.get<Sandbox[]>(key)||[];
      if(!Array.isArray(rows))throw Error('沙箱存储格式损坏，不覆盖旧证据');
      const prior=this.list(config.runnerId,config.market).find(row=>row.id===id);if(prior)return prior;
      const base={id,...frozen,createdAt:now,modelCalls:0 as const,orderChanges:0 as const,readOnly:true as const};
      const saved:Sandbox={...base,hash:hash(base)};
      if(rows.length>=100||JSON.stringify([saved,...rows]).length>10000000)throw Error('沙箱归档容量已满，保留原件，不自动删除');
      this.store.set(key,[saved,...rows]);return structuredClone(saved);
    });
  }
}
