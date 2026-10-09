export interface DeribitOptionIdentity {
  baseCurrency: 'BTC' | 'ETH';
  expiryDate: string;
  strike: number;
  optionType: 'call' | 'put';
}

export interface DeribitOptionExecutionQuote {
  market: 'options';
  status: 'live' | 'delayed';
  dataStatus: 'live' | 'delayed';
  price: number;
  fetchedAt: string;
  updatedAt: string;
  source: string;
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  optionContract: {
    instrumentId: string;
    source: string;
    verified: true;
    venue: 'deribit';
    currency: 'USD';
    multiplier: 1;
    expiresAt: string;
    sourceInstrumentName: string;
    instrumentType: 'reversed';
    baseCurrency: 'BTC' | 'ETH';
    quoteCurrency: 'BTC' | 'ETH';
    settlementCurrency: 'BTC' | 'ETH';
    counterCurrency: 'USD';
    optionType: 'call' | 'put';
    strike: number;
    contractSize: 1;
    minTradeAmount: number;
    takerCommission: number;
    indexPrice: number;
    rawBestBidPrice: number;
    rawBestAskPrice: number;
    bestBidAmount: number;
    bestAskAmount: number;
    retrievedAt: string;
  };
}

interface DeribitInstrument {
  instrument_name?: unknown;
  kind?: unknown;
  state?: unknown;
  is_active?: unknown;
  instrument_type?: unknown;
  base_currency?: unknown;
  quote_currency?: unknown;
  settlement_currency?: unknown;
  counter_currency?: unknown;
  price_index?: unknown;
  option_type?: unknown;
  strike?: unknown;
  expiration_timestamp?: unknown;
  contract_size?: unknown;
  min_trade_amount?: unknown;
  taker_commission?: unknown;
}

interface DeribitTicker {
  instrument_name?: unknown;
  state?: unknown;
  timestamp?: unknown;
  best_bid_price?: unknown;
  best_ask_price?: unknown;
  best_bid_amount?: unknown;
  best_ask_amount?: unknown;
  index_price?: unknown;
}

const DERIBIT_SOURCE = 'Deribit Public API';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const INSTRUMENT_NAME = /^(BTC|ETH)-(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})-(\d+(?:\.\d+)?)-([CP])$/;

