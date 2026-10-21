import { assertMarketContext, type MarketId } from './research-contracts';
import { researchRepository } from './research-repository';

export type CandidateStatus = 'draft' | 'pending' | 'candidate' | 'approved' | 'rejected';
interface Metrics { oosReturnPct?:number;trades?:number }
export interface CandidateEvidence {passed:boolean;contentHash:string;metrics:Metrics;reasons:string[]}
type CandidateAudit = {at:number;action:string;evidenceHash?:string;reason?:string;evidenceRef?:{observationId:string;validationId?:string};metrics?:Metrics};
export interface StrategyCandidate { id: string; market: MarketId; instrument?: string; version: string; metrics: Metrics; status: CandidateStatus; gate: { passed: boolean; reasons: string[];evidenceHash?:string }; updatedAt: number;evidenceRef?:{observationId:string;validationId?:string};approvalEvidenceHash?:string;rules?:{minTrades:number;minOutOfSampleReturnPct:number};metricsSource?:'server-evidence'|'unverified';history?:CandidateAudit[] }

export class StrategyCandidateRegistry {
  constructor(private verify?:(candidate:StrategyCandidate)=>CandidateEvidence){}
  proof(id: string): CandidateEvidence {
    const candidate = this.require(id);
    try {
      const p = this.verify?.(structuredClone(candidate));
      if (!p || typeof p.passed !== 'boolean' || !/^[a-f0-9]{64}$/.test(p.contentHash)
        || !Array.isArray(p.reasons) || p.reasons.some(reason => typeof reason !== 'string')
        || p.passed && p.reasons.length > 0 || !p.metrics
        || p.metrics.oosReturnPct !== undefined && !Number.isFinite(p.metrics.oosReturnPct)
        || p.metrics.trades !== undefined && (!Number.isSafeInteger(p.metrics.trades) || p.metrics.trades < 0)) {
        throw new Error('缺少可核验且一致的服务端证据');
      }
      return structuredClone(p);
    } catch (error) {
      return { passed: false, contentHash: '', metrics: {}, reasons: [error instanceof Error ? error.message : '证据当前不可核验'] };
    }
  }
  private event(c:StrategyCandidate,action:string,reason?:string){
    c.history??=[];
    if(c.history.length>=100)throw Error('候选审计已达100条，未删除历史');
    c.history.push({at:Date.now(),action,evidenceHash:c.gate.evidenceHash,
      ...(c.evidenceRef?{evidenceRef:structuredClone(c.evidenceRef)}:{}),metrics:{...c.metrics},
      ...(reason?{reason}:{})});
  }
  saveDraft(input: { id: string; market: MarketId; instrument?: string; version: string; metrics: Metrics;evidenceRef?:{observationId:string;validationId?:string} }): StrategyCandidate {
    if (!input.id?.trim() || !input.version?.trim()) throw new Error('Candidate id and version are required');
    assertMarketContext({ market: input.market, workspace: 'research', instrument: input.instrument });
    for (const value of [input.metrics.oosReturnPct, input.metrics.trades]) {
      if (value !== undefined && !Number.isFinite(value)) throw new Error('Candidate metrics must be finite');
    }
    const previous=(researchRepository as any).getCandidate(input.id);if(previous?.status==='approved')throw Error('已批准候选需先人工退役，不能覆盖');if(previous&&(previous.market!==input.market||previous.instrument!==input.instrument||previous.version!==input.version))throw Error('候选身份与版本固定，请使用新的ID');
    const ref=input.evidenceRef;if(ref&&(Object.keys(ref).some(k=>!['observationId','validationId'].includes(k))||[ref.observationId,...(ref.validationId===undefined?[]:[ref.validationId])].some(v=>typeof v!=='string'||!v||v.length>200)))throw Error('需要明确的观察/验证引用，不接受客户端证据或指标作为证明');
    const candidate: StrategyCandidate = { id: input.id, market: input.market, instrument: input.instrument, version: input.version, metrics: { ...input.metrics }, status: 'draft', gate: { passed: false, reasons: ['未执行；客户端指标尚未核验'] }, updatedAt: Date.now(),metricsSource:'unverified',...(ref?{evidenceRef:{...ref}}:{}),history:structuredClone(previous?.history||[]),...(previous?.approvalEvidenceHash?{approvalEvidenceHash:previous.approvalEvidenceHash}:{}) };this.event(candidate,'draft');
    researchRepository.compareAndSaveCandidate(input.id, previous ? JSON.stringify(previous) : null, candidate); return this.get(input.id);
  }

