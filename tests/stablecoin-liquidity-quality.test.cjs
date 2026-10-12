const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

require('ts-node/register/transpile-only');
const {
  buildStablecoinLiquidity,
  getStablecoinLiquidity,
  isStablecoinLiquidityActionable,
} = require('../src/features/stablecoin-liquidity');

const RETRIEVED_AT = '2026-10-12T06:00:00.000Z';

function asset(symbol, overrides = {}) {
  return {
    id: symbol,
    symbol,
    name: `${symbol} coin`,
    price: 1,
    circulating: { peggedUSD: 100 },
    circulatingPrevDay: { peggedUSD: 99 },
    circulatingPrevWeek: { peggedUSD: 98 },
    circulatingPrevMonth: { peggedUSD: 95 },
    ...overrides,
  };
}

test('stablecoin aggregates suppress full-market direction when any horizon has incomplete asset coverage', () => {
  const result = buildStablecoinLiquidity({ peggedAssets: [
    asset('USDC'),
    asset('USDT', { circulatingPrevWeek: undefined }),
  ] }, RETRIEVED_AT);

  assert.equal(result.market, 'crypto');
  assert.equal(result.sourceUpdatedAt, null);
  assert.equal(result.retrievedAt, RETRIEVED_AT);
  assert.equal(result.coverage.assetCount, 2);
  assert.equal(result.coverage.validSupplyCount, 2);
  assert.equal(result.coverage.flow1dCount, 2);
  assert.equal(result.coverage.flow7dCount, 1);
  assert.equal(result.coverage.flow30dCount, 2);
  assert.equal(result.netFlow1dUsd, 2);
  assert.equal(result.netFlow7dUsd, null);
  assert.equal(result.change7dPct, null);
  assert.equal(result.flowScore, null);
  assert.equal(result.signal, 'unavailable');
  assert.equal(result.regimeBoost, null);
  assert.match(result.reason, /7日.*1\/2/);
});

test('unknown peg prices remain unknown instead of being displayed as exactly one dollar', () => {
  const result = buildStablecoinLiquidity({ peggedAssets: [
    asset('USDC', { price: undefined }),
  ] }, RETRIEVED_AT);

  assert.equal(result.top5[0].pegPrice, null);
  assert.equal(result.top5[0].pegDeviationPct, null);
  assert.equal(result.coverage.pegPriceCount, 0);
  assert.match(result.reason, /锚定价格.*0\/1/);
});

test('malformed supply rows are counted and cannot produce a partial total as a full total', () => {
  const result = buildStablecoinLiquidity({ peggedAssets: [
    asset('USDC'),
    asset('BROKEN', { circulating: { peggedUSD: 'Infinity' } }),
  ] }, RETRIEVED_AT);

  assert.equal(result.coverage.assetCount, 2);
  assert.equal(result.coverage.validSupplyCount, 1);
  assert.equal(result.coverage.invalidAssetCount, 1);
  assert.equal(result.totalCirculatingUsd, null);
  assert.equal(result.flowScore, null);
  assert.equal(result.dataStatus, 'partial');
  assert.match(result.reason, /1.*资产.*无效/);
});

test('successful empty and malformed provider envelopes are distinct', () => {
  const empty = buildStablecoinLiquidity({ peggedAssets: [] }, RETRIEVED_AT);
  const malformed = buildStablecoinLiquidity({ peggedAssets: 'not-an-array' }, RETRIEVED_AT);

  assert.equal(empty.dataStatus, 'empty');
  assert.equal(empty.signal, 'unavailable');
  assert.equal(empty.flowScore, null);
  assert.equal(malformed.dataStatus, 'unavailable');
  assert.match(malformed.reason, /peggedAssets/);
});

test('malformed source responses are not cached and a later valid response recovers', async () => {
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    return { ok: true, json: async () => requests === 1
      ? { peggedAssets: 'broken' }
      : { peggedAssets: [asset('USDC')] } };
  };
  try {
    const failed = await getStablecoinLiquidity();
    const recovered = await getStablecoinLiquidity();

    assert.equal(failed.dataStatus, 'unavailable');
    assert.equal(recovered.dataStatus, 'partial');
    assert.equal(recovered.cacheStatus, 'miss');
    assert.equal(requests, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('stablecoin data is not actionable without verified source time and complete coverage', () => {
  const partial = buildStablecoinLiquidity({ peggedAssets: [asset('USDC')] }, RETRIEVED_AT);
  const verified = {
    ...partial,
    dataStatus: 'live',
    sourceUpdatedAt: '2026-10-12T05:59:00.000Z',
    flowScore: 15,
    regimeBoost: 1.5,
  };

  assert.equal(isStablecoinLiquidityActionable(partial), false);
  assert.equal(isStablecoinLiquidityActionable(verified), true);
  assert.equal(isStablecoinLiquidityActionable({ ...verified, coverage: { ...verified.coverage, flow7dCount: 0 } }), false);
});

test('stablecoin panel displays unavailable values as unknown and includes source time and coverage', async () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('async function loadStablecoinLiquidity()');
  const end = source.indexOf('\n// --- Crypto News ---', start);
  const dom = new JSDOM('<div id="stablecoin-liquidity"></div>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.safeNewsText = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  window.compactUsd = value => `$${Number(value || 0).toFixed(2)}`;
  window.formatBeijingDateTime = value => String(value);
  window.fetch = async () => ({ json: async () => ({ success: true, data: buildStablecoinLiquidity({ peggedAssets: [
    asset('USDC'), asset('USDT', { circulatingPrevWeek: undefined }),
  ] }, RETRIEVED_AT) }) });
  window.eval(`${source.slice(start, end)}; window.renderStablecoin = loadStablecoinLiquidity;`);

  await window.renderStablecoin();
  const panel = window.document.querySelector('#stablecoin-liquidity');
  assert.match(panel.textContent, /综合分暂不计算/);
  assert.match(panel.textContent, /覆盖 1\/2/);
  assert.match(panel.textContent, /来源观测时间：未提供/);
  assert.match(panel.textContent, /抓取时间：2026-10-12T06:00:00.000Z/);
  assert.match(panel.textContent, /暂无/);
  assert.doesNotMatch(panel.textContent, /7日 \$0\.00/);
  dom.window.close();
});

test('trade assistant gates stablecoin score and contraction caution on actionable source evidence', () => {
  const source = fs.readFileSync('src/features/trade-assistant.ts', 'utf8');
  assert.match(source, /const stablecoinLiquidityUsable = isStablecoinLiquidityActionable\(stablecoinLiquidity\)/);
  assert.match(source, /stablecoinLiquidityUsable \? stablecoinLiquidity\?\.regimeBoost/);
  assert.match(source, /stablecoinLiquidityUsable && stablecoinLiquidity\?\.signal === 'contraction'/);
});
