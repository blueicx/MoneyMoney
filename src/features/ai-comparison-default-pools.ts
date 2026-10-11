import type { AiRunnerInstrumentRef } from './ai-paper-runner';
import { parseDeribitOptionInstrumentName } from './runner-deribit-options';

const DAY_MS = 86_400_000;
const MAX_SNAPSHOT_AGE_MS = 120_000;
const MIN_OPTION_DAYS = 7;
const MAX_OPTION_DAYS = 45;
const OPTION_ASSETS = ['BTC', 'ETH'] as const;
const OPTION_TYPES = ['call', 'put'] as const;

export type DefaultComparisonMarket = 'stocks' | 'options' | 'crypto' | 'prediction';
export interface DefaultComparisonEvidence {
  instrument: string;
  source: string;
  status: 'live' | 'delayed';
  dataAt: string;
  retrievedAt?: string;
}
export interface DefaultComparisonPool {
  market: DefaultComparisonMarket;
  status: 'ready' | 'partial' | 'unavailable' | 'unsupported';
  sourceWatchlistId: string;
  instruments: AiRunnerInstrumentRef[];
  excluded: string[];
  evidence: DefaultComparisonEvidence[];
  reason: string;
}

interface OptionChainRow {
  instrumentName?: unknown;
  strike?: unknown;
  optionType?: unknown;
  bidPrice?: unknown;
  askPrice?: unknown;
  spreadPct?: unknown;
  openInterest?: unknown;
  quoteQuality?: { status?: unknown };
}
interface OptionChainSnapshot {
  source?: unknown;
  market?: unknown;
  asset?: unknown;
  fetchedAt?: unknown;
  spot?: unknown;
  expiries?: Array<{ expiryMs?: unknown; rows?: OptionChainRow[] }>;
}
interface VerifiedOptionQuote {
  market?: unknown;
  dataStatus?: unknown;
  fetchedAt?: unknown;
  source?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
  optionContract?: {
    instrumentId?: unknown;
    sourceInstrumentName?: unknown;
    venue?: unknown;
    verified?: unknown;
    currency?: unknown;
    multiplier?: unknown;
    expiresAt?: unknown;
    retrievedAt?: unknown;
  };
}
interface Dependencies {
  now?: number;
  getOptionsSnapshot?: (asset: 'BTC' | 'ETH') => Promise<OptionChainSnapshot>;
  verifyOptionQuote?: (instrumentName: string) => Promise<VerifiedOptionQuote>;
}
interface Candidate {
  asset: 'BTC' | 'ETH';
  instrumentName: string;
  optionType: 'call' | 'put';
  strike: number;
  spot: number;
  expiryMs: number;
  spreadPct: number;
  openInterest: number;
}

const sourceId = (market: DefaultComparisonMarket) => `defaults:${market}:v1`;
const failure = (market: DefaultComparisonMarket, status: DefaultComparisonPool['status'], reason: string, excluded: string[] = []): DefaultComparisonPool => ({
  market, status, sourceWatchlistId: sourceId(market), instruments: [], excluded, evidence: [], reason,
});

