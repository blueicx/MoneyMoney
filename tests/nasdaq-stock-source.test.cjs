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
  assert.equal(fresh.status, 'live');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.data.price, 227.16);
});

test('Nasdaq quote cache is isolated by symbol and never reuses another ticker price', async () => {
  const calls = [];
  const adapters = createNasdaqStockAdapters(async url => {
    calls.push(url);
    const symbol = decodeURIComponent(url.match(/quote\/([^/]+)\/info/)[1]);
    const price = symbol === 'AAPL' ? '$100.00' : '$200.00';
    return new Response(JSON.stringify({ data: { primaryData: { lastSalePrice: price, percentageChange: '1%', lastTradeTimestamp: 'now' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, { quoteTtlMs: 60_000, retries: 0, backoffMs: 0 });

  const aapl = await adapters.quote.fetch({ symbol: 'AAPL' });
  const sndk = await adapters.quote.fetch({ symbol: 'SNDK' });
  const aaplAgain = await adapters.quote.fetch({ symbol: 'AAPL' });
  assert.equal(aapl.data.price, 100);
  assert.equal(sndk.data.price, 200);
  assert.equal(aaplAgain.data.price, 100);
  assert.equal(calls.length, 2);
});

test('Nasdaq history cache is isolated by symbol and never reuses another ticker bars', async () => {
  const calls = [];
  const adapters = createNasdaqStockAdapters(async url => {
    calls.push(url);
    const symbol = decodeURIComponent(url.match(/quote\/([^/]+)\/historical/)[1]);
    const close = symbol === 'AAPL' ? '$100.00' : '$200.00';
    return new Response(JSON.stringify({ data: { tradesTable: { rows: [
      { date: '09/08/2026', close, open: close, high: close, low: close, volume: '1,000' },
    ] } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, { barsTtlMs: 60_000, retries: 0, backoffMs: 0 });

  const aapl = await adapters.bars.fetch({ symbol: 'AAPL', from: '2026-09-01' });
  const sndk = await adapters.bars.fetch({ symbol: 'SNDK', from: '2026-09-01' });
  const aaplAgain = await adapters.bars.fetch({ symbol: 'AAPL', from: '2026-09-01' });
  assert.equal(aapl.data[0].close, 100);
  assert.equal(sndk.data[0].close, 200);
  assert.equal(aaplAgain.data[0].close, 100);
  assert.equal(calls.length, 2);
});
