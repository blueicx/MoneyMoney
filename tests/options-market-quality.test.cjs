const test = require('node:test');
const assert = require('node:assert/strict');
const { assessOptionQuoteQuality, calculateOptionPayoff } = require('../dist/features/options-market.js');

test('option quote quality distinguishes executable two-sided prices, wide spreads and missing quotes', () => {
  assert.deepEqual(assessOptionQuoteQuality({ bidPrice: 1.9, askPrice: 2.1, spreadPct: 10, volume: 20, openInterest: 100 }), {
    status: 'quoted', label: '双边报价可见', referenceAsk: 2.1, referenceBid: 1.9,
  });
  assert.equal(assessOptionQuoteQuality({ bidPrice: 1, askPrice: 2, spreadPct: 66.67, volume: 1, openInterest: 2 }).status, 'wide-spread');
  assert.equal(assessOptionQuoteQuality({ bidPrice: 0, askPrice: 0, spreadPct: null, volume: 0, openInterest: 0 }).status, 'unquoted');
});

test('option payoff uses verified bid/ask sides and computes capped vertical-spread risk', () => {
  const call = (strike, bidPrice, askPrice) => ({
    instrumentName: `SPY-20261218-${strike}-C`, strike, optionType: 'call', bidPrice, askPrice,
    quoteQuality: { status: 'quoted' }, expiryMs: Date.UTC(2026, 11, 18),
  });
  const result = calculateOptionPayoff({
    spot: 100,
    multiplier: 100,
    legs: [
      { row: call(100, 4.8, 5), action: 'buy', contracts: 1 },
      { row: call(110, 2, 2.2), action: 'sell', contracts: 1 },
    ],
  });
  assert.equal(result.netPremiumUsd, 300);
  assert.equal(result.payoffAtSpotUsd, -300);
  assert.equal(result.maxLossUsd, 300);
  assert.equal(result.maxGainUsd, 700);
  assert.ok(result.breakEvenPrices.some(price => Math.abs(price - 103) < 1e-8));
  assert.equal(result.curve.find(point => point.underlyingPrice === 120).pnlUsd, 700);
  assert.equal(result.executionEnabled, false);
});

test('option payoff fails closed for missing quotes, mixed expiries and invalid multipliers', () => {
  const row = { instrumentName: 'SPY-C', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1, quoteQuality: { status: 'unquoted' }, expiryMs: 1 };
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: [{ row, action: 'buy', contracts: 1 }, { row, action: 'sell', contracts: 1 }] }), /双边有效报价/);
  const quoted = { ...row, quoteQuality: { status: 'quoted' } };
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: [
    { row: quoted, action: 'buy', contracts: 1 },
    { row: { ...quoted, expiryMs: 2 }, action: 'sell', contracts: 1 },
  ] }), /同一到期日/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: [
    { row: { ...quoted, expiryMs: undefined }, action: 'buy', contracts: 1 },
    { row: { ...quoted, expiryMs: undefined }, action: 'sell', contracts: 1 },
  ] }), /同一到期日/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 0, legs: [{ row: quoted, action: 'buy', contracts: 1 }, { row: quoted, action: 'sell', contracts: 1 }] }), /乘数/);
});
