const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

require('ts-node/register/transpile-only');
const { createOrderFlowLiquidityRadarService, isOrderFlowMarketBiasEligible } = require('../src/features/order-flow-liquidity');

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
const FIXED_NOW = Date.parse('2026-10-12T04:30:00.000Z');

function makeBars(now = FIXED_NOW) {
  const currentHour = Math.floor(now / 3_600_000) * 3_600_000;
  return Array.from({ length: 25 }, (_, index) => ({
    time: currentHour - (24 - index) * 3_600_000,
    open: 100 + index,
    close: 100.5 + index,
    volume: 10,
    quoteVolume: 1_000,
    takerBuyQuoteVolume: 600,
  }));
}

function makeFeed(overrides = {}) {
  const calls = { klines: 0, depth: 0 };
  const feed = {
    async getKlines(symbol, interval, limit) {
      calls.klines += 1;
      assert.equal(interval, '1h');
      assert.equal(limit, 25);
      return overrides.getKlines ? overrides.getKlines(symbol) : makeBars();
    },
    klineCachedAt() {
      return new Date(FIXED_NOW - 2_000).toISOString();
    },
    async getDepth(symbol, limit) {
      calls.depth += 1;
      assert.equal(limit, 100);
      return overrides.getDepth
        ? overrides.getDepth(symbol)
        : {
            bids: [[99.9, 10]],
            asks: [[100.1, 8]],
            sourceStatus: 'ok',
            freshness: FIXED_NOW - 1_000,
          };
    },
  };
  return { feed, calls };
}

test('partial asset coverage is explicit and cannot produce a market-wide boost', async () => {
  const { feed } = makeFeed({
    getKlines: symbol => symbol === 'DOGEUSDT' ? [] : makeBars(),
  });
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });

  const result = await load();

  assert.equal(result.market, 'crypto');
  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.expectedSymbols, SYMBOLS.length);
  assert.equal(result.availableSymbols, 5);
  assert.deepEqual(result.missingSymbols, ['DOGE']);
  assert.equal(result.regimeBoost, null);
  assert.equal(result.averageNetFlowSharePct, null);
  assert.equal(result.averageBookImbalancePct, null);
  assert.match(result.reason, /DOGE/);
  assert.match(result.summaryZh, /5\/6/);
  assert.equal(isOrderFlowMarketBiasEligible(result), false);
});

test('only complete, scored snapshots may influence assistant market bias', () => {
  assert.equal(isOrderFlowMarketBiasEligible({ dataStatus: 'partial', regimeBoost: 2 }), false);
  assert.equal(isOrderFlowMarketBiasEligible({ dataStatus: 'unavailable', regimeBoost: null }), false);
  assert.equal(isOrderFlowMarketBiasEligible({ dataStatus: 'delayed', regimeBoost: null }), false);
  assert.equal(isOrderFlowMarketBiasEligible({ dataStatus: 'cached', regimeBoost: 1.2 }), true);
});

test('K-line observation time and local retrieval time are kept distinct', async () => {
  const { feed } = makeFeed();
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });

  const result = await load();
  const row = result.rows.find(item => item.symbol === 'BTC');

  assert.equal(result.dataStatus, 'delayed');
  assert.equal(row.klineTimeBasis, 'bar-open');
  assert.equal(row.klineObservedAt, new Date(makeBars().at(-1).time).toISOString());
  assert.equal(row.klineRetrievedAt, new Date(FIXED_NOW - 2_000).toISOString());
  assert.equal(row.depthSourceTime, null);
  assert.equal(row.depthRetrievedAt, new Date(FIXED_NOW - 1_000).toISOString());
  assert.equal(result.updatedAt, new Date(FIXED_NOW).toISOString());
});

test('an all-unavailable scan returns an explicit empty envelope rather than throwing', async () => {
  const { feed } = makeFeed({ getKlines: () => [] });
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });

  const result = await load();

  assert.equal(result.dataStatus, 'unavailable');
  assert.deepEqual(result.rows, []);
  assert.equal(result.regimeBoost, null);
  assert.deepEqual(result.missingSymbols, SYMBOLS);
  assert.match(result.reason, /K线|数据/);
});

test('stale book snapshots are excluded rather than combined with current flow', async () => {
  const { feed } = makeFeed({
    getDepth: () => ({
      bids: [[99.9, 10]],
      asks: [[100.1, 8]],
      sourceStatus: 'ok',
      freshness: FIXED_NOW - 4 * 60_000,
    }),
  });
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });

  const result = await load();

  assert.equal(result.dataStatus, 'unavailable');
  assert.equal(result.rows.length, 0);
  assert.equal(result.regimeBoost, null);
  assert.match(result.reason, /盘口.*过期/);
});

