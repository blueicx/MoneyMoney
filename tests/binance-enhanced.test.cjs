const test = require('node:test');
const assert = require('node:assert/strict');
const { BinanceFeed } = require('../dist/features/binance.js');

test('depth normalizes book levels and exposes spread and liquidity', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ bids: [['100', '2'], ['99', '3']], asks: [['101', '4']] }),
  });

  const depth = await new BinanceFeed().getDepth('BTCUSDT', 2);
  assert.deepEqual(depth?.bids, [[100, 2], [99, 3]]);
  assert.deepEqual(depth?.asks, [[101, 4]]);
  assert.equal(depth?.spread, 1);
  assert.equal(depth?.liquidity, 9);
  assert.equal(depth?.sourceStatus, 'ok');
});

test('derivatives returns an explicit error when both public sources fail', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('upstream unavailable'); };

  const result = await new BinanceFeed().getDerivatives('BTCUSDT');
  assert.equal(result?.sourceStatus, 'error');
});
