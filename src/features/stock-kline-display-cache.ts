export interface StockKlineDisplayRequest {
  chartWindow?: unknown;
  asOf?: unknown;
  date?: unknown;
  before?: unknown;
  adjustment?: unknown;
}

export function isCacheableLatestStockChart(request: StockKlineDisplayRequest): boolean {
  return String(request.chartWindow || '') === '1'
    && !String(request.asOf || '').trim()
    && !String(request.date || '').trim()
    && request.before === undefined
    && String(request.adjustment || 'source').toLowerCase() === 'source';
}

export function stockKlineDisplayCacheKey(symbol: unknown, period: unknown, initialWindow?: { startTime?: number; limit?: number } | null): string {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const normalizedPeriod = String(period || '').trim().toLowerCase();
  if (!normalizedSymbol || !normalizedPeriod) throw new Error('股票显示缓存必须绑定明确标的和周期');
  return [normalizedSymbol, normalizedPeriod, String(initialWindow?.startTime || 'latest'), String(initialWindow?.limit || 'all')].join(':');
}