test('gapped or invalid taker-volume bars exclude the affected asset', async () => {
  const { feed } = makeFeed({
    getKlines: symbol => {
      const bars = makeBars();
      if (symbol === 'BTCUSDT') bars[8].time += 60 * 60_000;
      if (symbol === 'ETHUSDT') bars[8].takerBuyQuoteVolume = bars[8].quoteVolume + 1;
      return bars;
    },
  });
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });
  const result = await load();

  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.rows.some(row => row.symbol === 'BTC'), false);
  assert.equal(result.rows.some(row => row.symbol === 'ETH'), false);
  assert.match(result.reason, /BTC: BTCUSDT 1小时K线存在缺口/);
  assert.match(result.reason, /ETH: ETHUSDT K线包含无效时间或成交量字段/);
});

test('cached results are labeled cached and do not refresh their original retrieval timestamp', async () => {
  const { feed, calls } = makeFeed();
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });

  const first = await load();
  const second = await load();

  assert.equal(first.dataStatus, 'delayed');
  assert.equal(second.dataStatus, 'cached');
  assert.equal(second.cacheStatus, 'hit');
  assert.equal(second.updatedAt, first.updatedAt);
  assert.equal(calls.klines, SYMBOLS.length);
  assert.equal(calls.depth, SYMBOLS.length);
});

test('crossed order-book snapshots are rejected for that asset', async () => {
  const { feed } = makeFeed({
    getDepth: symbol => symbol === 'BTCUSDT'
      ? { bids: [[101, 10]], asks: [[100, 8]], sourceStatus: 'ok', freshness: FIXED_NOW - 1_000 }
      : { bids: [[99.9, 10]], asks: [[100.1, 8]], sourceStatus: 'ok', freshness: FIXED_NOW - 1_000 },
  });
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });

  const result = await load();

  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.rows.some(row => row.symbol === 'BTC'), false);
  assert.equal(result.regimeBoost, null);
  assert.match(result.reason, /BTC.*盘口/);
});

test('malformed order-book levels are rejected instead of counted as zero liquidity', async () => {
  const { feed } = makeFeed({
    getDepth: symbol => symbol === 'BTCUSDT'
      ? { bids: [[99.9, 10], null], asks: [[100.1, 8]], sourceStatus: 'ok', freshness: FIXED_NOW - 1_000 }
      : { bids: [[99.9, 10]], asks: [[100.1, 8]], sourceStatus: 'ok', freshness: FIXED_NOW - 1_000 },
  });
  const load = createOrderFlowLiquidityRadarService(feed, { now: () => FIXED_NOW });
  const result = await load();
  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.rows.some(row => row.symbol === 'BTC'), false);
  assert.match(result.reason, /BTC.*盘口档位结构无效/);
});

test('order-flow panel renders partial-source reasons and never calls the REST snapshot real-time', async () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('async function loadOrderFlowLiquidity()');
  const end = source.indexOf('\nasync function loadCotRadar()', start);
  assert.ok(start >= 0 && end > start, 'order-flow renderer should remain a bounded function');
  const dom = new JSDOM('<div id="order-flow-liquidity"></div>', { runScripts: 'outside-only' });
  dom.window.safeNewsText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
  dom.window.fetch = async () => ({ json: async () => ({
    success: true,
    dataStatus: 'partial',
    data: {
      market: 'crypto', dataStatus: 'partial', updatedAt: '2026-10-12T04:30:00.000Z',
      source: 'Binance spot', expectedSymbols: 6, availableSymbols: 5,
      reason: 'DOGE: DOGEUSDT 盘口快照已过期', failures: [{ symbol: 'DOGE', reason: '盘口快照已过期' }],
      evidenceRefs: [], rows: [{
        symbol: 'BTC', nameZh: '比特币', signal: 'neutral', signalZh: '中性', flowState: 'balanced',
        bookState: 'balanced', price: 100, change24hPct: 1, netTakerFlow24hUsd: 10,
        netFlowShare24hPct: 0.5, takerBuyShare24hPct: 50, flowAccelerationPct: 0,
        bookImbalancePct: 0, bidUsd: 10, askUsd: 10, nearTouchLiquidityUsd: 5, spreadBps: 2,
        adviceZh: '等待确认', klineObservedAt: '2026-10-12T04:00:00.000Z',
        klineRetrievedAt: '2026-10-12T04:30:00.000Z', depthRetrievedAt: '2026-10-12T04:29:59.000Z',
      }], regimeBoost: null, averageNetFlowSharePct: null, averageBookImbalancePct: null,
      summaryZh: '有效覆盖 5/6 个主流币；DOGE 数据缺失。', advisorBiasZh: '样本不完整，暂不形成全市场倾向。',
    },
  }) });
  dom.window.eval(`${source.slice(start, end)}\nwindow.testLoadOrderFlowLiquidity = loadOrderFlowLiquidity;`);

  await dom.window.testLoadOrderFlowLiquidity();

  const text = dom.window.document.getElementById('order-flow-liquidity').textContent;
  assert.match(text, /部分来源成功/);
  assert.match(text, /DOGE: DOGEUSDT 盘口快照已过期/);
  assert.match(text, /全市场综合加分暂不计算/);
  assert.match(text, /K线开盘/);
  assert.match(text, /来源未提供盘口源端时间/);
  assert.doesNotMatch(text, /实时盘口/);
});
