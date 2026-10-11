/**
 * DeFi Yield Quality Radar
 *
 * Uses DefiLlama's keyless pool metadata to separate durable yield from
 * short-lived incentive spikes. The output is research information, not a
 * recommendation to deposit funds.
 */

export interface YieldQualityRow {
  id: string;
  project: string;
  symbol: string;
  chain: string;
  tvlUsd: number;
  apy: number;
  change7dPct: number | null;
  sustainableApy: number;
  riskAdjustedApy: number;
  riskScore: number;
  riskLevelZh: '保守' | '平衡' | '进取' | '高风险';
  riskColor: 'green' | 'warning' | 'red';
  adviceZh: string;
  reasonZh: string[];
  stablecoin: boolean | null;
  impermanentLossRisk: boolean | null;
  exposure: string;
  qualityWarnings: string[];
}

export interface YieldQualityResult {
  market: 'crypto';
  instrument: null;
  dataStatus: 'partial' | 'empty' | 'unavailable' | 'cached';
  source: string;
  sourceUpdatedAt: null;
  retrievedAt: string;
  updatedAt: string | null;
  cacheStatus: 'miss' | 'hit';
  reason: string | null;
  evidenceRefs: string[];
  scanned: number;
  invalidRows: number;
  incompleteRows: number;
  eligible: number;
  conservative: number;
  balanced: number;
  aggressive: number;
  highRisk: number;
  signalZh: string;
  adviceZh: string;
  top: YieldQualityRow[];
  sources: string[];
}

interface LlamaPool {
  id?: string;
  pool?: string;
  chain?: string;
  project?: string;
  symbol?: string;
  tvlUsd?: number;
  apy?: number;
  apyBase?: number;
  apyReward?: number;
  apyMean30d?: number;
  apyPct7d?: number;
  stablecoin?: boolean;
  ilRisk?: string;
  exposure?: string;
  outlier?: boolean;
  predictions?: {
    predictedClass?: string | null;
    predictedProbability?: number | null;
    binnedConfidence?: number | null;
  };
}

interface CacheEntry {
  ts: number;
  value: YieldQualityResult;
}

const CACHE_TTL_MS = 10 * 60_000;
const SOURCE = 'DefiLlama Yields Pools';
const SOURCE_URL = 'https://yields.llama.fi/pools';
const EMPTY_COUNTS = { conservative: 0, balanced: 0, aggressive: 0, highRisk: 0 };

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['yes', 'true'].includes(normalized)) return true;
  if (['no', 'false'].includes(normalized)) return false;
  return null;
}

function validPoolIdentity(pool: unknown): pool is LlamaPool {
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) return false;
  const row = pool as LlamaPool;
  return [row.project, row.symbol, row.chain].every(value =>
    typeof value === 'string' && value.trim().length > 0,
  );
}

function riskLevel(score: number): Pick<YieldQualityRow, 'riskLevelZh' | 'riskColor' | 'adviceZh'> {
  if (score >= 75) return {
    riskLevelZh: '保守',
    riskColor: 'green',
    adviceZh: '风险标记较完整，可小仓观察；仍要先核对合约审计、提现限制和费用。',
  };
  if (score >= 55) return {
    riskLevelZh: '平衡',
    riskColor: 'warning',
    adviceZh: '适合作为卫星收益；控制仓位，并预设收益衰减或 TVL 流出时的退出条件。',
  };
  if (score >= 35) return {
    riskLevelZh: '进取',
    riskColor: 'warning',
    adviceZh: '激励或价格波动影响较大；不建议把它当成稳健收益的核心仓位。',
  };
  return {
    riskLevelZh: '高风险',
    riskColor: 'red',
    adviceZh: 'APY 不稳定或风险缺口明显；不要仅因高 APY 参与。',
  };
}

