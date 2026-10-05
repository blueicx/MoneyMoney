const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeStockSignalCandidate } = require('../dist/features/trade-assistant');

function candidate(market = 'us', symbol = 'SNDK') {
  return { market, symbol, instrumentId: `stock:${market}:${symbol}`, sources: ['watchlist'] };
}

function bars() {
  return Array.from({ length: 80 }, (_, index) => {
    const close = 50 + index * 0.7 + Math.sin(index / 3);
    return { time: Date.UTC(2026, 0, index + 1), open: close - 0.3, high: close + 1, low: close - 1, close, volume: 1000 };
  });
}

function snapshot(source, data, status = 'live', expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return { source, data, status, fetchedAt: new Date().toISOString(), expiresAt, latencyMs: 2 };
}

test('trade assistant exposes a per-candidate stock signal analyzer', () => {
  assert.equal(typeof analyzeStockSignalCandidate, 'function');
});

test('fresh US quote and history produce an explainable signal with both sources', { skip: typeof analyzeStockSignalCandidate !== 'function' }, async () => {
  const result = await analyzeStockSignalCandidate(candidate(), {
    now: () => Date.now(),
    stockData: {
      quote: async () => ({ symbol: 'SNDK', quote: { symbol: 'SNDK', price: 105, changePct: 2.2, currency: 'USD', asOf: '2026-10-06T00:00:00.000Z' }, snapshot: snapshot('nasdaq-public-quote', null) }),
      history: async () => ({ symbol: 'SNDK', bars: bars(), snapshot: snapshot('nasdaq-public-history', null) }),
    },
  });
  assert.equal(result.status, 'ready');
  assert.ok(result.action && ['BUY', 'SELL', 'WAIT'].includes(result.action.action));
  assert.match(result.source, /nasdaq-public-quote/);
  assert.match(result.source, /nasdaq-public-history/);
  assert.equal(result.dataStatus, 'live');
});

test('stale US quote cannot produce a direction signal even if history is available', { skip: typeof analyzeStockSignalCandidate !== 'function' }, async () => {
  const expired = snapshot('nasdaq-public-quote', null, 'stale', new Date(Date.now() - 1_000).toISOString());
  const result = await analyzeStockSignalCandidate(candidate(), {
    stockData: {
      quote: async () => ({ symbol: 'SNDK', quote: { symbol: 'SNDK', price: 105, changePct: 2.2, currency: 'USD', asOf: null }, snapshot: expired }),
      history: async () => ({ symbol: 'SNDK', bars: bars(), snapshot: snapshot('nasdaq-public-history', null) }),
    },
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.action, null);
  assert.equal(result.dataStatus, 'stale');
  assert.match(result.reason, /stale|过期/i);
});

test('Hong Kong watchlist stock uses the explicit Tencent market prefix, never the Nasdaq provider', { skip: typeof analyzeStockSignalCandidate !== 'function' }, async () => {
  let stockDataCalls = 0;
  let quoteRequest;
  let historyRequest;
  const result = await analyzeStockSignalCandidate(candidate('hk', '00700'), {
    stockData: {
      quote: async () => { stockDataCalls += 1; throw new Error('wrong provider'); },
      history: async () => { stockDataCalls += 1; throw new Error('wrong provider'); },
    },
    fetchTencentQuotes: async ids => {
      quoteRequest = ids;
      return new Map([['00700', { symbol: 'hk00700', name: 'Tencent', price: 500, changePct: 1.2 }]]);
    },
    fetchTencentKlines: async id => { historyRequest = id; return bars(); },
  });
  assert.equal(stockDataCalls, 0);
  assert.deepEqual(quoteRequest, ['hk00700']);
  assert.equal(historyRequest, 'hk00700');
  assert.equal(result.status, 'ready');
  assert.equal(result.dataStatus, 'delayed');
  assert.equal(result.source, 'Tencent Finance');
});
