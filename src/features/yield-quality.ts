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
  sustainableApy: number;
  riskAdjustedApy: number;
  riskScore: number;
  riskLevelZh: '保守' | '平衡' | '进取' | '高风险';
  riskColor: 'green' | 'warning' | 'red';
  adviceZh: string;
  reasonZh: string[];
  stablecoin: boolean;
  impermanentLossRisk: boolean;
  exposure: string;
}

export interface YieldQualityResult {
  updatedAt: string;
  scanned: number;
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
let cache: CacheEntry | null = null;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const change7d = pool.apyPct7d == null ? Number.NaN : finiteNumber(pool.apyPct7d);

  if (tvl < 5_000_000 || apy < 1 || apy > 150 || pool.outlier) return null;

  const reasons: string[] = [];
  const stablecoin = pool.stablecoin === true;
  const ilRisk = String(pool.ilRisk || '').toLowerCase() === 'yes';
  const exposure = String(pool.exposure || 'unknown').toLowerCase();
  const prediction = String(pool.predictions?.predictedClass || '');

  // Use the lower of current and 30-day average APY. New pools without a
  // meaningful history are treated as if most of the headline APY may fade.
  const sustainableApy = meanApy > 0
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

  if (stablecoin) {
    score += 18;
    reasons.push('稳定币池，标的波动较低');
  }
  if (!ilRisk) {
    score += 15;
    reasons.push('无常损失风险标记为否');
  } else {
    score -= 25;
    reasons.push('存在无常损失风险');
  }
  if (exposure === 'single') {
    score += 10;
    reasons.push('单币敞口');
  } else if (exposure === 'multi') {
    score -= stablecoin ? 3 : 7;
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

  if (Number.isFinite(change7d)) {
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

  if (meanApy > 0) {
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

  if (apy > 0 && apyReward / apy > 0.75) {
    score -= 12;
    reasons.push('收益主要依赖奖励代币');
  } else if (apy > 0 && apyReward / apy > 0.5) {
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
  return {
    id: String(pool.pool || pool.id || `${pool.project}:${pool.symbol}:${pool.chain}`),
    project: String(pool.project || 'Unknown'),
    symbol: String(pool.symbol || 'Unknown'),
    chain: String(pool.chain || 'Unknown'),
    tvlUsd: round(tvl, 0),
    apy: round(apy, 2),
    sustainableApy: round(sustainableApy, 2),
    riskAdjustedApy: round(sustainableApy * score / 100, 2),
    riskScore: score,
    ...level,
    reasonZh: reasons.slice(0, 5),
    stablecoin,
    impermanentLossRisk: ilRisk,
    exposure,
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
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const response = await fetch('https://yields.llama.fi/pools', {
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`DefiLlama HTTP ${response.status}`);
  const payload = await response.json() as { data?: LlamaPool[] };
  const pools = Array.isArray(payload.data) ? payload.data : [];

  const scored = pools
    .map(scorePool)
    .filter((row): row is YieldQualityRow => row !== null);

  // The same vault can appear on several chains; keep the strongest version
  // per project/symbol so one farm does not fill the whole board.
  const deduplicated = new Map<string, YieldQualityRow>();
  for (const row of scored) {
    const key = `${row.project.toLowerCase()}:${row.symbol.toLowerCase()}`;
    const existing = deduplicated.get(key);
    if (!existing || row.riskAdjustedApy > existing.riskAdjustedApy) {
      deduplicated.set(key, row);
    }
  }

  const top = [...deduplicated.values()]
    .sort((a, b) => b.riskAdjustedApy - a.riskAdjustedApy || b.riskScore - a.riskScore)
    .slice(0, 36);

  const value: YieldQualityResult = {
    updatedAt: new Date().toISOString(),
    scanned: pools.length,
    eligible: scored.length,
    top,
    sources: ['DefiLlama Yields Pools'],
    ...buildSummary(top, pools.length),
  };
  cache = { ts: Date.now(), value };
  return value;
}
