const assert = require('node:assert/strict');
const test = require('node:test');
const { createYahooStockAdapter } = require('../dist/data/yahoo-adapter');

test('yahoo adapter fetches AAPL deterministically', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async (url) => {
    assert.match(url.toString(), /query1\.finance\.yahoo\.com/);
    return {
      ok: true,
      json: async () => ({
        quoteResponse: {
          result: [{
            symbol: 'AAPL',
            regularMarketPrice: 150.0,
            regularMarketVolume: 1000000,
            currency: 'USD'
          }]
        }
      })
    };
  };

  const adapter = createYahooStockAdapter();
  assert.equal(adapter.id, 'yahoo-finance-quote');

  const res = await adapter.fetch({ symbol: 'AAPL' });
  assert.equal(res.status, 'fresh');
  assert.equal(res.source, 'yahoo-finance-quote');
  assert.equal(res.data.symbol, 'AAPL');
  assert.equal(res.data.price, 150.0);
  assert.equal(res.data.currency, 'USD');
});

test('yahoo adapter fails deterministically without spoofed User-Agent', async (t) => {
  const originalFetch = global.fetch;
  let usedHeaders = null;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async (_url, options) => {
    usedHeaders = options?.headers || {};
    throw new Error('Network error');
  };

  const adapter = createYahooStockAdapter();
  const res = await adapter.fetch({ symbol: 'AAPL' });

  assert.equal(res.status, 'failed');
  assert.match(res.error, /Network error/);
  assert.equal(usedHeaders['User-Agent'], undefined);
});