function snapshotCandidates(asset: 'BTC' | 'ETH', snapshot: OptionChainSnapshot, now: number): { candidates: Candidate[]; reason?: string } {
  if (snapshot.source !== 'Deribit Public API' || snapshot.market !== 'crypto' || String(snapshot.asset || '').toUpperCase() !== asset) {
    return { candidates: [], reason: `${asset}期权链来源或标的身份不匹配` };
  }
  const fetchedAt = Date.parse(String(snapshot.fetchedAt || ''));
  if (!Number.isFinite(fetchedAt) || fetchedAt > now || now - fetchedAt > MAX_SNAPSHOT_AGE_MS) {
    return { candidates: [], reason: `${asset}期权链快照已过期或时间无效` };
  }
  const spot = Number(snapshot.spot);
  if (!Number.isFinite(spot) || spot <= 0 || !Array.isArray(snapshot.expiries)) {
    return { candidates: [], reason: `${asset}期权链缺少有效指数或到期数据` };
  }
  const rows: Candidate[] = [];
  for (const expiry of snapshot.expiries) {
    const expiryMs = Number(expiry.expiryMs);
    if (!Number.isSafeInteger(expiryMs) || expiryMs < now + MIN_OPTION_DAYS * DAY_MS || expiryMs > now + MAX_OPTION_DAYS * DAY_MS) continue;
    for (const row of expiry.rows || []) {
      const name = String(row.instrumentName || '').trim().toUpperCase();
      const identity = parseDeribitOptionInstrumentName(name);
      const strike = Number(row.strike), bid = Number(row.bidPrice), ask = Number(row.askPrice);
      const spreadPct = Number(row.spreadPct), openInterest = Number(row.openInterest);
      if (!identity || identity.baseCurrency !== asset || identity.expiryDate !== new Date(expiryMs).toISOString().slice(0, 10)
        || identity.optionType !== row.optionType || row.quoteQuality?.status !== 'quoted'
        || !Number.isFinite(strike) || strike !== identity.strike || strike <= 0
        || !Number.isFinite(bid) || bid <= 0 || !Number.isFinite(ask) || ask < bid
        || !Number.isFinite(spreadPct) || spreadPct < 0 || spreadPct > 10
        || !Number.isFinite(openInterest) || openInterest <= 0) continue;
      rows.push({ asset, instrumentName: name, optionType: identity.optionType, strike, spot, expiryMs, spreadPct, openInterest });
    }
  }
  return rows.length ? { candidates: rows } : { candidates: [], reason: `${asset}暂无7–45日内同时具备有效双边报价、窄价差和持仓量的合约` };
}

function chooseCandidates(candidates: Candidate[]) {
  const chosen: Candidate[] = [];
  for (const asset of OPTION_ASSETS) for (const optionType of OPTION_TYPES) {
    const rows = candidates.filter(row => row.asset === asset && row.optionType === optionType)
      .sort((a, b) => Math.abs(a.strike - a.spot) / a.spot - Math.abs(b.strike - b.spot) / b.spot
        || a.spreadPct - b.spreadPct || b.openInterest - a.openInterest || a.expiryMs - b.expiryMs);
    if (rows[0]) chosen.push(rows[0]);
  }
  return chosen;
}

function validateVerifiedQuote(name: string, expectedExpiry: number, quote: VerifiedOptionQuote, now: number) {
  const contract = quote.optionContract;
  const fetchedAt = Date.parse(String(quote.fetchedAt || ''));
  const expiresAt = Date.parse(String(contract?.expiresAt || ''));
  const bid = Number(quote.bestBid), ask = Number(quote.bestAsk);
  if (quote.market !== 'options' || !['live', 'delayed'].includes(String(quote.dataStatus))
    || !Number.isFinite(fetchedAt) || fetchedAt > now || now - fetchedAt > MAX_SNAPSHOT_AGE_MS
    || !contract || contract.verified !== true || contract.venue !== 'deribit' || contract.currency !== 'USD' || contract.multiplier !== 1
    || String(contract.sourceInstrumentName || '').toUpperCase() !== name
    || String(contract.instrumentId || '').toLowerCase() !== `option:deribit:${name.toLowerCase()}`
    || !Number.isFinite(expiresAt) || expiresAt <= now
    || new Date(expiresAt).toISOString().slice(0, 10) !== new Date(expectedExpiry).toISOString().slice(0, 10)
    || !Number.isFinite(bid) || bid <= 0 || !Number.isFinite(ask) || ask < bid) {
    throw new Error('实时合约身份、报价时间、到期日或USD双边报价未通过核验');
  }
}

