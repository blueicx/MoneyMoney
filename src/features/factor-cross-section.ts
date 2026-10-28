import { createHash } from 'node:crypto';
import { methodologyRef } from './methodology-catalog';

/**
 * Cross-sectional factor analysis over a frozen point-in-time universe.
 *
 * The universe record is produced by HistoricalUniverseStore and already
 * carries a content hash, so this module only accepts members from that
 * record. Factors that are missing or whose industry is unknown stay
 * excluded from neutralization; nothing is back-filled.
 */

export interface FactorObservation {
  instrument: string;
  evidenceId: string;
  value: number | null;
  industry: string | null;
  forwardReturn: number | null;
}

export interface UniverseSnapshotForFactors {
  id: string;
  contentHash: string;
  members: Array<{ instrument: string; industry: string | null; status: 'active' | 'delisted' | 'unknown' }>;
}

export interface CrossSectionGroup {
  quantile: number;
  count: number;
  averageForwardReturn: number | null;
}

export interface CrossSectionResult {
  dataStatus: 'ready' | 'partial' | 'unavailable';
  universeId: string;
  universeHash: string;
  matched: number;
  universeSize: number;
  excluded: Array<{ instrument: string; reason: string }>;
  industryNeutral: { available: boolean; industriesUsed: number; industriesInsufficient: string[] };
  groups: CrossSectionGroup[];
  rankIc: number | null;
  industryRankIc: Array<{ industry: string; samples: number; rankIc: number | null; reason: string | null }>;
  survivorshipWarning: string;
  methodologyRef: string;
  contentHash: string;
}

const instrumentPattern = /^stock:us:[A-Z][A-Z0-9.-]{0,14}$/;
const minimumIndustrySamples = 3;

function rank(values: readonly number[]): number[] {
  return values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index).map((row, position, sorted) => {
    let tieEnd = position;
    while (tieEnd + 1 < sorted.length && sorted[tieEnd + 1].value === row.value) tieEnd += 1;
    const average = (position + tieEnd) / 2 + 1;
    return average;
  });
}

function rankIc(values: readonly number[], forwardReturns: readonly number[]): number | null {
  if (values.length < 3 || values.length !== forwardReturns.length) return null;
  const left = rank(values);
  const right = rank(forwardReturns);
  const mean = (rows: readonly number[]) => rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftVar = 0;
  let rightVar = 0;
  for (let index = 0; index < left.length; index += 1) {
    const dl = left[index] - leftMean;
    const dr = right[index] - rightMean;
    numerator += dl * dr;
    leftVar += dl * dl;
    rightVar += dr * dr;
  }
  if (!leftVar || !rightVar) return null;
  return numerator / Math.sqrt(leftVar * rightVar);
}

function zScores(values: readonly number[]): number[] {
  if (values.length < 2) return values.map(() => 0);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return sd ? values.map(value => (value - mean) / sd) : values.map(() => 0);
}

