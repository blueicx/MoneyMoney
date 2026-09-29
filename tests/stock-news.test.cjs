const test = require('node:test');
const assert = require('node:assert/strict');

const { parseYahooNewsResponse, getStockNewsSnapshot } = require('../dist/features/stock-news');

test('stock news parser keeps ticker-scoped source evidence and drops malformed items', () => {
  const result = parseYahooNewsResponse({
    news: [
      { uuid: '1', title: 'Apple reports results', publisher: 'Yahoo Finance', link: 'https://finance.yahoo.com/news/apple', providerPublishTime: 1770000000, relatedTickers: ['AAPL'] },
      { uuid: '2', title: 'Other story', publisher: 'Yahoo Finance', link: '', providerPublishTime: 1770000000, relatedTickers: ['MSFT'] },
      { uuid: '3', title: '', publisher: 'Yahoo Finance', link: 'https://example.invalid', providerPublishTime: 1770000000, relatedTickers: ['AAPL'] },
      { uuid: '4', title: 'Unrelated market headline', publisher: 'Yahoo Finance', link: 'https://example.com/general', providerPublishTime: 1770000000 },
    ],
  }, 'AAPL');
  assert.deepEqual(result, [{
    title: 'Apple reports results',
    source: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/news/apple',
    publishedAt: '2026-02-02T02:40:00.000Z',
  }]);
});

test('stock news reports live versus cached retrieval separately from publication time', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ news: [{ title: 'Probe event', publisher: 'Yahoo', link: 'https://example.com/probe', providerPublishTime: 1770000000, relatedTickers: ['ZZNEWS'] }] }) };
  };
  try {
    const fresh = await getStockNewsSnapshot('ZZNEWS');
    const cached = await getStockNewsSnapshot('ZZNEWS');
    assert.equal(fresh.status, 'live');
    assert.equal(cached.status, 'cached');
    assert.equal(fresh.updatedAt, '2026-02-02T02:40:00.000Z');
    assert.equal(fresh.retrievedAt, cached.retrievedAt);
    assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; }
});
