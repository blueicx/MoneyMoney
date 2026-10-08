import { createHash, randomUUID } from 'node:crypto';
import { stateStore } from '../storage/sqlite-state';
import { createAiRunner, freezeAiRunnerUniverse, getAiRunners, type AiRunner, type AiRunnerPolicy, type AiRunnerInstrumentRef, type AiRunnerVenue } from './ai-paper-runner';

export interface AiRunnerComparisonGroup {
  id: string; market: string; createdAt: string; runnerIds: string[]; universeHash: string;
  seed: number; temperature: 0; configHash: string;
}
interface SampleInput { market: string; instrument: string; [key: string]: unknown; }
export interface AiRunnerComparisonSample {
  id: string; groupId: string; at: string; hash: string;
  snapshots: Array<SampleInput & { snapshotHash: string }>;
  results?: unknown[];
  resultsHash?: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const groupKey = (id: string) => 'ai-runner-comparison:' + id;
const sampleKey = (id: string) => groupKey(id) + ':samples';
export function getAiRunnerComparison(id: string) { return stateStore.get<AiRunnerComparisonGroup>(groupKey(id)); }

export function createAiRunnerComparison(venue: AiRunnerVenue, instrument: string, title: string, budget: number,
  policy: Partial<AiRunnerPolicy>, options: { seed: number; model?: string; universe?: { kind?: 'single' | 'watchlist'; sourceWatchlistId?: string; instruments?: AiRunnerInstrumentRef[] } }) {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 2147483647) throw new Error('对照随机种子必须为0–2147483647的整数');
  if (options.model != null && (typeof options.model !== 'string' || options.model.length > 160)) throw new Error('模型标识无效');
  const refs = options.universe?.instruments?.length ? options.universe.instruments : [{ venue, symbolOrMarketId: instrument, title }];
  const frozen = freezeAiRunnerUniverse(refs, { kind: options.universe?.kind, sourceWatchlistId: options.universe?.sourceWatchlistId });
  const id = randomUUID(), at = new Date().toISOString();
  return stateStore.transaction(() => {
    const rows = (['rules', 'ai-review', 'ai-autonomous-paper'] as const).map(mode => createAiRunner(venue, instrument, title, budget, policy, {
      mode, trigger: 'scheduled', universe: options.universe, model: options.model, startPaused: true, createdAt: at,
      comparisonControl: { groupId: id, seed: options.seed, temperature: 0, configHash: '' },
    }));
    const configHash = hash({ universe: frozen.hash, budget, policy: rows[0].policy, at, seed: options.seed, temperature: 0, model: options.model || null });
    const all = stateStore.get<AiRunner[]>('ai-paper-runners') || [];
    for (const row of all.filter(row => rows.some(arm => arm.id === row.id))) row.comparisonControl!.configHash = configHash;
    stateStore.set('ai-paper-runners', all);
    const group: AiRunnerComparisonGroup = { id, market: frozen.market, createdAt: at, runnerIds: rows.map(row => row.id), universeHash: frozen.hash, seed: options.seed, temperature: 0, configHash };
    stateStore.set(groupKey(id), group);
    return group;
  });
}
export function validateAiRunnerComparison(group: AiRunnerComparisonGroup, rows: AiRunner[]) {
  const roles = ['rules', 'ai-review', 'ai-autonomous-paper'] as const;
  const versions = ['rsi-sma-v1', 'ai-review-v1', 'ai-autonomous-paper-v1'];
  const complete = rows.length === 3 && new Set(group.runnerIds).size === 3
    && group.runnerIds.every(id => rows.some(row => row.id === id));
  let frozenValid = false;
  try {
    frozenValid = complete && rows.every(row => {
      const universe = row.universe!;
      const verified = freezeAiRunnerUniverse([...universe.instruments], { kind: universe.kind, sourceWatchlistId: universe.sourceWatchlistId });
      const role = group.runnerIds.indexOf(row.id);
      return verified.hash === group.universeHash && verified.market === group.market
        && row.accountId === 'ai-runner:' + row.id && row.executionState === 'ready'
        && row.mode === roles[role] && row.strategyVersion === versions[role] && row.trigger === 'scheduled'
        && (row.modelSelection == null || row.modelSelection === 'fixed')
        && (row.quoteSelection == null || row.quoteSelection === 'fixed')
        && hash({ universe: verified.hash, budget: row.budgetUsd, policy: row.policy, at: group.createdAt,
          seed: group.seed, temperature: group.temperature, model: row.model || null }) === group.configHash;
    });
  } catch { /* Unknown/corrupt legacy configuration remains read-only; never guess a replacement. */ }
  const valid = frozenValid && rows.every(row => row.universe?.market === group.market && row.universe.hash === group.universeHash
    && row.createdAt === group.createdAt && row.comparisonControl?.configHash === group.configHash
    && row.comparisonControl.groupId === group.id && row.comparisonControl.seed === group.seed
    && row.comparisonControl.temperature === group.temperature
    && row.budgetUsd === rows[0].budgetUsd && canonical(row.policy) === canonical(rows[0].policy));
  return { valid, reason: valid ? '共同冻结配置已核验；模型供应商不保证seed完全确定，历史重放不会再次调用模型' : '对照配置已改变或账户缺失，拒绝执行' };
}
/** Resume and execution must validate the scheduler against the same frozen accounts. */
export function validateScheduledAiRunnerComparison(
  scheduled: { market: string; groupId: string; model: string; instruments: string[] },
  group: AiRunnerComparisonGroup | null | undefined, rows: AiRunner[],
) {
  const instruments = rows[0]?.universe?.instruments.map(row => row.symbolOrMarketId) ?? [];
  const valid = !!group && validateAiRunnerComparison(group, rows).valid
    && scheduled.groupId === group.id && scheduled.market === group.market
    && !!scheduled.model.trim() && !['openrouter/free', 'openrouter/auto'].includes(scheduled.model)
    && rows.every(row => row.model === scheduled.model)
    && new Set(scheduled.instruments).size === scheduled.instruments.length
    && scheduled.instruments.length === instruments.length
    && scheduled.instruments.every(id => instruments.includes(id));
  return { valid, reason: valid ? '固定对照模型、账户与冻结标的已核验' : '自动对照账户、固定模型或冻结标的不一致；拒绝恢复或执行' };
}
export function buildAiRunnerComparisonSample(group: AiRunnerComparisonGroup, id: string, at: string, inputs: Array<{ market: string; instrument: string }>): AiRunnerComparisonSample {
  if (!id || id.length > 180 || !Number.isFinite(Date.parse(at)) || inputs.length < 1 || inputs.length > 5) throw new Error('对照采样参数无效');
  const rows = group.runnerIds.map(id => getAiRunners().find(row => row.id === id)).filter((row): row is AiRunner => !!row);
  if (!validateAiRunnerComparison(group, rows).valid) throw new Error('对照配置无效');
  const allowed = new Set(rows[0].universe!.instruments.map(row => row.symbolOrMarketId.toUpperCase()));
  if (inputs.some(row => row.market !== group.market || !allowed.has(row.instrument)) || new Set(inputs.map(row => row.instrument)).size !== inputs.length) throw new Error('采样市场或标的与冻结范围不一致');
  const snapshots = inputs.map(input => {
    const clean = Object.fromEntries(Object.entries(input).filter(([key]) => !['snapshotHash', 'openPosition', 'requestedAction', 'requestedSide', 'requestReason'].includes(key))) as SampleInput;
    return { ...clean, snapshotHash: hash(clean) };
  });
  return { id, groupId: group.id, at, snapshots, hash: hash({ groupId: group.id, id, at, snapshots }) };
}
export function saveAiRunnerComparisonSample(groupId: string, sample: AiRunnerComparisonSample) {
  if (sample.groupId !== groupId || sample.hash !== hash({ groupId, id: sample.id, at: sample.at, snapshots: sample.snapshots })
    || sample.snapshots.some(row => { const { snapshotHash, ...input } = row; return snapshotHash !== hash(input); })) throw new Error('采样Hash不匹配');
  const normalized = { ...sample, ...(sample.results ? { resultsHash: hash(sample.results) } : {}) };
  stateStore.transaction(() => {
    const prior = stateStore.get<AiRunnerComparisonSample[]>(sampleKey(groupId)) || [];
    const existing = prior.find(row => row.id === sample.id);
    if (existing && existing.hash !== sample.hash) throw new Error('同一采样ID不能覆盖另一份Hash');
    if (existing?.resultsHash && existing.resultsHash !== normalized.resultsHash) throw new Error('已完成对照输出Hash不可覆盖');
    stateStore.set(sampleKey(groupId), [normalized, ...prior.filter(row => row.id !== sample.id)].slice(0, 200));
  });
  return normalized;
}
export function listAiRunnerComparisonSamples(groupId: string) { return stateStore.get<AiRunnerComparisonSample[]>(sampleKey(groupId)) || []; }
export function replayAiRunnerComparisonSample(groupId: string, id: string) {
  const sample = listAiRunnerComparisonSamples(groupId).find(row => row.id === id);
  if (!sample) throw new Error('采样不存在');
  if (sample.hash !== hash({ groupId, id: sample.id, at: sample.at, snapshots: sample.snapshots })
    || (sample.results && sample.resultsHash !== hash(sample.results))) throw new Error('采样或输出Hash不匹配');
  return { sample, executionEnabled: false, modelCalls: 0, reason: '重放保存的共同输入与已记录输出；不创建订单、不调用模型，不宣称供应商seed确定性' };
}
