import { createHash } from 'node:crypto';
import { restrictedValidationManifest } from './restricted-validation';
import { restrictedStrategy } from './strategy-definitions';
import type { buildRestrictedReadiness } from './restricted-readiness';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Input { session: any; version: any; training: any; plan: any; result: any }
export interface RegisteredWindowProof {
  id: string; planHash: string | null; resultId: string | null; resultHash: string | null;
  status: 'blocked' | 'verified-theoretical'; from: number | null; to: number | null;
  registeredAt: number | null; metrics: { trades?: number; oosReturnPct?: number };
  actualFills: false; promotionAllowed: false; reason: string;
}
/** Verify the existing frozen prospective experiment; never label its theoretical fills as actual execution. */
export function verifyRegisteredWindow(input: Input, now = Date.now()): RegisteredWindowProof {
  const { session: s, version: v, training: training, plan: p, result: r } = input;
  const out: RegisteredWindowProof = { id: p?.id || '', planHash: p?.hash || null,
    resultId: p?.resultId || null, resultHash: r?.resultHash || null,
    status: 'blocked', from: p?.from ?? null, to: p?.to ?? null, registeredAt: p?.confirmedAt ?? null,
    metrics: {}, actualFills: false, promotionAllowed: false, reason: '未来窗口尚未完成或缺少明确结果，不采用客户端数值' };
  try {
    const interval = restrictedStrategy.capabilities.intervals[s.timeframe];
    if (!p || !Number.isFinite(now) || !interval || p.market !== 'stocks' || s.market !== p.market
      || p.observationId !== s.id || p.instrument !== s.instrument || p.source !== s.source
      || p.strategyId !== s.strategyId || p.strategyHash !== s.strategyHash || p.timeframe !== s.timeframe
      || p.trainingExperimentId !== s.experimentId || p.mode !== 'prospective'
      || !/^validation_[a-f0-9-]{36}$/.test(p.id) || digest(restrictedValidationManifest(p)) !== p.hash
      || p.resultId !== 'exp_validation_' + digest([p.id, p.hash])
      || !Number.isSafeInteger(p.count) || p.count < 20 || p.count > 500
      || !Number.isSafeInteger(p.from) || p.from % interval !== 0 || p.to !== p.from + interval * p.count
      || !Number.isFinite(p.createdAt) || !Number.isFinite(p.confirmedAt)
      || p.createdAt > p.confirmedAt || p.confirmedAt >= p.from
      || v?.id !== p.strategyId || v.hash !== p.strategyHash || v.market !== p.market
      || !Number.isFinite(Date.parse(v.createdAt)) || Date.parse(v.createdAt) > p.createdAt
      || training?.experiment?.id !== p.trainingExperimentId
      || training.experiment.dataSnapshotHash !== p.trainingHash || digest(training.experiment) !== p.trainingRecordHash
      || !Number.isFinite(Date.parse(training.experiment.createdAt)) || Date.parse(training.experiment.createdAt) > p.createdAt) {
      throw new Error('未来登记的身份、固定版本、原实验、时间或清单Hash不一致');
    }
    if (p.status !== 'completed' || !r || now < p.to) return out;
    const { resultHash, ...payload } = r, e = r.experiment, validation = r.validation;
    if (digest(payload) !== resultHash || !e || e.id !== p.resultId || e.market !== p.market
      || e.instrument !== p.instrument || e.strategyId !== p.strategyId || e.strategyVersion !== p.strategyHash
      || e.timeframe !== p.timeframe || e.dataSource !== p.source || !/^[a-f0-9]{64}$/.test(e.dataSnapshotHash)
      || !Number.isFinite(Date.parse(e.createdAt)) || Date.parse(e.createdAt) < p.to || Date.parse(e.createdAt) > now
      || e.parameters?.asOf !== new Date(p.to).toISOString() || e.parameters?.windowStart !== new Date(p.from).toISOString()
      || e.feeRate !== v.definition.costs.feeBps / 10000 || e.slippage !== v.definition.costs.slippageBps / 10000
      || e.parameters?.allocationPct !== v.definition.position.maxAllocationPct || e.parameters?.startingBalance !== 1000
      || r.executionModel !== 'restricted-next-open-v1'
      || validation?.mode !== 'prospective' || validation.planId !== p.id || validation.planHash !== p.hash
      || validation.observationId !== s.id || validation.trainingExperimentId !== p.trainingExperimentId
      || validation.registeredAt !== p.confirmedAt || validation.from !== p.from || validation.to !== p.to) {
      throw new Error('已存未来结果Hash、窗口、成本或引用不一致，不猜测恢复');
    }
    if (validation.complete !== true || validation.expectedBars !== p.count || validation.completedBars !== p.count) {
      throw new Error('未来窗口覆盖或发布时间证据不足，不插值、不当作有效样本外');
    }
    const trades = r.quality?.closedTrades, metrics = r.evidence?.outOfSample;
    if (!Number.isSafeInteger(trades) || trades < 1 || !metrics || !Number.isFinite(metrics.totalReturnPct)
      || metrics.tradesCount !== trades || digest(metrics) !== digest(r.backtest?.metrics)
      || !Array.isArray(r.evidenceRefs) || r.evidenceRefs.length !== 1 || typeof r.evidenceRefs[0] !== 'string'
      || ![r.backtest?.totalFees, r.backtest?.totalSlippage].every(n => Number.isFinite(n) && n >= 0)) {
      throw new Error('未来窗口成熟平仓指标、费用或快照引用不可核验');
    }
    out.status = 'verified-theoretical'; out.metrics = { trades, oosReturnPct: metrics.totalReturnPct };
    out.reason = `已核验事前登记理论模型 ${trades} 笔平仓；不是实际模拟撮合，也不代表独立重复验证或自动晋级`;
  } catch (error) { out.reason = error instanceof Error ? error.message : '未来窗口证据核验失败'; }
  return out;
}

