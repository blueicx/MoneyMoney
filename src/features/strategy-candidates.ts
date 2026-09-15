import { assertMarketContext, type MarketId } from './research-contracts';

export type CandidateStatus = 'draft' | 'pending' | 'candidate' | 'approved' | 'rejected';
export interface StrategyCandidate { id: string; market: MarketId; instrument?: string; version: string; metrics: { oosReturnPct?: number; trades?: number }; status: CandidateStatus; gate: { passed: boolean; reasons: string[] }; updatedAt: number; }

export class StrategyCandidateRegistry {
  private candidates = new Map<string, StrategyCandidate>();

  saveDraft(input: { id: string; market: MarketId; instrument?: string; version: string; metrics: { oosReturnPct?: number; trades?: number } }): StrategyCandidate {
    if (!input.id?.trim() || !input.version?.trim()) throw new Error('Candidate id and version are required');
    assertMarketContext({ market: input.market, workspace: 'research', instrument: input.instrument });
    const candidate: StrategyCandidate = { id: input.id, market: input.market, instrument: input.instrument, version: input.version, metrics: { ...input.metrics }, status: 'draft', gate: { passed: false, reasons: ['尚未执行晋级检查'] }, updatedAt: Date.now() };
    this.candidates.set(input.id, candidate); return this.get(input.id);
  }

  evaluate(id: string, rules: { minOutOfSampleReturnPct?: number; minTrades?: number }): StrategyCandidate {
    const candidate = this.require(id); const reasons: string[] = [];
    if (Number(candidate.metrics.oosReturnPct ?? -Infinity) < Number(rules.minOutOfSampleReturnPct ?? 0)) reasons.push('样本外收益未达门槛');
    if (Number(candidate.metrics.trades ?? 0) < Number(rules.minTrades ?? 0)) reasons.push('交易数未达门槛');
    candidate.gate = { passed: reasons.length === 0, reasons }; candidate.status = reasons.length === 0 ? 'candidate' : 'pending'; candidate.updatedAt = Date.now(); return this.get(id);
  }

  approve(id: string): StrategyCandidate {
    const candidate = this.require(id); if (!candidate.gate.passed) throw new Error('Candidate gate has not passed');
    candidate.status = 'approved'; candidate.updatedAt = Date.now(); return this.get(id);
  }

  reject(id: string): StrategyCandidate { const candidate = this.require(id); candidate.status = 'rejected'; candidate.updatedAt = Date.now(); return this.get(id); }
  canMonitor(id: string): boolean { return this.require(id).status === 'approved'; }
  get(id: string): StrategyCandidate { return { ...this.require(id), metrics: { ...this.require(id).metrics }, gate: { passed: this.require(id).gate.passed, reasons: [...this.require(id).gate.reasons] } }; }
  private require(id: string): StrategyCandidate { const candidate = this.candidates.get(id); if (!candidate) throw new Error(`Candidate ${id} not found`); return candidate; }
}
