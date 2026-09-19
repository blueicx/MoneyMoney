import crypto from 'node:crypto';
import { assertMarketContext, type DataStatus, type MarketId } from './research-contracts';

export interface EvidenceQualityDimensions {
  freshness: number;
  completeness: number;
  sourceReliability: number;
  corroboration: number;
}

export interface EvidenceSnapshot {
  id: string;
  hash: string;
  market: MarketId;
  instrument?: string;
  workspace: string;
  dataStatus: DataStatus;
  source: { id: string; name: string; url?: string | null };
  observedAt: string;
  fetchedAt: string;
  fields: Record<string, unknown>;
  expectedFields: string[];
  quality: EvidenceQualityDimensions;
  reason?: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value: unknown): string {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function validIso(value: unknown, name: string): string {
  const time = new Date(String(value || '')).getTime();
  if (!Number.isFinite(time)) throw new Error(`${name} must be a valid date`);
  return new Date(time).toISOString();
}

function reliabilityForSource(sourceId: string): number {
  if (/sec|federal|official|exchange|nasdaq|binance/i.test(sourceId)) return 0.95;
  if (/vendor|yahoo|polymarket|kalshi/i.test(sourceId)) return 0.82;
  if (/community|social/i.test(sourceId)) return 0.55;
  return 0.7;
}

export function createEvidenceSnapshot(input: Omit<Partial<EvidenceSnapshot>, 'quality'> & {
  market: MarketId;
  workspace: string;
  dataStatus: DataStatus;
  source: EvidenceSnapshot['source'];
  observedAt: string;
  fetchedAt: string;
  fields: Record<string, unknown>;
  expectedFields?: string[];
  corroboratingSources?: number;
}): EvidenceSnapshot {
  const context = assertMarketContext({ market: input.market, workspace: input.workspace, instrument: input.instrument });
  if (!input.source?.id?.trim() || !input.source?.name?.trim()) throw new Error('Evidence source is required');
  if (input.source.url && !/^https?:\/\//i.test(input.source.url)) throw new Error('Evidence source URL must be http(s)');
  const observedAt = validIso(input.observedAt, 'observedAt');
  const fetchedAt = validIso(input.fetchedAt, 'fetchedAt');
  const expectedFields = [...new Set((input.expectedFields?.length ? input.expectedFields : Object.keys(input.fields)).map(String))].sort();
  const present = expectedFields.filter(field => input.fields[field] !== undefined && input.fields[field] !== null).length;
  const ageMs = Math.max(0, new Date(fetchedAt).getTime() - new Date(observedAt).getTime());
  const payload = {
    market: context.market, instrument: context.instrument || '', workspace: context.workspace,
    dataStatus: input.dataStatus, source: input.source, observedAt, fetchedAt,
    fields: input.fields, expectedFields, reason: input.reason || '',
  };
  const hash = contentHash(payload);
  return {
    ...payload,
    instrument: context.instrument,
    id: input.id || `ev_${hash.slice(0, 16)}`,
    hash,
    fields: { ...input.fields },
    expectedFields,
    quality: {
      freshness: ageMs <= 60_000 ? 1 : clamp01(1 - ageMs / (24 * 60 * 60 * 1000)),
      completeness: expectedFields.length ? present / expectedFields.length : 1,
      sourceReliability: reliabilityForSource(input.source.id),
      corroboration: clamp01(Number(input.corroboratingSources || 0) / 3),
    },
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function compareEvidenceSnapshots(left: EvidenceSnapshot, right: EvidenceSnapshot): Array<{ field: string; before: unknown; after: unknown }> {
  if (left.market !== right.market || left.instrument !== right.instrument) throw new Error('Evidence snapshots must belong to the same market and instrument');
  const keys = [...new Set([...Object.keys(left.fields), ...Object.keys(right.fields)])].sort();
  return keys.filter(key => stable(left.fields[key]) !== stable(right.fields[key])).map(field => ({ field, before: left.fields[field], after: right.fields[field] }));
}

export type ScenarioShockKind = 'pricePct' | 'absolute';
export interface ScenarioDefinition {
  id: string;
  name: string;
  market: MarketId;
  shocks: Array<{ target: string; kind: ScenarioShockKind; value: number }>;
}
export interface ScenarioPosition { instrument: string; market: MarketId; quantity: number; price: number; beta?: number; }

export function runScenario(definition: ScenarioDefinition, positions: ScenarioPosition[]) {
  assertMarketContext({ market: definition.market, workspace: 'scenario' });
  if (!definition.id?.trim() || !definition.name?.trim() || !definition.shocks?.length) throw new Error('Scenario definition is incomplete');
  positions.forEach(position => {
    assertMarketContext({ market: position.market, workspace: 'scenario', instrument: position.instrument });
    if (position.market !== definition.market) throw new Error('Scenario and portfolio market must match');
    if (![position.quantity, position.price].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Scenario position values must be finite and non-negative');
  });
  const totalValueBefore = positions.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const impacts = positions.map(position => {
    const base = position.quantity * position.price;
    const change = definition.shocks.reduce((sum, shock) => {
      if (shock.kind === 'pricePct' && (shock.target === 'market' || shock.target === position.instrument)) return sum + base * (shock.value / 100) * (position.beta ?? 1);
      if (shock.kind === 'absolute' && shock.target === 'volatility') return sum - base * Math.abs(shock.value) * 0.0025;
      return sum;
    }, 0);
    return { instrument: position.instrument, valueBefore: base, valueAfter: Number((base + change).toFixed(8)), change: Number(change.toFixed(8)) };
  });
  const totalValueAfter = impacts.reduce((sum, item) => sum + item.valueAfter, 0);
  return {
    id: `run_${contentHash({ definition, positions }).slice(0, 16)}`,
    scenarioId: definition.id,
    market: definition.market,
    kind: 'stress-test' as const,
    impact: { totalValueBefore, totalValueAfter: Number(totalValueAfter.toFixed(8)), change: Number((totalValueAfter - totalValueBefore).toFixed(8)), positions: impacts },
    disclaimer: '这是确定性压力测试，不是价格预测或投资建议。',
  };
}

export type DecisionDirection = 'long' | 'short' | 'neutral';
export interface DecisionRecord {
  id: string;
  market: MarketId;
  instrument: string;
  direction: DecisionDirection;
  thesis: string;
  counterEvidence: string[];
  invalidation: { field: string; operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq'; value: number | string };
  horizonAt: string;
  evidenceIds: string[];
  strategyId?: string;
  status: 'open' | 'invalidated' | 'expired' | 'reviewed';
  createdAt: string;
  review?: { at: string; observed: Record<string, unknown>; invalidationBreached: boolean };
}

export function createDecisionRecord(input: Omit<DecisionRecord, 'id' | 'status' | 'createdAt' | 'review'> & Partial<Pick<DecisionRecord, 'id' | 'createdAt'>>): DecisionRecord {
  assertMarketContext({ market: input.market, workspace: 'decision-journal', instrument: input.instrument });
  if (!input.thesis?.trim() || !input.invalidation?.field?.trim()) throw new Error('Decision thesis and invalidation are required');
  const horizonAt = validIso(input.horizonAt, 'horizonAt');
  const createdAt = input.createdAt ? validIso(input.createdAt, 'createdAt') : new Date().toISOString();
  const payload = { ...input, horizonAt, createdAt, counterEvidence: [...(input.counterEvidence || [])], evidenceIds: [...new Set(input.evidenceIds || [])] };
  return { ...payload, id: input.id || `decision_${contentHash(payload).slice(0, 16)}`, status: 'open' };
}

function invalidationBreached(rule: DecisionRecord['invalidation'], observed: Record<string, unknown>): boolean {
  const actual = observed[rule.field];
  if (actual === undefined || actual === null) return false;
  switch (rule.operator) {
    case 'lt': return Number(actual) < Number(rule.value);
    case 'lte': return Number(actual) <= Number(rule.value);
    case 'gt': return Number(actual) > Number(rule.value);
    case 'gte': return Number(actual) >= Number(rule.value);
    case 'eq': return String(actual) === String(rule.value);
  }
}

export function reviewDecision(decision: DecisionRecord, observed: Record<string, unknown>, at = new Date().toISOString()): DecisionRecord & { invalidationBreached: boolean } {
  const reviewAt = validIso(at, 'reviewAt');
  const breached = invalidationBreached(decision.invalidation, observed);
  const expired = new Date(reviewAt).getTime() >= new Date(decision.horizonAt).getTime();
  return { ...decision, status: breached ? 'invalidated' : expired ? 'expired' : 'reviewed', review: { at: reviewAt, observed: { ...observed }, invalidationBreached: breached }, invalidationBreached: breached };
}

export interface PortfolioRow {
  instrument: string;
  market: MarketId;
  quantity: number;
  price: number;
  currency: string;
  sector?: string;
  factor?: string;
}

export function importPortfolioRows(rows: Array<Partial<PortfolioRow>>): { accepted: PortfolioRow[]; rejected: Array<{ row: Partial<PortfolioRow>; reason: string }> } {
  const accepted: PortfolioRow[] = [];
  const rejected: Array<{ row: Partial<PortfolioRow>; reason: string }> = [];
  const seen = new Set<string>();
  rows.forEach(row => {
    try {
      const market = row.market as MarketId;
      const instrument = String(row.instrument || '').trim();
      assertMarketContext({ market, workspace: 'portfolio-import', instrument });
      if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) throw new Error('数量必须大于 0');
      if (!Number.isFinite(Number(row.price)) || Number(row.price) <= 0) throw new Error('价格必须大于 0');
      if (!/^[A-Z]{3}$/.test(String(row.currency || '').toUpperCase())) throw new Error('币种单位无效');
      const key = `${market}:${instrument.toUpperCase()}:${String(row.currency).toUpperCase()}`;
      if (seen.has(key)) throw new Error('重复仓位');
      seen.add(key);
      accepted.push({ instrument, market, quantity: Number(row.quantity), price: Number(row.price), currency: String(row.currency).toUpperCase(), ...(row.sector ? { sector: String(row.sector) } : {}), ...(row.factor ? { factor: String(row.factor) } : {}) });
    } catch (error: any) {
      rejected.push({ row, reason: error.message || '仓位记录无效' });
    }
  });
  return { accepted, rejected };
}

export function analyzePortfolio(rows: PortfolioRow[], input: { benchmarkReturnPct?: number; portfolioReturnPct?: number } = {}) {
  const values = rows.map(row => row.quantity * row.price);
  const totalValue = values.reduce((sum, value) => sum + value, 0);
  const byMarket = rows.reduce<Record<string, number>>((acc, row, index) => { acc[row.market] = (acc[row.market] || 0) + values[index]; return acc; }, {});
  const bySector = rows.reduce<Record<string, number>>((acc, row, index) => { const key = row.sector || '未分类'; acc[key] = (acc[key] || 0) + values[index]; return acc; }, {});
  const largest = values.length ? Math.max(...values) : 0;
  const benchmarkReturnPct = Number(input.benchmarkReturnPct || 0);
  const portfolioReturnPct = Number(input.portfolioReturnPct || 0);
  return {
    totalValue: Number(totalValue.toFixed(2)),
    concentrationPct: totalValue ? Number((largest / totalValue * 100).toFixed(2)) : 0,
    benchmarkReturnPct,
    portfolioReturnPct,
    excessReturnPct: Number((portfolioReturnPct - benchmarkReturnPct).toFixed(2)),
    byMarket,
    bySector,
    stressTests: [-20, -10, -5, 5].map(shockPct => ({ shockPct, value: Number((totalValue * (1 + shockPct / 100)).toFixed(2)), impact: Number((totalValue * shockPct / 100).toFixed(2)) })),
    rebalanceDraft: Object.entries(byMarket).map(([market, value]) => ({ market, currentPct: totalValue ? Number((value / totalValue * 100).toFixed(2)) : 0 })),
    disclaimer: '组合分析和再平衡仅为研究草稿，不会创建订单。',
  };
}

export interface SignalOutcome {
  id: string;
  market: MarketId;
  instrument: string;
  strategyId: string;
  pattern?: string;
  timeframe: string;
  source: string;
  triggeredAt: number;
  entryPrice: number;
  exitPrice?: number;
  mfePct?: number;
  maePct?: number;
  confirmationDelayMs?: number;
  sample: 'in-sample' | 'oos' | 'paper' | 'live';
  dataGap?: boolean;
  futureDataRisk?: boolean;
  invalidationReason?: string;
}

export function analyzeSignalQuality(signals: SignalOutcome[], options: { minimumSamples?: number; benchmarkReturnPct?: number } = {}) {
  signals.forEach(signal => assertMarketContext({ market: signal.market, workspace: 'signal-quality', instrument: signal.instrument }));
  const returns = signals.map(signal => signal.exitPrice == null || !signal.entryPrice ? null : ((signal.exitPrice - signal.entryPrice) / signal.entryPrice) * 100);
  const resolved = returns.filter((value): value is number => value !== null && Number.isFinite(value));
  const wins = resolved.filter(value => value > 0).length;
  const sampleBreakdown = signals.reduce<Record<string, number>>((acc, signal) => { acc[signal.sample] = (acc[signal.sample] || 0) + 1; return acc; }, { 'in-sample': 0, oos: 0, paper: 0, live: 0 });
  const warnings: string[] = [];
  if (signals.length < (options.minimumSamples ?? 30)) warnings.push(`样本量不足：${signals.length}`);
  if (signals.some(signal => signal.dataGap)) warnings.push('部分信号存在数据缺口');
  if (signals.some(signal => signal.futureDataRisk)) warnings.push('检测到未来数据风险');
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    total: signals.length,
    resolved: resolved.length,
    hitRate: resolved.length ? Number((wins / resolved.length).toFixed(4)) : 0,
    averageReturnPct: Number(average(resolved).toFixed(4)),
    benchmarkReturnPct: Number(options.benchmarkReturnPct || 0),
    averageMfePct: Number(average(signals.map(item => Number(item.mfePct)).filter(Number.isFinite)).toFixed(4)),
    averageMaePct: Number(average(signals.map(item => Number(item.maePct)).filter(Number.isFinite)).toFixed(4)),
    averageConfirmationDelayMs: Number(average(signals.map(item => Number(item.confirmationDelayMs)).filter(Number.isFinite)).toFixed(2)),
    sampleBreakdown,
    invalidationReasons: signals.reduce<Record<string, number>>((acc, signal) => { if (signal.invalidationReason) acc[signal.invalidationReason] = (acc[signal.invalidationReason] || 0) + 1; return acc; }, {}),
    warnings,
  };
}

export interface SavedWorkspace {
  id: string;
  name: string;
  market: MarketId;
  workspace: string;
  instrument?: string;
  timeframe?: string;
  filters: Record<string, unknown>;
  layers: string[];
  compare: string[];
  layout: { rightLibraryCollapsed: boolean };
  createdAt: string;
  updatedAt: string;
}

export function createSavedWorkspace(input: Omit<Partial<SavedWorkspace>, 'createdAt' | 'updatedAt'> & { name: string; market: MarketId; workspace: string }): SavedWorkspace {
  const context = assertMarketContext({ market: input.market, workspace: input.workspace, instrument: input.instrument, timeframe: input.timeframe });
  if (!input.name?.trim()) throw new Error('Workspace name is required');
  (input.compare || []).forEach(instrument => assertMarketContext({ market: input.market, workspace: input.workspace, instrument }));
  const now = new Date().toISOString();
  const payload = { name: input.name.trim(), market: input.market, workspace: context.workspace, instrument: context.instrument, timeframe: input.timeframe, filters: input.filters || {}, layers: [...new Set(input.layers || [])], compare: [...new Set(input.compare || [])], layout: { rightLibraryCollapsed: !!input.layout?.rightLibraryCollapsed } };
  return { ...payload, id: input.id || `workspace_${contentHash(payload).slice(0, 16)}`, createdAt: now, updatedAt: now };
}