function scorePool(pool: LlamaPool): YieldQualityRow | null {
  const tvl = finiteNumber(pool.tvlUsd);
  const apy = finiteNumber(pool.apy);
  const meanApy = finiteNumber(pool.apyMean30d);
  const apyReward = finiteNumber(pool.apyReward);
  const change7d = finiteNumber(pool.apyPct7d);

  if (tvl === null || apy === null || tvl < 5_000_000 || apy < 1 || apy > 150 || pool.outlier) return null;

  const reasons: string[] = [];
  const qualityWarnings: string[] = [];
  const stablecoin = booleanFlag(pool.stablecoin);
  const ilRisk = booleanFlag(pool.ilRisk);
  const exposure = String(pool.exposure || 'unknown').toLowerCase();
  const prediction = String(pool.predictions?.predictedClass || '');

  if (stablecoin === null) qualityWarnings.push('稳定币标记缺失，未计入稳定币正向分');
  if (ilRisk === null) qualityWarnings.push('无常损失字段缺失，未按“无风险”加分');
  if (exposure !== 'single' && exposure !== 'multi') qualityWarnings.push('资产敞口字段不可用');
  if (pool.apyPct7d == null) qualityWarnings.push('7日收益变化缺失');
  else if (change7d === null) qualityWarnings.push('7日收益变化字段无效');
  if (pool.apyMean30d == null) qualityWarnings.push('30日均值缺失，使用保守折减');
  else if (meanApy === null) qualityWarnings.push('30日均值字段无效，使用保守折减');
  if (pool.apyReward == null) qualityWarnings.push('奖励收益拆分缺失，无法判断代币激励占比');
  else if (apyReward === null) qualityWarnings.push('奖励收益拆分字段无效');

  // Use the lower of current and 30-day average APY. New pools without a
  // meaningful history are treated as if most of the headline APY may fade.
  const sustainableApy = meanApy !== null && meanApy > 0
    ? Math.min(apy, meanApy)
    : apy * 0.35;

  let score = 45;
  if (tvl >= 1_000_000_000) {
    score += 25;
    reasons.push('TVL 超过 10 亿美元');
  } else if (tvl >= 100_000_000) {
    score += 20;
    reasons.push('TVL 超过 1 亿美元');
  } else if (tvl >= 25_000_000) {
    score += 12;
    reasons.push('TVL 超过 2500 万美元');
  } else {
    score += 4;
    reasons.push('TVL 偏小，进出资金时要注意滑点');
  }

  if (stablecoin === true) {
    score += 18;
    reasons.push('稳定币池，标的波动较低');
  }
  if (ilRisk === false) {
    score += 15;
    reasons.push('无常损失风险标记为否');
  } else if (ilRisk === true) {
    score -= 25;
    reasons.push('存在无常损失风险');
  }
  if (exposure === 'single') {
    score += 10;
    reasons.push('单币敞口');
  } else if (exposure === 'multi') {
    score -= stablecoin === true ? 3 : 7;
    reasons.push('多币敞口，需关注组成资产');
  }

  if (prediction === 'Stable/Up') {
    score += 8;
    reasons.push('DefiLlama 预测为稳定或向上');
  } else if (prediction === 'Down') {
    score -= 20;
    reasons.push('DefiLlama 预测收益向下');
  }
  if (pool.predictions?.binnedConfidence === 2) score += 4;
  else if (pool.predictions?.binnedConfidence === 1) score += 1;

  if (change7d !== null) {
    if (change7d >= 0) {
      score += 4;
      reasons.push(`7 日收益变化 ${round(change7d, 1)}%`);
    } else if (change7d >= -20) {
      score += 1;
      reasons.push(`7 日收益小幅回落 ${round(change7d, 1)}%`);
    } else if (change7d >= -50) {
      score -= 8;
      reasons.push(`7 日收益回落 ${round(change7d, 1)}%`);
    } else {
      score -= 15;
      reasons.push(`7 日收益大幅回落 ${round(change7d, 1)}%`);
    }
  }

  if (meanApy !== null && meanApy > 0) {
    const spikeRatio = apy / meanApy;
    if (spikeRatio <= 1.25) {
      score += 8;
      reasons.push('当前 APY 与 30 日均值接近');
    } else if (spikeRatio <= 2) {
      score += 3;
      reasons.push('当前 APY 高于 30 日均值');
    } else if (spikeRatio <= 4) {
      score -= 8;
      reasons.push('当前 APY 明显高于 30 日均值');
    } else {
      score -= 18;
      reasons.push('当前 APY 疑似短期激励冲高');
    }
  } else {
    score -= 12;
    reasons.push('缺少可用的 30 日收益历史');
  }

  if (apyReward !== null && apy > 0 && apyReward / apy > 0.75) {
    score -= 12;
    reasons.push('收益主要依赖奖励代币');
  } else if (apyReward !== null && apy > 0 && apyReward / apy > 0.5) {
    score -= 6;
    reasons.push('奖励代币占收益比例较高');
  }
  if (apy > 100) {
    score -= 15;
    reasons.push('超高 APY 通常伴随更高衰减风险');
  } else if (apy > 50) {
    score -= 8;
    reasons.push('较高 APY 需要确认可持续性');
  }

  score = clamp(round(score, 1), 5, 98);
  const level = riskLevel(score);
  const adviceZh = qualityWarnings.length
    ? `${level.adviceZh} 字段信息不完整：${qualityWarnings.slice(0, 3).join('；')}。风险评分仅基于已知字段。`
    : level.adviceZh;
  return {
    id: String(pool.pool || pool.id || `${pool.project}:${pool.symbol}:${pool.chain}`),
    project: String(pool.project || 'Unknown'),
    symbol: String(pool.symbol || 'Unknown'),
    chain: String(pool.chain || 'Unknown'),
    tvlUsd: round(tvl, 0),
    apy: round(apy, 2),
    change7dPct: change7d === null ? null : round(change7d, 2),
    sustainableApy: round(sustainableApy, 2),
    riskAdjustedApy: round(sustainableApy * score / 100, 2),
    riskScore: score,
    ...level,
    adviceZh,
    reasonZh: [...reasons, ...qualityWarnings].slice(0, 8),
    stablecoin,
    impermanentLossRisk: ilRisk,
    exposure,
    qualityWarnings,
  };
}

