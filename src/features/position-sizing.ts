import { createHash } from 'node:crypto';
import { evidenceRefDigest, verifyEvidenceRef, type EvidenceRef } from './evidence-contract';
import { getMethodology, methodologyRef } from './methodology-catalog';

/**
 * Pure position-size preview. It consumes frozen statistics that were already
 * saved elsewhere, validates the evidence reference and returns sizing
 * fractions. It never writes, never prices an order and never touches the
 * trading executor.
 */

export type SizingModel = 'fractional-kelly' | 'capped-edge-heuristic';

export interface SizingStats {
  kind: 'backtest' | 'brier';
  evidence: EvidenceRef;
  samples: number;
  winRate?: number;
  payoffRatio?: number;
  brierScore?: number;
  baselineBrier?: number;
}

export interface SizingInput {
  stats: SizingStats;
  bankroll: number;
  currency: string;
  maxFraction?: number;
  minimumSamples?: number;
}

export interface SizingPreview {
  dataStatus: 'ready' | 'unavailable';
  model: SizingModel;
  currency: string;
  bankroll: number;
  fractions: { full: number; half: number; quarter: number } | null;
  amounts: { full: number; half: number; quarter: number } | null;
  capFraction: number;
  rationale: string[];
  missing: string[];
  methodologyRef: string;
  noExecution: true;
  contentHash: string;
}

const currencyPattern = /^[A-Z]{2,10}$/;

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是有限数字`);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unavailable(input: SizingInput, model: SizingModel, missing: string[], rationale: string[], capFraction: number): SizingPreview {
  const payload = {
    dataStatus: 'unavailable' as const,
    model,
    currency: input.currency,
    bankroll: input.bankroll,
    fractions: null,
    amounts: null,
    capFraction,
    rationale,
    missing,
    methodologyRef: methodologyRef('kelly-sizing'),
    noExecution: true as const,
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function previewPositionSizing(input: SizingInput): SizingPreview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('仓位请求必须是对象');
  if (!input.stats || typeof input.stats !== 'object') throw new Error('仓位请求缺少冻结统计');
  if (!verifyEvidenceRef(input.stats.evidence)) throw new Error('仓位统计的证据引用不可核验');
  const bankroll = finite(input.bankroll, '资金规模');
  if (bankroll <= 0 || bankroll > 1e15) throw new Error('资金规模必须为正值且不超过 1e15');
  const currency = String(input.currency ?? '').trim().toUpperCase();
  if (!currencyPattern.test(currency)) throw new Error('币种代码无效');
  const capFraction = input.maxFraction === undefined ? 0.25 : finite(input.maxFraction, '最大仓位上限');
  if (capFraction <= 0 || capFraction > 1) throw new Error('最大仓位上限必须在 (0,1] 区间');
  const minimumSamples = input.minimumSamples === undefined ? 30 : finite(input.minimumSamples, '最小样本数');
  if (!Number.isSafeInteger(minimumSamples) || minimumSamples < 10 || minimumSamples > 100000) throw new Error('最小样本数必须是 10–100000 的整数');
  const samples = input.stats.samples;
  if (!Number.isSafeInteger(samples) || samples < 0) throw new Error('样本数必须是非负整数');
  if (getMethodology('kelly-sizing@1') === null) throw new Error('Kelly 方法论目录缺失');
  const rationale: string[] = [`资金币种 ${currency}；不进行任何汇率换算。`, `仓位上限 ${(capFraction * 100).toFixed(2)}%。`];
  const normalized = { ...input, currency };
  if (samples < minimumSamples) return unavailable(normalized, input.stats.kind === 'backtest' ? 'fractional-kelly' : 'capped-edge-heuristic', [`样本数 ${samples} 低于门槛 ${minimumSamples}`], rationale, capFraction);

  if (input.stats.kind === 'brier') {
    const model: SizingModel = 'capped-edge-heuristic';
    const missing: string[] = [];
    const brier = input.stats.brierScore;
    const baseline = input.stats.baselineBrier;
    if (typeof brier !== 'number' || !Number.isFinite(brier) || brier < 0 || brier > 1) missing.push('有效 Brier 分数');
    if (typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline <= 0 || baseline > 1) missing.push('冻结基线 Brier');
    if (missing.length) return unavailable(normalized, model, missing, rationale, capFraction);
    const edge = baseline! - brier!;
    if (edge <= 0) return unavailable(normalized, model, ['相对基线没有正概率优势'], rationale, capFraction);
    const full = clamp(edge * 2, 0, capFraction);
    const half = full / 2;
    const quarter = full / 4;
    const payload = {
      dataStatus: 'ready' as const,
      model,
      currency,
      bankroll,
      fractions: { full, half, quarter },
      amounts: { full: bankroll * full, half: bankroll * half, quarter: bankroll * quarter },
      capFraction,
      rationale: [...rationale, `Brier 优势 ${edge.toFixed(4)}，按 2 倍优势与上限截断得到启发式档位。`, '该档位是风险上限提示，不替代赔率、流动性与回撤约束。'],
      missing: [],
      methodologyRef: methodologyRef('kelly-sizing'),
      noExecution: true as const,
    };
    return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  }

  const model: SizingModel = 'fractional-kelly';
  const missing: string[] = [];
  const winRate = input.stats.winRate;
  const payoffRatio = input.stats.payoffRatio;
  if (typeof winRate !== 'number' || !Number.isFinite(winRate) || winRate <= 0 || winRate >= 1) missing.push('胜率区间 (0,1)');
  if (typeof payoffRatio !== 'number' || !Number.isFinite(payoffRatio) || payoffRatio <= 0) missing.push('正赔率');
  if (missing.length) return unavailable(normalized, model, missing, rationale, capFraction);
  const rawKelly = (winRate! * payoffRatio! - (1 - winRate!)) / payoffRatio!;
  if (rawKelly <= 0) return unavailable(normalized, model, ['Kelly 比例为负，冻结统计不支持正仓位'], rationale, capFraction);
  const full = clamp(rawKelly, 0, capFraction);
  const half = full / 2;
  const quarter = full / 4;
  const payload = {
    dataStatus: 'ready' as const,
    model,
    currency,
    bankroll,
    fractions: { full, half, quarter },
    amounts: { full: bankroll * full, half: bankroll * half, quarter: bankroll * quarter },
    capFraction,
    rationale: [...rationale, `胜率 ${(winRate! * 100).toFixed(2)}%、赔率 ${payoffRatio!.toFixed(3)}，全 Kelly ${(rawKelly * 100).toFixed(2)}%，按上限截断后展示分数档位。`, '统计误差会放大 Kelly 波动，建议优先使用半 Kelly 或更低档位。'],
    missing: [],
    methodologyRef: methodologyRef('kelly-sizing'),
    noExecution: true as const,
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function sizingEvidenceDigest(input: SizingInput): string {
  return evidenceRefDigest(input.stats.evidence);
}
