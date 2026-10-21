import { createHash } from 'node:crypto';
import type { CandidateEvidence, StrategyCandidate } from './strategy-candidates';
import type { RestrictedForwardStore } from './restricted-forward';

type Dependencies = Pick<RestrictedForwardStore, 'readiness'> & {
  observation: RestrictedForwardStore['read'];
};

/** Bind the existing read-only readiness audit to an explicit candidate, not user supplied metrics. */
export function createCandidateEvidenceVerifier(deps: Dependencies) {
  return (candidate: StrategyCandidate): CandidateEvidence => {
    const ref = candidate.evidenceRef;
    if (!ref?.observationId) throw new Error('未关联明确前向观察引用，不能按时间或名称猜测');
    if (ref.validationId) throw new Error('事前验证结果尚未接入晋级门控；不可忽略该引用');
    const observation = deps.observation(ref.observationId);
    if (observation.market !== candidate.market || observation.instrument !== candidate.instrument
      || observation.strategyHash !== candidate.version) throw new Error('候选与观察的市场、标的身份或策略版本不一致');
    const audit = deps.readiness(ref.observationId);
    if (audit.observationId !== ref.observationId || audit.market !== candidate.market
      || audit.instrument !== candidate.instrument || audit.strategyHash !== candidate.version) {
      throw new Error('服务端证据身份或版本不匹配');
    }
    const required = ['version', 'experiment', 'snapshot', 'revision', 'costs', 'sample', 'oos', 'forward', 'corporate-actions'];
    const reasons = required.flatMap(id => {
      const checks = audit.checks.filter(check => check.id === id);
      return checks.length === 1 && checks[0].status === 'met' ? []
        : [id + '：' + (checks.length === 1 ? checks[0].reason : '核验项缺失或重复')];
    });
    // The existing audit intentionally supplies no verified OOS/fill metrics.
    // Do not substitute training results, price observations, or caller claims.
    reasons.push('当前只读核验没有已核验的样本外净收益与实际成熟平仓指标，不能晋级');
    const { checkedAt: _checkedAt, contentHash: _contentHash, ...facts } = audit;
    const contentHash = createHash('sha256').update(JSON.stringify({
      candidate: { market: candidate.market, instrument: candidate.instrument, version: candidate.version },
      evidenceRef: ref, facts,
    })).digest('hex');
    return { passed: false, contentHash, metrics: {}, reasons };
  };
}
