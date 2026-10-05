export type TelegramStockMarket = 'us' | 'hk' | 'sh' | 'sz' | 'bj';
export type TelegramStockSignalSource = 'fixed' | 'mover' | 'watchlist';
export type TelegramMoverSourceState = 'pending' | 'live' | 'cached' | 'stale' | 'empty' | 'unavailable';

export interface TelegramStockSignalIdentity {
  market: TelegramStockMarket;
  symbol: string;
  instrumentId: string;
}

export interface TelegramStockMover {
  symbol: string;
  name?: string;
  changePct: number;
  volume?: number;
  marketCapUsd?: number | null;
}

export interface TelegramMoverSourceStatus {
  state: TelegramMoverSourceState;
  source: string;
  updatedAt: string | null;
  reason?: string;
}

export interface TelegramStockSignalCandidate extends TelegramStockSignalIdentity {
  sources: TelegramStockSignalSource[];
  name?: string;
  mover?: TelegramStockMover & { updatedAt: string };
}

export interface BuildTelegramStockSignalUniverseInput {
  telegramWatchlistIds: string[];
  administratorWatchlistIds?: string[];
  isAdmin: boolean;
  movers?: TelegramStockMover[];
  moverStatus: TelegramMoverSourceStatus;
}

export interface TelegramStockSignalUniverse {
  candidates: TelegramStockSignalCandidate[];
  moverStatus: TelegramMoverSourceStatus;
}

const FIXED_STOCK_IDS = [
  'usAAPL', 'usMSFT', 'usNVDA', 'usAMZN', 'usGOOGL', 'usMETA', 'usTSLA',
  'usSPY', 'usQQQ', 'hk00700', 'sh600519',
] as const;

const FIXED_NAMES: Record<string, string> = {
  'stock:us:AAPL': '苹果',
  'stock:us:MSFT': '微软',
  'stock:us:NVDA': '英伟达',
  'stock:us:AMZN': '亚马逊',
  'stock:us:GOOGL': 'Alphabet',
  'stock:us:META': 'Meta',
  'stock:us:TSLA': '特斯拉',
  'stock:us:SPY': '标普500 ETF',
  'stock:us:QQQ': '纳指100 ETF',
  'stock:hk:00700': '腾讯控股',
  'stock:sh:600519': '贵州茅台',
};

function normalizeMarketSymbol(market: TelegramStockMarket, raw: string): string | null {
  const symbol = String(raw || '').trim().toUpperCase();
  if (market === 'us') {
    return /^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol) && !/[.-]{2}|[.-]$/.test(symbol) ? symbol : null;
  }
  if (!/^\d{1,6}$/.test(symbol)) return null;
  if (market === 'hk') return symbol.length <= 5 ? symbol.padStart(5, '0') : symbol;
  return /^\d{6}$/.test(symbol) ? symbol : null;
}

/** Resolve only IDs which carry an explicit, supported stock market identity. */
export function normalizeTelegramStockSignalIdentity(value: string): TelegramStockSignalIdentity | null {
  const input = String(value || '').trim();
  let market: TelegramStockMarket | null = null;
  let rawSymbol = '';
  const canonical = input.match(/^stock:(us|hk|sh|sz|bj):([A-Z0-9.-]+)$/i);
  if (canonical) {
    market = canonical[1].toLowerCase() as TelegramStockMarket;
    rawSymbol = canonical[2];
  } else {
    const legacy = input.match(/^(us[A-Z][A-Z0-9.-]{0,11}|hk\d{1,6}|(?:sh|sz|bj)\d{6})$/i);
    if (!legacy) return null;
    const prefix = legacy[1].slice(0, 2).toLowerCase();
    market = prefix as TelegramStockMarket;
    rawSymbol = legacy[1].slice(2);
  }

  const symbol = normalizeMarketSymbol(market, rawSymbol);
  if (!symbol) return null;
  return { market, symbol, instrumentId: `stock:${market}:${symbol}` };
}

function addCandidate(
  candidates: Map<string, TelegramStockSignalCandidate>,
  identity: TelegramStockSignalIdentity,
  source: TelegramStockSignalSource,
  details: { name?: string; mover?: TelegramStockSignalCandidate['mover'] } = {},
): void {
  const existing = candidates.get(identity.instrumentId);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (!existing.name && details.name) existing.name = details.name;
    if (details.mover) existing.mover = details.mover;
    return;
  }
  candidates.set(identity.instrumentId, {
    ...identity,
    sources: [source],
    name: details.name || FIXED_NAMES[identity.instrumentId],
    ...(details.mover ? { mover: details.mover } : {}),
  });
}

/** Build an isolated stock-only universe while preserving every source label. */
export function buildTelegramStockSignalUniverse(input: BuildTelegramStockSignalUniverseInput): TelegramStockSignalUniverse {
  const candidates = new Map<string, TelegramStockSignalCandidate>();
  for (const id of FIXED_STOCK_IDS) {
    const identity = normalizeTelegramStockSignalIdentity(id);
    if (identity) addCandidate(candidates, identity, 'fixed');
  }

  const moverStatus: TelegramMoverSourceStatus = {
    state: input.moverStatus.state,
    source: String(input.moverStatus.source || 'Nasdaq Public Screener'),
    updatedAt: input.moverStatus.updatedAt || null,
    ...(input.moverStatus.reason ? { reason: input.moverStatus.reason } : {}),
  };
  const acceptedMovers = input.movers || [];
  if (['live', 'cached', 'stale'].includes(moverStatus.state) && acceptedMovers.length) {
    for (const row of acceptedMovers) {
      const identity = normalizeTelegramStockSignalIdentity(`stock:us:${row.symbol}`);
      if (!identity || !Number.isFinite(row.changePct)) continue;
      addCandidate(candidates, identity, 'mover', {
        name: row.name,
        mover: { ...row, symbol: identity.symbol, updatedAt: moverStatus.updatedAt || new Date(0).toISOString() },
      });
    }
  }
  if (['live', 'cached'].includes(moverStatus.state) && ![...candidates.values()].some(item => item.sources.includes('mover'))) {
    moverStatus.state = 'empty';
  }

  const permittedWatchlists = [
    ...(input.telegramWatchlistIds || []),
    ...(input.isAdmin ? input.administratorWatchlistIds || [] : []),
  ];
  for (const id of permittedWatchlists) {
    const identity = normalizeTelegramStockSignalIdentity(id);
    if (identity) addCandidate(candidates, identity, 'watchlist');
  }

  return { candidates: [...candidates.values()], moverStatus };
}