function hashes(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validateUniverse(universe: UniverseSnapshotForFactors): void {
  if (!universe || typeof universe !== 'object') throw new Error('缺少点时成员存档');
  if (typeof universe.id !== 'string' || !universe.id.startsWith('historical_universe_')) throw new Error('点时成员身份无效');
  if (!hashes(universe.contentHash)) throw new Error('点时成员内容Hash不可核验');
  if (!Array.isArray(universe.members) || !universe.members.length) throw new Error('点时成员为空');
}

export function analyzeCrossSection(input: {
  universe: UniverseSnapshotForFactors;
  observations: readonly FactorObservation[];
  quantiles?: number;
}): CrossSectionResult {
  if (!input || typeof input !== 'object') throw new Error('横截面请求必须是对象');
  validateUniverse(input.universe);
  if (!Array.isArray(input.observations)) throw new Error('因子观测必须是数组');
  const quantiles = input.quantiles === undefined ? 5 : input.quantiles;
  if (!Number.isSafeInteger(quantiles) || quantiles < 2 || quantiles > 10) throw new Error('分位组数必须是 2–10 的整数');
  const memberMap = new Map(input.universe.members.map(member => [member.instrument, member]));
  const seen = new Set<string>();
  const excluded: Array<{ instrument: string; reason: string }> = [];
  const rows: Array<{ instrument: string; value: number; industry: string | null; forwardReturn: number | null; zScore: number }> = [];
  input.observations.forEach(observation => {
    if (!observation || typeof observation !== 'object') throw new Error('因子观测必须是对象');
    if (typeof observation.instrument !== 'string' || !instrumentPattern.test(observation.instrument)) throw new Error('因子观测标的身份无效');
    if (seen.has(observation.instrument)) throw new Error(`因子观测重复：${observation.instrument}`);
    seen.add(observation.instrument);
    if (!memberMap.has(observation.instrument)) {
      excluded.push({ instrument: observation.instrument, reason: '不属于该点时成员' });
      return;
    }
    if (typeof observation.evidenceId !== 'string' || !observation.evidenceId.trim()) {
      excluded.push({ instrument: observation.instrument, reason: '缺少因子证据引用' });
      return;
    }
    if (observation.value === null || typeof observation.value !== 'number' || !Number.isFinite(observation.value)) {
      excluded.push({ instrument: observation.instrument, reason: '因子值缺失或非有限数字' });
      return;
    }
    if (observation.forwardReturn !== null && (typeof observation.forwardReturn !== 'number' || !Number.isFinite(observation.forwardReturn))) {
      throw new Error(`前向收益无效：${observation.instrument}`);
    }
    const industry = observation.industry ?? memberMap.get(observation.instrument)!.industry;
    rows.push({ instrument: observation.instrument, value: observation.value, industry, forwardReturn: observation.forwardReturn, zScore: 0 });
  });
  const industries = new Map<string, number[]>();
  rows.forEach(row => {
    if (!row.industry) return;
    const list = industries.get(row.industry) ?? [];
    list.push(row.value);
    industries.set(row.industry, list);
  });
  const usableIndustries = new Set<string>();
  const insufficientIndustries: string[] = [];
  industries.forEach((values, industry) => {
    if (values.length >= minimumIndustrySamples) usableIndustries.add(industry);
    else insufficientIndustries.push(industry);
  });
  const byIndustry = new Map<string, number[]>();
  rows.forEach(row => {
    if (!row.industry || !usableIndustries.has(row.industry)) return;
    const list = byIndustry.get(row.industry) ?? [];
    list.push(row.value);
    byIndustry.set(row.industry, list);
  });
  const industryStats = new Map<string, { z: number[] }>();
  byIndustry.forEach((values, industry) => industryStats.set(industry, { z: zScores(values) }));
  const industryCursor = new Map<string, number>();
  rows.forEach(row => {
    if (row.industry && usableIndustries.has(row.industry)) {
      const stats = industryStats.get(row.industry)!;
      const cursor = industryCursor.get(row.industry) ?? 0;
      row.zScore = stats.z[cursor];
      industryCursor.set(row.industry, cursor + 1);
    }
  });
  const globalZ = zScores(rows.map(row => row.value));
  rows.forEach((row, index) => {
    if (!(row.industry && usableIndustries.has(row.industry))) row.zScore = globalZ[index];
  });
  const sorted = rows.slice().sort((a, b) => a.zScore - b.zScore || a.instrument.localeCompare(b.instrument));
  const groups: CrossSectionGroup[] = Array.from({ length: quantiles }, (_, index) => {
    const start = Math.floor(index * sorted.length / quantiles);
    const end = Math.floor((index + 1) * sorted.length / quantiles);
    const slice = sorted.slice(start, end);
    const withReturns = slice.filter(row => row.forwardReturn !== null);
    return {
      quantile: index + 1,
      count: slice.length,
      averageForwardReturn: withReturns.length ? withReturns.reduce((sum, row) => sum + row.forwardReturn!, 0) / withReturns.length : null,
    };
  });
  const returnRows = rows.filter(row => row.forwardReturn !== null);
  const overallIc = rankIc(returnRows.map(row => row.zScore), returnRows.map(row => row.forwardReturn!));
  const industryRankIc = [...usableIndustries].map(industry => {
    const slice = returnRows.filter(row => row.industry === industry);
    const value = rankIc(slice.map(row => row.zScore), slice.map(row => row.forwardReturn!));
    return { industry, samples: slice.length, rankIc: value === null ? null : Number(value.toFixed(4)), reason: value === null ? '行业内有效对照不足 3 个或存在重复值' : null };
  });
  const matched = rows.length;
  const dataStatus: CrossSectionResult['dataStatus'] = matched === 0 ? 'unavailable' : matched < input.universe.members.length || excluded.length ? 'partial' : 'ready';
  const payload = {
    dataStatus,
    universeId: input.universe.id,
    universeHash: input.universe.contentHash,
    matched,
    universeSize: input.universe.members.length,
    excluded,
    industryNeutral: { available: usableIndustries.size > 0, industriesUsed: usableIndustries.size, industriesInsufficient: insufficientIndustries.sort() },
    groups,
    rankIc: overallIc === null ? null : Number(overallIc.toFixed(4)),
    industryRankIc,
    survivorshipWarning: '点时成员只证明观察时点的状态，不证明区间内连续成员；缺失行业使用全局标准化并已单独标注。',
    methodologyRef: methodologyRef('factor-cross-section'),
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export interface RollingObservationPeriod {
  asOf: string;
  observations: FactorObservation[];
}

export interface RollingFold {
  index: number;
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
  trainSamples: number;
  testSamples: number;
  trainIc: number | null;
  testIc: number | null;
  status: 'ready' | 'insufficient';
  reason: string | null;
}

export interface RollingValidationResult {
  dataStatus: 'ready' | 'partial' | 'insufficient';
  folds: RollingFold[];
  meanTrainIc: number | null;
  meanTestIc: number | null;
  testHitRate: number | null;
  methodologyRef: string;
  contentHash: string;
}

export function runRollingFactorValidation(input: {
  periods: readonly RollingObservationPeriod[];
  trainPeriods: number;
  testPeriods: number;
  minSamples?: number;
}): RollingValidationResult {
  if (!input || !Array.isArray(input.periods) || input.periods.length < 3) throw new Error('滚动检验至少需要 3 个观测期');
  const trainPeriods = input.trainPeriods;
  const testPeriods = input.testPeriods;
  if (!Number.isSafeInteger(trainPeriods) || trainPeriods < 1) throw new Error('训练窗口必须是正整数期');
  if (!Number.isSafeInteger(testPeriods) || testPeriods < 1) throw new Error('检验窗口必须是正整数期');
  const minSamples = input.minSamples === undefined ? 10 : input.minSamples;
  if (!Number.isSafeInteger(minSamples) || minSamples < 3 || minSamples > 5000) throw new Error('最小样本必须是 3–5000 的整数');
  const sorted = input.periods.slice().sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
  sorted.forEach(period => {
    if (typeof period.asOf !== 'string' || !Number.isFinite(Date.parse(period.asOf))) throw new Error('观测期时点无效');
    if (!Array.isArray(period.observations)) throw new Error('观测期内缺少观测数组');
  });
  const folds: RollingFold[] = [];
  for (let start = 0; start + trainPeriods + testPeriods <= sorted.length; start += testPeriods) {
    const train = sorted.slice(start, start + trainPeriods);
    const test = sorted.slice(start + trainPeriods, start + trainPeriods + testPeriods);
    const trainRows = train.flatMap(period => period.observations).filter(row => !row || row.value === null || row.forwardReturn === null ? false : true) as Array<{ value: number; forwardReturn: number }>;
    const testRows = test.flatMap(period => period.observations).filter(row => !row || row.value === null || row.forwardReturn === null ? false : true) as Array<{ value: number; forwardReturn: number }>;
    const trainIcValue = trainRows.length >= minSamples ? rankIc(trainRows.map(row => row.value), trainRows.map(row => row.forwardReturn)) : null;
    const testIcValue = testRows.length >= minSamples ? rankIc(testRows.map(row => row.value), testRows.map(row => row.forwardReturn)) : null;
    const ready = trainIcValue !== null && testIcValue !== null;
    folds.push({
      index: folds.length + 1,
      trainFrom: train[0].asOf,
      trainTo: train[train.length - 1].asOf,
      testFrom: test[0].asOf,
      testTo: test[test.length - 1].asOf,
      trainSamples: trainRows.length,
      testSamples: testRows.length,
      trainIc: trainIcValue === null ? null : Number(trainIcValue.toFixed(4)),
      testIc: testIcValue === null ? null : Number(testIcValue.toFixed(4)),
      status: ready ? 'ready' : 'insufficient',
      reason: ready ? null : `有效样本不足 ${minSamples}`,
    });
  }
  if (!folds.length) throw new Error('观测期不足一个完整的训练＋检验窗口');
  const testValues = folds.filter(fold => fold.testIc !== null).map(fold => fold.testIc!);
  const trainValues = folds.filter(fold => fold.trainIc !== null).map(fold => fold.trainIc!);
  const dataStatus: RollingValidationResult['dataStatus'] = testValues.length === folds.length ? 'ready' : testValues.length ? 'partial' : 'insufficient';
  const payload = {
    dataStatus,
    folds,
    meanTrainIc: trainValues.length ? Number((trainValues.reduce((sum, value) => sum + value, 0) / trainValues.length).toFixed(4)) : null,
    meanTestIc: testValues.length ? Number((testValues.reduce((sum, value) => sum + value, 0) / testValues.length).toFixed(4)) : null,
    testHitRate: testValues.length ? Number((testValues.filter(value => value > 0).length / testValues.length).toFixed(4)) : null,
    methodologyRef: methodologyRef('rolling-oos'),
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
