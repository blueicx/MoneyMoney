const assert = require('node:assert/strict');
const test = require('node:test');
const { createYahooStockAdapter } = require('../dist/data/yahoo-adapter');

test('yahoo adapter falls back to query2 and uses User-Agent', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  let query1Called = false;
  let query2Called = false;
  let usedAgent = '';

  global.fetch = async (url, options) => {
    if (options?.headers?.['User-Agent']) {
      usedAgent = options.headers['User-Agent'];
    }

    if (url.toString().includes('query1')) {
      query1Called = true;
      throw new Error('Network error');
    }
    if (url.toString().includes('query2')) {
      query2Called = true;
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
    }
    throw new Error('Unknown URL');
  };

  const adapter = createYahooStockAdapter();
  const res = await adapter.fetch({ symbol: 'AAPL' });

  assert.equal(res.status, 'live');
  assert.equal(query1Called, true, 'query1 should have been called');
  assert.equal(query2Called, true, 'query2 should have been called');
  assert.match(usedAgent, /Mozilla/, 'Should provide a User-Agent');
});
