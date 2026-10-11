const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { assessOptionQuoteQuality, calculateOptionPayoff } = require('../dist/features/options-market.js');

test('option quote quality distinguishes executable two-sided prices, wide spreads and missing quotes', () => {
  assert.deepEqual(assessOptionQuoteQuality({ bidPrice: 1.9, askPrice: 2.1, spreadPct: 10, volume: 20, openInterest: 100 }), {
    status: 'quoted', label: '双边报价可见', referenceAsk: 2.1, referenceBid: 1.9,
  });
  assert.equal(assessOptionQuoteQuality({ bidPrice: 1, askPrice: 2, spreadPct: 66.67, volume: 1, openInterest: 2 }).status, 'wide-spread');
  assert.equal(assessOptionQuoteQuality({ bidPrice: 0, askPrice: 0, spreadPct: null, volume: 0, openInterest: 0 }).status, 'unquoted');
});

test('option payoff uses verified bid/ask sides and computes capped vertical-spread risk', () => {
  const quoteTime = new Date().toISOString();
  const call = (strike, bidPrice, askPrice) => ({
    instrumentName: `SPY-20261218-${strike}-C`, strike, optionType: 'call', bidPrice, askPrice,
    quoteQuality: { status: 'quoted' }, expiryMs: Date.UTC(2026, 11, 18), quoteTime,
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
  const row = { instrumentName: 'SPY-C', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1, quoteQuality: { status: 'unquoted' }, expiryMs: 1, quoteTime: new Date().toISOString() };
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

test('option payoff rejects missing, stale or future quote timestamps and expired contracts', () => {
  const nowMs = Date.now();
  const row = { instrumentName: 'SPY261218C00100000', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1,
    quoteQuality: { status: 'quoted' }, expiryMs: nowMs + 86_400_000, quoteTime: new Date(nowMs).toISOString() };
  const legs = [{ row, action: 'buy', contracts: 1 }, { row, action: 'sell', contracts: 1 }];

  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, quoteTime: undefined } })), nowMs }), /报价抓取时间/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, quoteTime: new Date(nowMs - 300_001).toISOString() } })), nowMs }), /超过 5 分钟/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, quoteTime: new Date(nowMs + 60_001).toISOString() } })), nowMs }), /未来/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, expiryMs: nowMs - 1 } })), nowMs }), /到期日已过/);
});

test('option payoff UI requires a verified contract multiplier before requesting a result', async () => {
  const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
  const renderSource = html.match(/function renderOptionPayoffBuilder\(expiry\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(renderSource, 'option payoff builder should be wired to the options workspace');
  const dom = new JSDOM('<div id="option-payoff-builder"></div>', { runScripts: 'outside-only' });
  let requestCount = 0;
  const optionsSnapshot = {
    market: 'us_equity', asset: 'AAPL', source: 'CBOE Delayed Quotes', fetchedAt: new Date().toISOString(), spot: 100,
  };
  const expiry = { expiryMs: Date.now() + 86_400_000, rows: [
    { instrumentName: 'AAPL261013C00100000', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1, quoteQuality: { status: 'quoted' } },
    { instrumentName: 'AAPL261013P00100000', strike: 100, optionType: 'put', bidPrice: 1, askPrice: 1.1, quoteQuality: { status: 'quoted' } },
  ] };
  const context = {
    document: dom.window.document, optionsSnapshot, expiry,
    stockEscapeHtml: value => String(value ?? ''),
    fetch: async () => { requestCount += 1; return { ok: false, json: async () => ({ success: false, reason: 'unexpected request' }) }; },
  };
  vm.runInNewContext(`${renderSource}; renderOptionPayoffBuilder(expiry);`, context);
  const multiplier = dom.window.document.querySelector('[data-multiplier]');
  assert.equal(multiplier.value, '', 'unknown CBOE contract multipliers must not default to 100');
  dom.window.document.querySelector('[data-calculate]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requestCount, 0);
  assert.match(dom.window.document.querySelector('[data-result]').textContent, /先核实.*乘数/);
  dom.window.close();
});