function buildSummary(rows: YieldQualityRow[], scanned: number): Pick<
  YieldQualityResult,
  'conservative' | 'balanced' | 'aggressive' | 'highRisk' | 'signalZh' | 'adviceZh'
> {
  const conservative = rows.filter(row => row.riskLevelZh === '保守').length;
  const balanced = rows.filter(row => row.riskLevelZh === '平衡').length;
  const aggressive = rows.filter(row => row.riskLevelZh === '进取').length;
  const highRisk = rows.filter(row => row.riskLevelZh === '高风险').length;

  let signalZh = '稳健机会有限，市场偏激进';
  let adviceZh = '优先保持本金稳定；若要参与高 APY，只使用很小仓位并准备退出条件。';
  if (conservative >= 8) {
    signalZh = '稳健收益选择较多';
    adviceZh = '先比较可持续 APY、TVL 和提现规则；分散项目与链，不把资金压进单一池。';
  } else if (conservative >= 3) {
    signalZh = '有少量较稳收益';
    adviceZh = '可重点看保守池；其他高收益池只作为小仓位观察，不追短期排行。';
  } else if (balanced >= 5) {
    signalZh = '收益机会偏平衡';
    adviceZh = '控制单池上限，优先选择 TVL 更高、收益历史更稳的池子。';
  }

  return { conservative, balanced, aggressive, highRisk, signalZh, adviceZh };
}

export async function getYieldQuality(): Promise<YieldQualityResult> {
  return defaultYieldQualityService();
}

export interface YieldQualityServiceDependencies {
  fetchPools?: () => Promise<unknown>;
  now?: () => Date;
  cacheTtlMs?: number;
}

function defaultFetchPools(): Promise<unknown> {
  return fetch(SOURCE_URL, { signal: AbortSignal.timeout(25_000) }).then(async response => {
    if (!response.ok) throw new Error(`DefiLlama HTTP ${response.status}`);
    return response.json();
  });
}

function emptyYieldSummary(): Pick<YieldQualityResult,
  'conservative' | 'balanced' | 'aggressive' | 'highRisk' | 'signalZh' | 'adviceZh'
> {
  return {
    ...EMPTY_COUNTS,
    signalZh: '暂无符合筛选条件的收益池',
    adviceZh: '来源没有提供足够的可评估池记录；不要把空结果理解为低风险或无风险。',
  };
}

function unavailableYieldQuality(retrievedAt: string, reason: string): YieldQualityResult {
  return {
    market: 'crypto',
    instrument: null,
    dataStatus: 'unavailable',
    source: SOURCE,
    sourceUpdatedAt: null,
    retrievedAt,
    updatedAt: null,
    cacheStatus: 'miss',
    reason,
    evidenceRefs: [SOURCE_URL],
    scanned: 0,
    invalidRows: 0,
    incompleteRows: 0,
    eligible: 0,
    ...emptyYieldSummary(),
    top: [],
    sources: [SOURCE],
  };
}

function sourceTimeReason(): string {
  return '未取得可核验的来源更新时间；retrievedAt 仅表示 MoneyMoney 抓取时间，不代表实时数据。';
}