export function attachRegisteredWindowAudit(audit: ReturnType<typeof buildRestrictedReadiness>, input: Input,
  windowAudit: ReturnType<typeof buildRestrictedReadiness> | null, now = Date.now()): ReturnType<typeof buildRestrictedReadiness> {
  const validation = verifyRegisteredWindow(input, now), checks = structuredClone(audit.checks);
  const windowChecks = windowAudit?.checks.filter(c => ['version', 'experiment', 'snapshot', 'revision', 'costs', 'sample'].includes(c.id)) || [];
  const windowCut = Number.isFinite(input.plan?.to) ? new Date(input.plan.to).toISOString() : null;
  const archiveValid = !!windowAudit && windowAudit.experimentId === validation.resultId && windowAudit.snapshot?.asOf === windowCut
    && ['version', 'experiment', 'snapshot', 'costs'].every(id => windowChecks.filter(c => c.id === id && c.status === 'met').length === 1);
  if (validation.status === 'verified-theoretical' && !archiveValid) {
    validation.status = 'blocked'; validation.metrics = {};
    validation.reason = '未来结果已保存，但对应快照、版本或成本目录核验未通过，不采用其汇总指标';
  }
  checks.push({ id: 'registered-window', status: validation.status === 'verified-theoretical' ? 'met' : 'blocked', reason: validation.reason });
  for (const check of windowChecks) checks.push({ ...check, id: 'validation-' + check.id });
  const oos = checks.find(c => c.id === 'oos');
  if (oos && validation.status === 'verified-theoretical') {
    oos.status = 'met'; oos.reason = validation.reason;
  }
  const pack = { ...audit, validation, checks, evidenceRefs: [...new Set([...audit.evidenceRefs, ...(windowAudit?.evidenceRefs || [])])],
    blockers: checks.filter(c => c.status !== 'met').map(c => c.reason) };
  const { contentHash: _contentHash, ...payload } = pack;
  return { ...payload, contentHash: digest(payload) };
}