export function parseDeribitOptionInstrumentName(value: string): DeribitOptionIdentity | null {
  const match = INSTRUMENT_NAME.exec(String(value || '').trim().toUpperCase());
  if (!match) return null;
  const baseCurrency = match[1] as 'BTC' | 'ETH';
  const day = Number(match[2]);
  const month = MONTHS.indexOf(match[3] as typeof MONTHS[number]);
  const year = 2000 + Number(match[4]);
  const strike = Number(match[5]);
  const dayAt = Date.UTC(year, month, day);
  if (!Number.isFinite(dayAt) || new Date(dayAt).getUTCFullYear() !== year
    || new Date(dayAt).getUTCMonth() !== month || new Date(dayAt).getUTCDate() !== day
    || !Number.isFinite(strike) || strike <= 0) return null;
  return {
    baseCurrency,
    expiryDate: new Date(dayAt).toISOString().slice(0, 10),
    strike,
    optionType: match[6] === 'C' ? 'call' : 'put',
  };
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function roundPrice(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function normalizeDeribitOptionExecutionQuote(
  instrument: DeribitInstrument,
  ticker: DeribitTicker,
  now = new Date(),
  maxAgeMs = 120_000,
): DeribitOptionExecutionQuote {
  const name = String(instrument.instrument_name || '').toUpperCase();
  const identity = parseDeribitOptionInstrumentName(name);
  const nowMs = now.getTime();
  if (!identity) throw new Error('Deribit 期权合约标识无效，仅支持完整 BTC/ETH 到期合约名');
  if (String(ticker.instrument_name || '').toUpperCase() !== name) throw new Error('Deribit 行情与请求期权合约身份不一致');
  if (instrument.kind !== 'option' || instrument.state !== 'open' || instrument.is_active !== true || ticker.state !== 'open') {
    throw new Error('Deribit 期权合约或盘口当前不接受新订单');
  }
  const baseCurrency = String(instrument.base_currency || '').toUpperCase();
  const quoteCurrency = String(instrument.quote_currency || '').toUpperCase();
  const settlementCurrency = String(instrument.settlement_currency || '').toUpperCase();
  const instrumentType = String(instrument.instrument_type || '').toLowerCase();
  const counterCurrency = String(instrument.counter_currency || '').toUpperCase();
  if (instrumentType !== 'reversed' || counterCurrency !== 'USD'
    || baseCurrency !== identity.baseCurrency || quoteCurrency !== baseCurrency || settlementCurrency !== baseCurrency
    || String(instrument.price_index || '').toLowerCase() !== `${identity.baseCurrency.toLowerCase()}_usd`) {
    throw new Error('Deribit 期权必须是反向 USD 计价合约，报价、结算与指数币种一致');
  }
  const strike = finite(instrument.strike);
  const contractSize = finite(instrument.contract_size);
  const minTradeAmount = finite(instrument.min_trade_amount);
  const takerCommission = finite(instrument.taker_commission);
  if (strike !== identity.strike || String(instrument.option_type || '').toLowerCase() !== identity.optionType
    || contractSize !== 1 || !Number.isFinite(minTradeAmount) || minTradeAmount <= 0
    || minTradeAmount > contractSize || Math.abs(contractSize / minTradeAmount - Math.round(contractSize / minTradeAmount)) > 1e-8
    || !Number.isFinite(takerCommission) || takerCommission <= 0 || takerCommission > 0.01) {
    throw new Error('Deribit 期权行权价、类型、合约大小、数量步长或来源手续费无法安全规范化');
  }
  const expirationMs = finite(instrument.expiration_timestamp);
  const expiration = new Date(expirationMs);
  if (!Number.isSafeInteger(expirationMs) || !Number.isFinite(expiration.getTime()) || expirationMs <= nowMs
    || expiration.toISOString().slice(0, 10) !== identity.expiryDate) {
    throw new Error('Deribit 期权到期信息无效、已到期或与合约名不一致');
  }
  const sourceTimestamp = finite(ticker.timestamp);
  const ageMs = nowMs - sourceTimestamp;
  if (!Number.isSafeInteger(sourceTimestamp) || !Number.isFinite(new Date(sourceTimestamp).getTime()) || ageMs < 0) {
    throw new Error('Deribit 期权盘口时间缺失或晚于当前时间');
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || ageMs > maxAgeMs) throw new Error('Deribit 期权盘口已过期');
  const rawBid = finite(ticker.best_bid_price);
  const rawAsk = finite(ticker.best_ask_price);
  const bidAmount = finite(ticker.best_bid_amount);
  const askAmount = finite(ticker.best_ask_amount);
  const indexPrice = finite(ticker.index_price);
  if (!Number.isFinite(rawBid) || !Number.isFinite(rawAsk) || rawBid <= 0 || rawAsk < rawBid
    || !Number.isFinite(bidAmount) || !Number.isFinite(askAmount) || bidAmount < contractSize || askAmount < contractSize
    || !Number.isFinite(indexPrice) || indexPrice <= 0) {
    throw new Error('Deribit 期权盘口缺少有效双边价格、一个完整合约的可见深度或 USD 指数');
  }
  const bestBid = roundPrice(rawBid * indexPrice);
  const bestAsk = roundPrice(rawAsk * indexPrice);
  const retrievedAt = now.toISOString();
  const fetchedAt = new Date(sourceTimestamp).toISOString();
  const status = ageMs <= 15_000 ? 'live' : 'delayed';
  return {
    market: 'options', status, dataStatus: status,
    price: roundPrice((bestBid + bestAsk) / 2),
    fetchedAt, updatedAt: fetchedAt, source: DERIBIT_SOURCE,
    bestBid, bestAsk,
    // This first runner path deliberately permits integer contracts only.
    bestBidSize: Math.floor(bidAmount / contractSize + 1e-9),
    bestAskSize: Math.floor(askAmount / contractSize + 1e-9),
    optionContract: {
      instrumentId: `option:deribit:${name}`, source: DERIBIT_SOURCE, verified: true,
      venue: 'deribit', currency: 'USD', multiplier: 1, expiresAt: expiration.toISOString(),
      sourceInstrumentName: name, instrumentType: 'reversed', baseCurrency: identity.baseCurrency,
      quoteCurrency: quoteCurrency as 'BTC' | 'ETH', settlementCurrency: settlementCurrency as 'BTC' | 'ETH',
      counterCurrency: 'USD',
      optionType: identity.optionType, strike, contractSize: 1, minTradeAmount,
      takerCommission, indexPrice, rawBestBidPrice: rawBid, rawBestAskPrice: rawAsk,
      bestBidAmount: bidAmount, bestAskAmount: askAmount, retrievedAt,
    },
  };
}

export async function fetchDeribitOptionExecutionQuote(
  instrumentName: string,
  options: { fetcher?: typeof fetch; now?: Date; maxAgeMs?: number; timeoutMs?: number } = {},
): Promise<DeribitOptionExecutionQuote> {
  const name = String(instrumentName || '').trim().toUpperCase();
  if (!parseDeribitOptionInstrumentName(name)) throw new Error('期权合约标识无效，仅支持 Deribit BTC/ETH 完整到期合约名');
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.max(500, Math.min(10_000, Number(options.timeoutMs) || 5_000));
  const endpoint = new URL('https://www.deribit.com/api/v2/public/');
  const request = async (method: 'get_instrument' | 'ticker'): Promise<unknown> => {
    const url = new URL(method, endpoint);
    url.searchParams.set('instrument_name', name);
    const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Deribit ${method} HTTP ${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: { message?: unknown } };
    if (payload.error) throw new Error(String(payload.error.message || `Deribit ${method} 请求失败`).slice(0, 200));
    if (!payload.result || typeof payload.result !== 'object') throw new Error(`Deribit ${method} 没有返回合约数据`);
    return payload.result;
  };
  const [instrument, ticker] = await Promise.all([request('get_instrument'), request('ticker')]);
  const instrumentResult = instrument as DeribitInstrument;
  const tickerResult = ticker as DeribitTicker;
  if (String(instrumentResult.instrument_name || '').toUpperCase() !== name
    || String(tickerResult.instrument_name || '').toUpperCase() !== name) {
    throw new Error('Deribit 返回的合约身份与请求的合约身份不一致');
  }
  return normalizeDeribitOptionExecutionQuote(
    instrumentResult,
    tickerResult,
    options.now || new Date(),
    options.maxAgeMs ?? 120_000,
  );
}
