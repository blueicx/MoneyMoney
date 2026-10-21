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
    const observation = deps.observation(ref.observationId);
    if (observation.market !== candidate.market || observation.instrument !== candidate.instrument
      || observation.strategyHash !== candidate.version) throw new Error('候选与观察的市场、标的身份或策略版本不一致');
    const audit = deps.readiness(ref.observationId, ref.validationId);
    if (audit.observationId !== ref.observationId || audit.market !== candidate.market
      || audit.instrument !== candidate.instrument || audit.strategyHash !== candidate.version) {
      throw new Error('服务端证据身份或版本不匹配');
    }
    if (ref.validationId && audit.validation?.id !== ref.validationId) throw new Error('服务端核验未返回同一验证引用，不采用其他结果');
    const required = ['version', 'experiment', 'snapshot', 'revision', 'costs', 'sample', 'oos', 'forward', 'corporate-actions',
      ...(ref.validationId ? ['registered-window', 'validation-version', 'validation-experiment', 'validation-snapshot', 'validation-revision', 'validation-costs', 'validation-sample'] : [])];
    const reasons = required.flatMap(id => {
      const checks = audit.checks.filter(check => check.id === id);
      return checks.length === 1 && checks[0].status === 'met' ? []
        : [id + '：' + (checks.length === 1 ? checks[0].reason : '核验项缺失或重复')];
    });
    const metrics = audit.validation?.status === 'verified-theoretical' ? { ...audit.validation.metrics } : {};
    if (metrics.trades === undefined || metrics.oosReturnPct === undefined) reasons.push('没有已核验的事前窗口样本外指标，不采用训练汇总或客户端数值');
    if (!Number.isSafeInteger(audit.forward?.pairedFills) || audit.forward.pairedFills < 20) reasons.push('实际成熟配对成交不足20笔或未知，理论模型与走势观察不能替代');
    const { checkedAt: _checkedAt, contentHash: _contentHash, ...facts } = audit;
    const contentHash = createHash('sha256').update(JSON.stringify({
      candidate: { market: candidate.market, instrument: candidate.instrument, version: candidate.version },
      evidenceRef: ref, facts,
    })).digest('hex');
    return { passed: reasons.length === 0, contentHash, metrics, reasons };
  };
}