  evaluate(id: string, rules: { minOutOfSampleReturnPct?: number; minTrades?: number }): StrategyCandidate {
    if(rules.minTrades!==undefined&&(!Number.isSafeInteger(rules.minTrades)||rules.minTrades<0)||rules.minOutOfSampleReturnPct!==undefined&&!Number.isFinite(rules.minOutOfSampleReturnPct))throw Error('门槛参数必须是有效数值');
    const candidate = this.require(id),previous=JSON.stringify(candidate),proof=this.proof(id),reasons:string[]=proof.passed?[]:[...proof.reasons];if(!proof.passed&&!reasons.length)reasons.push('服务端证据未达标');candidate.metrics={...proof.metrics};candidate.metricsSource=proof.passed?'server-evidence':'unverified';
    candidate.rules={minTrades:Math.max(20,rules.minTrades??20),minOutOfSampleReturnPct:Math.max(0,rules.minOutOfSampleReturnPct??0)};
    if ((proof.metrics.oosReturnPct??-Infinity)<candidate.rules.minOutOfSampleReturnPct) reasons.push('服务端样本外净收益未达标或缺失');
    if ((proof.metrics.trades??0)<candidate.rules.minTrades) reasons.push('服务端成熟平仓样本不足，至少20笔');
    candidate.gate = { passed: reasons.length === 0, reasons,...(proof.contentHash?{evidenceHash:proof.contentHash}:{}) }; candidate.status = reasons.length === 0 ? 'candidate' : 'pending'; candidate.updatedAt = Date.now();this.event(candidate,'evaluate');
    researchRepository.compareAndSaveCandidate(id, previous, candidate); return this.get(id);
  }

  approve(id: string): StrategyCandidate {
    const candidate = this.require(id),previous=JSON.stringify(candidate),proof=this.proof(id); if (!['candidate','approved'].includes(candidate.status)||!candidate.gate.passed||!proof.passed||!candidate.rules) throw new Error('Candidate gate has not passed: 服务端证据未达标');
    if(proof.contentHash!==candidate.gate.evidenceHash||(proof.metrics.trades??0)<Math.max(20,candidate.rules.minTrades)||(proof.metrics.oosReturnPct??-Infinity)<Math.max(0,candidate.rules.minOutOfSampleReturnPct))throw Error('证据或指标已变化，请重新核验');if(candidate.status==='approved'&&candidate.approvalEvidenceHash===proof.contentHash)return this.get(id);
    candidate.status = 'approved'; candidate.updatedAt = Date.now();
    candidate.approvalEvidenceHash=proof.contentHash;this.event(candidate,'approve');
    researchRepository.compareAndSaveCandidate(id, previous, candidate); return this.get(id);
  }

  reject(id: string): StrategyCandidate { const candidate = this.require(id),previous=JSON.stringify(candidate); candidate.status = 'rejected';candidate.gate={passed:false,reasons:['管理员拒绝']}; candidate.updatedAt = Date.now();this.event(candidate,'reject'); researchRepository.compareAndSaveCandidate(id,previous,candidate); return this.get(id); }
  retire(id:string,reason:string):StrategyCandidate {if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('需要人工退役原因');const c=this.require(id),previous=JSON.stringify(c);c.status='rejected';c.gate={passed:false,reasons:['已人工退役：'+reason.trim()]};c.updatedAt=Date.now();this.event(c,'retire',reason.trim());researchRepository.compareAndSaveCandidate(id,previous,c);return this.get(id);}
  canMonitor(id: string): boolean {
    const candidate = this.require(id), before = JSON.stringify(candidate), proof = this.proof(id);
    return before === JSON.stringify(this.require(id)) && candidate.status === 'approved'
      && candidate.gate.passed && proof.passed && !!candidate.rules && !!candidate.approvalEvidenceHash
      && candidate.approvalEvidenceHash === proof.contentHash && candidate.gate.evidenceHash === proof.contentHash
      && (proof.metrics.trades ?? 0) >= Math.max(20, candidate.rules.minTrades)
      && (proof.metrics.oosReturnPct ?? -Infinity) >= Math.max(0, candidate.rules.minOutOfSampleReturnPct);
  }
  get(id: string): StrategyCandidate { return structuredClone(this.require(id)); }
  list(market?: MarketId): StrategyCandidate[] {
    if (market) assertMarketContext({ market, workspace: 'research' });
    return (researchRepository as any).getAllCandidates()
      .filter((candidate: StrategyCandidate) => !market || candidate.market === market)
      .sort((left: StrategyCandidate, right: StrategyCandidate) => right.updatedAt - left.updatedAt)
      .map((candidate: StrategyCandidate) => structuredClone(candidate));
  }
  private require(id: string): StrategyCandidate { const candidate = (researchRepository as any).getCandidate(id); if (!candidate) throw new Error(`Candidate ${id} not found`); return candidate; }
}
