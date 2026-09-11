import { ResilientDataSourceAdapter, type DataSourceAdapter } from './source-adapter';
import type { StockQuote } from '../features/stock-data-contracts';

export function createYahooStockAdapter(): DataSourceAdapter<StockQuote> {
  return new ResilientDataSourceAdapter<StockQuote>({
    id: 'yahoo-finance-quote',
    group: 'Yahoo Finance',
    ttlMs: 30_000,
    timeoutMs: 2_000,
    retries: 0,
    fetcher: async (input, signal) => {
      const symbol = String((input as { symbol?: string })?.symbol || '').trim();
      if (!symbol) throw new Error('Symbol is required');
      let response;
      const headers = { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' };
      try {
        const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbol);
        response = await fetch(url, { signal, headers });
        if (!response.ok) throw new Error();
      } catch (err) {
        const url2 = 'https://query2.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbol);
        response = await fetch(url2, { signal, headers });
      }
      if (!response.ok) throw new Error('Yahoo Finance API failed with status: ' + response.status);
      const data = (await response.json()) as any;
      const quote = data.quoteResponse?.result?.[0];
      if (!quote) throw new Error('Quote not found');
      return {
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        changePct: quote.regularMarketChangePercent ?? null,
        currency: quote.currency || 'USD',
        asOf: quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      };
    },
  });
}