export function createYieldQualityService(dependencies: YieldQualityServiceDependencies = {}): () => Promise<YieldQualityResult> {
  const fetchPools = dependencies.fetchPools || defaultFetchPools;
  const now = dependencies.now || (() => new Date());
  const cacheTtlMs = dependencies.cacheTtlMs ?? CACHE_TTL_MS;
  let cache: CacheEntry | null = null;

  return async () => {
    const requestStartedAt = now();
    const requestTime = requestStartedAt.getTime();
    if (cache && requestTime - cache.ts >= 0 && requestTime - cache.ts < cacheTtlMs) {
      return { ...cache.value, dataStatus: 'cached', cacheStatus: 'hit' };
    }

    const retrievedAt = requestStartedAt.toISOString();
    let payload: unknown;
    try {
      payload = await fetchPools();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return unavailableYieldQuality(retrievedAt, `DefiLlama 来源请求失败：${detail.slice(0, 220)}`);
    }

    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
      return unavailableYieldQuality(retrievedAt, 'DefiLlama 响应缺少有效 data 数组，无法判断收益池覆盖。');
    }

    const pools = (payload as { data: unknown[] }).data;
    const scored: YieldQualityRow[] = [];
    let invalidRows = 0;
    for (const rawPool of pools) {
      if (!validPoolIdentity(rawPool)) {
        invalidRows += 1;
        continue;
      }
      if (finiteNumber(rawPool.tvlUsd) === null || finiteNumber(rawPool.apy) === null) invalidRows += 1;
      const row = scorePool(rawPool);
      if (row) scored.push(row);
    }

    // The same vault can appear on several chains; keep the strongest version
    // per project/symbol so one farm does not fill the whole board.
    const deduplicated = new Map<string, YieldQualityRow>();
    for (const row of scored) {
      const key = `${row.project.toLowerCase()}:${row.symbol.toLowerCase()}`;
      const existing = deduplicated.get(key);
      if (!existing || row.riskAdjustedApy > existing.riskAdjustedApy) deduplicated.set(key, row);
    }

    const top = [...deduplicated.values()]
      .sort((a, b) => b.riskAdjustedApy - a.riskAdjustedApy || b.riskScore - a.riskScore)
      .slice(0, 36);
    const incompleteRows = scored.filter(row => row.qualityWarnings.length > 0).length;
    const reasonParts = [sourceTimeReason()];
    if (invalidRows > 0) reasonParts.push(`${invalidRows} 条池记录缺少有效身份、TVL/APY 或对象结构，已排除。`);
    if (incompleteRows > 0) reasonParts.push(`${incompleteRows} 条入选记录存在缺失风险字段，评分仅基于已知字段。`);
    if (!pools.length) reasonParts.push('来源请求成功，但没有返回池记录。');
    else if (!top.length && !invalidRows) reasonParts.push(`${pools.length} 条来源记录中没有满足当前筛选门槛的池子。`);

    const summary = top.length ? buildSummary(top, pools.length) : emptyYieldSummary();
    const value: YieldQualityResult = {
      market: 'crypto',
      instrument: null,
      dataStatus: top.length || invalidRows > 0 ? 'partial' : 'empty',
      source: SOURCE,
      sourceUpdatedAt: null,
      retrievedAt,
      updatedAt: retrievedAt,
      cacheStatus: 'miss',
      reason: reasonParts.join(' '),
      evidenceRefs: [SOURCE_URL],
      scanned: pools.length,
      invalidRows,
      incompleteRows,
      eligible: scored.length,
      top,
      sources: [SOURCE],
      ...summary,
    };
    cache = { ts: requestTime, value };
    return value;
  };
}

export function yieldQualityEnvelope(result: YieldQualityResult) {
  return {
    success: result.dataStatus !== 'unavailable',
    market: result.market,
    instrument: result.instrument,
    dataStatus: result.dataStatus,
    source: result.source,
    sourceUpdatedAt: result.sourceUpdatedAt,
    retrievedAt: result.retrievedAt,
    updatedAt: result.updatedAt,
    reason: result.reason,
    evidenceRefs: result.evidenceRefs,
    data: result,
  };
}

export function yieldQualityHttpResponse(result: YieldQualityResult) {
  const body = yieldQualityEnvelope(result);
  return { status: body.success ? 200 : 503, body };
}

const defaultYieldQualityService = createYieldQualityService();
