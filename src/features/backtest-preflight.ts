export type BacktestMarket = 'stocks' | 'crypto';
export interface PreflightBar {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface BacktestPreflightInput {
  market: string;
  instrument: string;
  bars: readonly PreflightBar[];
  source?: string | null;
  sourceStatus?: string | null;
  sourceError?: string | null;
  lookback: number;
  holding: number;
}

function validIdentity(market: BacktestMarket, instrument: string): boolean {
  const value = instrument.trim().toUpperCase();
  if (market === 'stocks') return /^[A-Z][A-Z0-9.-]{0,9}$/.test(value) && !/(USDT|USDC|BTC|ETH)$/.test(value);
  return /^[A-Z0-9]{5,20}$/.test(value) && /(USDT|USDC|USD|BTC|ETH)$/.test(value);
}

export function buildBacktestPreflight(input: BacktestPreflightInput) {
  const market = input.market;
  const instrument = String(input.instrument || '').trim().toUpperCase();
  const source = String(input.source || '').trim() || null;
  const sourceStatus = String(input.sourceStatus || '').trim().toLowerCase() || null;
  const lookback = Math.floor(Number(input.lookback));
  const holding = Math.floor(Number(input.holding));
  const requiredBars = lookback + holding + 1;
  const base = { market, instrument, timeframe: '1d', source, sourceStatus, requiredBars, availableBars: 0, dataRange: null as null | { from: string; to: string }, calendarNote: '仅报告数据源实际返回的K线，不推断节假日、休市或缺失交易日。' };

  if (market !== 'stocks' && market !== 'crypto') {
    return { ...base, dataStatus: 'unsupported' as const, reason: '当前回测预检仅支持股票和虚拟币市场' };
  }
  if (!validIdentity(market, instrument)) {
    return { ...base, dataStatus: 'unsupported' as const, reason: `标的身份与${market === 'stocks' ? '股票' : '虚拟币'}市场不匹配` };
  }
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > 500 || !Number.isInteger(holding) || holding < 1 || holding > 500) {
    return { ...base, dataStatus: 'unavailable' as const, reason: '回看周期或持有周期参数无效' };
  }
  const bars = Array.isArray(input.bars) ? input.bars : [];
  if (!source || bars.length === 0) {
    const failed = ['unavailable', 'failed', 'error'].includes(sourceStatus || '');
    return { ...base, dataStatus: 'unavailable' as const, reason: failed ? `来源不可用${input.sourceError ? `：${input.sourceError}` : ''}` : source ? '数据源成功响应但没有可用K线' : '数据源未提供或不可用' };
  }
  const valid = new Map<number, PreflightBar>();
  let malformed = 0;
  for (const bar of bars) {
    const time = typeof bar.time === 'number' ? bar.time : Date.parse(String(bar.time));
    const values = [bar.open, bar.high, bar.low, bar.close].map(Number);
    const [open, high, low, close] = values;
    if (!Number.isFinite(time) || time <= 0 || !values.every(Number.isFinite) || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || (bar.volume != null && (!Number.isFinite(Number(bar.volume)) || Number(bar.volume) < 0))) {
      malformed += 1;
      continue;
    }
    const normalized = { time, open, high, low, close, volume: bar.volume == null ? null : Number(bar.volume) };
    const previous = valid.get(time);
    if (previous) {
      const same = Number(previous.open) === open && Number(previous.high) === high && Number(previous.low) === low && Number(previous.close) === close && (previous.volume == null ? null : Number(previous.volume)) === normalized.volume;
      if (!same) malformed += 1;
      continue;
    }
    valid.set(time, normalized);
  }
  const ordered = [...valid.keys()].sort((left, right) => left - right);
  const dataRange = ordered.length ? { from: new Date(ordered[0]).toISOString(), to: new Date(ordered[ordered.length - 1]).toISOString() } : null;
  const withCoverage = { ...base, availableBars: ordered.length, dataRange };
  if (malformed > 0) return { ...withCoverage, dataStatus: 'unavailable' as const, reason: `发现 ${malformed} 根异常 OHLCV K线，已阻止回测预检` };
  if (ordered.length < requiredBars) return { ...withCoverage, dataStatus: 'insufficient' as const, reason: `来源仅覆盖 ${ordered.length} 根有效K线，当前参数至少需要 ${requiredBars} 根` };
  return { ...withCoverage, dataStatus: 'ready' as const, reason: null };
}
