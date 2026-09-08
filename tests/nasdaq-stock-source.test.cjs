const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNasdaqQuotePayload, parseNasdaqHistoricalPayload, createNasdaqStockAdapters } = require('../dist/features/nasdaq-stock-source');

test('Nasdaq quote payload becomes a normalized stock quote', () => {
  const quote = parseNasdaqQuotePayload('AAPL', { data: { primaryData: { lastSalePrice: '$227.16', percentageChange: '+1.20%', lastTradeTimestamp: '09/08/2026 04:00 PM' } } });
  assert.deepEqual(quote, { symbol: 'AAPL', price: 227.16, changePct: 1.2, currency: 'USD', asOf: '09/08/2026 04:00 PM' });
});

test('Nasdaq historical rows are numeric, ordered and malformed rows are ignored', () => {
  const bars = parseNasdaqHistoricalPayload({ data: { tradesTable: { rows: [
    { date: '09/08/2026', close: '$227.16', open: '$225.00', high: '$228.00', low: '$224.50', volume: '1,000' },
    { date: 'bad', close: 'N/A', open: '', high: '', low: '', volume: '' },
  ] } } });
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0], { time: Date.parse('2026-09-08T00:00:00Z'), open: 225, high: 228, low: 224.5, close: 227.16, volume: 1000 });
});

test('Nasdaq adapter returns stale data after a later source failure', async () => {
  let calls = 0;
  const adapters = createNasdaqStockAdapters(async () => {
    calls += 1;
    if (calls > 1) throw new Error('network down');
    return new Response(JSON.stringify({ data: { primaryData: { lastSalePrice: '$227.16', percentageChange: '0%', lastTradeTimestamp: 'now' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, { quoteTtlMs: 0, retries: 0, backoffMs: 0 });
  const fresh = await adapters.quote.fetch({ symbol: 'AAPL' });
  const stale = await adapters.quote.fetch({ symbol: 'AAPL' });
  assert.equal(fresh.status, 'fresh');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.data.price, 227.16);
});
