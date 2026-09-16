import { assertMarketContext, type MarketId } from './research-contracts';
import { researchRepository } from './research-repository';

export type CandidateStatus = 'draft' | 'pending' | 'candidate' | 'approved' | 'rejected';
export interface StrategyCandidate { id: string; market: MarketId; instrument?: string; version: string; metrics: { oosReturnPct?: number; trades?: number }; status: CandidateStatus; gate: { passed: boolean; reasons: string[] }; updatedAt: number; }

export class StrategyCandidateRegistry {
  saveDraft(input: { id: string; market: MarketId; instrument?: string; version: string; metrics: { oosReturnPct?: number; trades?: number } }): StrategyCandidate {
    if (!input.id?.trim() || !input.version?.trim()) throw new Error('Candidate id and version are required');
    assertMarketContext({ market: input.market, workspace: 'research', instrument: input.instrument });
    const candidate: StrategyCandidate = { id: input.id, market: input.market, instrument: input.instrument, version: input.version, metrics: { ...input.metrics }, status: 'draft', gate: { passed: false, reasons: ['未执行'] }, updatedAt: Date.now() };
    (researchRepository as any).saveCandidate(input.id, candidate); return this.get(input.id);
  }

  evaluate(id: string, rules: { minOutOfSampleReturnPct?: number; minTrades?: number }): StrategyCandidate {
    const candidate = this.require(id); const reasons: string[] = [];
    if (Number(candidate.metrics.oosReturnPct ?? -Infinity) < Number(rules.minOutOfSampleReturnPct ?? 0)) reasons.push('未达标');
    if (Number(candidate.metrics.trades ?? 0) < Number(rules.minTrades ?? 0)) reasons.push('未达标');
    candidate.gate = { passed: reasons.length === 0, reasons }; candidate.status = reasons.length === 0 ? 'candidate' : 'pending'; candidate.updatedAt = Date.now();
    (researchRepository as any).saveCandidate(id, candidate); return this.get(id);
  }

  approve(id: string): StrategyCandidate {
    const candidate = this.require(id); if (!candidate.gate.passed) throw new Error('Candidate gate has not passed');
    candidate.status = 'approved'; candidate.updatedAt = Date.now();
    (researchRepository as any).saveCandidate(id, candidate); return this.get(id);
  }

  reject(id: string): StrategyCandidate { const candidate = this.require(id); candidate.status = 'rejected'; candidate.updatedAt = Date.now(); (researchRepository as any).saveCandidate(id, candidate); return this.get(id); }
  canMonitor(id: string): boolean { return this.require(id).status === 'approved'; }
  get(id: string): StrategyCandidate { const c = this.require(id); return { ...c, metrics: { ...c.metrics }, gate: { passed: c.gate.passed, reasons: [...c.gate.reasons] } }; }
  private require(id: string): StrategyCandidate { const candidate = (researchRepository as any).getCandidate(id); if (!candidate) throw new Error(`Candidate ${id} not found`); return candidate; }
}