export async function resolveDefaultComparisonPool(market: DefaultComparisonMarket, dependencies: Dependencies = {}): Promise<DefaultComparisonPool> {
  const now = dependencies.now ?? Date.now();
  if (!Number.isFinite(now)) return failure(market, 'unavailable', '默认池核验时点无效');
  if (market === 'stocks') return failure(market, 'unsupported', '股票默认组已绑定管理员冻结自选；不会覆盖现有股票组或替换自选范围');
  if (market === 'prediction') return failure(market, 'unsupported', '当前预测市场缺少可独立核验的官方结算规则；不创建模拟对照池');
  if (market === 'crypto') return {
    market, status: 'ready', sourceWatchlistId: sourceId(market),
    instruments: [
      { venue: 'Binance', symbolOrMarketId: 'BTCUSDT', title: 'BTC/USDT 现货' },
      { venue: 'Binance', symbolOrMarketId: 'ETHUSDT', title: 'ETH/USDT 现货' },
    ], excluded: [], evidence: [],
    reason: '仅冻结 Binance BTC/USDT、ETH/USDT 现货身份；每轮仍必须实时复核K线、双边盘口和数据新鲜度，失败时整轮等待，不调用模型、不下模拟单。',
  };
  if (!dependencies.getOptionsSnapshot || !dependencies.verifyOptionQuote) return failure(market, 'unavailable', '缺少 Deribit 实际期权链或逐合约报价核验器');

  const snapshots = await Promise.all(OPTION_ASSETS.map(async asset => {
    try { return { asset, snapshot: await dependencies.getOptionsSnapshot!(asset) }; }
    catch (error) { return { asset, error: error instanceof Error ? error.message : 'Deribit 来源请求失败' }; }
  }));
  const candidates: Candidate[] = [], excluded: string[] = [];
  for (const row of snapshots) {
    if ('error' in row) { excluded.push(`${row.asset}期权链来源不可用：${String(row.error || '来源请求失败').slice(0, 180)}`); continue; }
    const result = snapshotCandidates(row.asset, row.snapshot, now);
    candidates.push(...result.candidates);
    if (result.reason) excluded.push(result.reason);
  }
  const selected = chooseCandidates(candidates);
  if (!selected.length) return failure(market, 'unavailable', 'Deribit 当前没有通过链数据质量门槛的默认合约；未创建对照账户', excluded);

  const verified = await Promise.all(selected.map(async candidate => {
    try {
      const quote = await dependencies.verifyOptionQuote!(candidate.instrumentName);
      validateVerifiedQuote(candidate.instrumentName, candidate.expiryMs, quote, now);
      return {
        candidate,
        instrument: { venue: 'Options' as const, symbolOrMarketId: candidate.instrumentName,
          title: `${candidate.asset} ${candidate.optionType === 'call' ? '看涨' : '看跌'} ${candidate.strike}` },
        evidence: {
          instrument: candidate.instrumentName, source: String(quote.source || 'Deribit Public API'),
          status: quote.dataStatus as 'live' | 'delayed', dataAt: String(quote.fetchedAt),
          ...(quote.optionContract?.retrievedAt ? { retrievedAt: String(quote.optionContract.retrievedAt) } : {}),
        } satisfies DefaultComparisonEvidence,
      };
    } catch (error) {
      return { candidate, error: error instanceof Error ? error.message : 'Deribit 单合约报价核验失败' };
    }
  }));
  const valid = verified.filter((row): row is Extract<typeof row, { instrument: AiRunnerInstrumentRef }> => 'instrument' in row);
  for (const row of verified) if ('error' in row) excluded.push(`${row.candidate.instrumentName}未通过实时核验：${String(row.error || '实时合约报价不合格').slice(0, 180)}`);
  if (!valid.length) return failure(market, 'unavailable', '候选合约均未通过实时双边报价核验；未创建对照账户', excluded);
  const instruments = valid.map(row => row.instrument);
  const evidence = valid.map(row => row.evidence);
  return {
    market, status: instruments.length === 4 && excluded.length === 0 ? 'ready' : 'partial',
    sourceWatchlistId: sourceId(market), instruments, excluded, evidence,
    reason: `已从 Deribit 真实期权链筛选并逐一核验 ${instruments.length}/4 个有限损失买入候选；仅冻结身份，自动组默认暂停，不调用模型或下单。`,
  };
}
