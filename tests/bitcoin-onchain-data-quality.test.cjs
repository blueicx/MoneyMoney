const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

require('ts-node/register/transpile-only');
const {
  buildBitcoinOnchainRadar,
  getBitcoinOnchainRadar,
  parseBlockchainChartPoints,
  normalizeBlockchainChartPoints,
} = require('../src/features/bitcoin-onchain');

const DAY = 86_400_000;
const START = Date.parse('2026-08-01T00:00:00.000Z');
const CHARTS = ['n-unique-addresses', 'estimated-transaction-volume-usd', 'hash-rate', 'miners-revenue', 'market-cap'];

function points(count = 60, base = 100, start = START) {
  return Array.from({ length: count }, (_, index) => ({ x: start + index * DAY, y: base + index }));
}

function validCharts() {
  return Object.fromEntries(CHARTS.map((chart, index) => [chart, { points: points(60, (index + 1) * 100) }]));
}

test('Blockchain chart normalization discards malformed numbers but preserves real zero observations', () => {
  assert.deepEqual(normalizeBlockchainChartPoints([
    { x: 1_000, y: 0 },
    { x: 2_000, y: '12.5' },
    { x: 3_000, y: '' },
    { x: 4_000, y: null },
    { x: 'bad', y: 9 },
    { x: 0, y: 10 },
  ]), [
    { x: 1_000_000, y: 0 },
    { x: 2_000_000, y: 12.5 },
  ]);
});

test('non-empty upstream rows with invalid fields are reported as malformed, not as a successful empty response', () => {
  const parsed = parseBlockchainChartPoints([
    { x: 'bad', y: 12 },
    { x: 1_800_000_000, y: '' },
  ]);
  assert.deepEqual(parsed, { points: [], invalidCount: 2 });

  const charts = validCharts();
  charts['miners-revenue'] = parsed;
  const result = buildBitcoinOnchainRadar(charts, '2026-10-12T02:00:00.000Z');
  const miner = result.seriesStatus.find(row => row.chart === 'miners-revenue');
  assert.equal(miner.dataStatus, 'partial');
  assert.match(miner.reason, /2条记录.*字段无效/);

  const malformedOnly = buildBitcoinOnchainRadar(Object.fromEntries(CHARTS.map(chart => [chart, parsed])), '2026-10-12T02:00:00.000Z');
  assert.equal(malformedOnly.dataStatus, 'partial');
  assert.equal(malformedOnly.signal, 'unavailable');
});

test('negative chain metrics are rejected while a real zero volume stays visible without an invented NVT denominator', () => {
  const invalid = validCharts();
  invalid['hash-rate'] = { points: points().map((point, index) => index === 59 ? { ...point, y: -1 } : point) };
  const invalidResult = buildBitcoinOnchainRadar(invalid, '2026-10-12T02:00:00.000Z');
  const hashStatus = invalidResult.seriesStatus.find(row => row.chart === 'hash-rate');
  assert.equal(hashStatus.dataStatus, 'partial');
  assert.equal(hashStatus.invalidCount, 1);
  assert.ok(!invalidResult.metrics.some(metric => metric.key === 'hashRate'));

  const zeroVolume = validCharts();
  zeroVolume['estimated-transaction-volume-usd'] = { points: points(60, 100).map((point, index) => index === 59 ? { ...point, y: 0 } : point) };
  const zeroResult = buildBitcoinOnchainRadar(zeroVolume, '2026-10-12T02:00:00.000Z');
  assert.equal(zeroResult.metrics.find(metric => metric.key === 'txVolumeUsd').value, 0);
  assert.equal(zeroResult.nvtRatio, null);
  assert.equal(zeroResult.nvtPercentile52w, null);
  assert.equal(zeroResult.signal, 'unavailable');
  assert.equal(zeroResult.regimeBoost, null);
});

test('empty miner revenue is reported as missing instead of fabricated as a zero-value metric', () => {
  const charts = validCharts();
  charts['miners-revenue'] = { points: [] };
  const result = buildBitcoinOnchainRadar(charts, '2026-10-12T02:00:00.000Z');

  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.retrievedAt, '2026-10-12T02:00:00.000Z');
  assert.ok(result.sourceUpdatedAt);
  assert.ok(!result.metrics.some(metric => metric.key === 'minerRevenue'));
  assert.equal(result.seriesStatus.find(row => row.chart === 'miners-revenue').dataStatus, 'empty');
  assert.match(result.reason, /矿工收入.*来源成功响应.*未返回记录/);
  assert.notEqual(result.signal, 'unavailable', 'the remaining required series still support the core signal');
});

test('one failed core chart does not erase valid metric history and disables the aggregate signal', () => {
  const charts = validCharts();
  charts['hash-rate'] = { points: [], error: 'Blockchain.com hash-rate HTTP 503' };
  const result = buildBitcoinOnchainRadar(charts, '2026-10-12T02:00:00.000Z');

  assert.equal(result.dataStatus, 'partial');
  assert.ok(result.metrics.length >= 3);
  assert.ok(!result.metrics.some(metric => metric.key === 'hashRate'));
  assert.equal(result.signal, 'unavailable');
  assert.equal(result.regimeBoost, null);
  assert.match(result.reason, /全网算力.*HTTP 503/);
});

test('aggregated values are capped at the latest common core observation, never at a future series tail', () => {
  const charts = validCharts();
  charts['n-unique-addresses'] = { points: points(64, 100) };
  charts['miners-revenue'] = { points: points(66, 400) };
  const result = buildBitcoinOnchainRadar(charts, '2026-10-12T02:00:00.000Z');
  const commonAsOf = START + 59 * DAY;

  assert.equal(result.asOfAt, new Date(commonAsOf).toISOString());
  assert.equal(result.sourceUpdatedAt, new Date(commonAsOf).toISOString());
  assert.equal(result.metrics.find(metric => metric.key === 'activeAddresses').sourceUpdatedAt, new Date(commonAsOf).toISOString());
  assert.equal(result.metrics.find(metric => metric.key === 'minerRevenue').sourceUpdatedAt, new Date(commonAsOf).toISOString());
  assert.equal(result.metrics.find(metric => metric.key === 'minerRevenue').value, 400 + 59);
  assert.notEqual(result.sourceUpdatedAt, result.retrievedAt);
});

test('same calendar date is not treated as a synchronized observation when source timestamps differ', () => {
  const charts = validCharts();
  charts['market-cap'] = { points: points(60, 500).map(point => ({ ...point, x: point.x + 60 * 60_000 })) };
  const result = buildBitcoinOnchainRadar(charts, '2026-10-12T02:00:00.000Z');

  assert.equal(result.sourceUpdatedAt, null);
  assert.equal(result.signal, 'unavailable');
  assert.equal(result.regimeBoost, null);
  assert.match(result.reason, /没有可核验的共同观测时点/);
});

test('one upstream chart exception remains a partial result and records retrieval time', async () => {
  const result = await getBitcoinOnchainRadar({
    fetchChart: async chart => {
      if (chart === 'miners-revenue') throw new Error('upstream offline');
      return points(60, 100 + CHARTS.indexOf(chart) * 100);
    },
    now: () => new Date('2026-10-12T03:00:00.000Z'),
  });

  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.retrievedAt, '2026-10-12T03:00:00.000Z');
  assert.equal(result.seriesStatus.find(row => row.chart === 'miners-revenue').dataStatus, 'unavailable');
  assert.ok(result.metrics.some(metric => metric.key === 'activeAddresses'));
  assert.ok(!result.metrics.some(metric => metric.key === 'minerRevenue'));
});

test('on-chain UI separates source observation time from MoneyMoney retrieval and renders partial reasons', async () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('async function loadBitcoinOnchain()');
  const end = source.indexOf('\nasync function loadCrossAssetCorrelation()', start);
  assert.ok(start >= 0 && end > start, 'existing on-chain workspace renderer should remain the UI entry point');
  const renderer = source.slice(start, end);
  const dom = new JSDOM('<!doctype html><html><body><div id="bitcoin-onchain"></div></body></html>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.safeNewsText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  window.fetch = async () => ({ json: async () => ({
    success: true,
    dataStatus: 'partial',
    reason: '矿工收入：来源成功响应，但未返回记录',
    data: {
      dataStatus: 'partial',
      reason: '矿工收入：来源成功响应，但未返回记录',
      source: 'Blockchain.com Public Charts',
      sourceUpdatedAt: '2026-10-10T00:00:00.000Z',
      retrievedAt: '2026-10-12T03:00:00.000Z',
      generatedAt: '2026-10-12T03:00:00.000Z',
      asOfAt: '2026-10-10T00:00:00.000Z',
      signal: 'neutral',
      signalZh: '链上活动中性',
      summaryZh: '源时点摘要',
      advisorBiasZh: '暂无额外方向',
      regimeBoost: 0,
      nvtRatio: 25,
      nvtPercentile52w: 40,
      activityScore: 52,
      securityScore: 50,
      metrics: [{ key: 'activeAddresses', labelZh: '活跃地址', value: 120, displayZh: '120', sourceUpdatedAt: '2026-10-10T00:00:00.000Z', sampleCount: 60, change7dPct: 1, change30dPct: 2, percentile52w: 50 }],
    },
  }) });

  for (const theme of ['aurora', 'light', 'dark']) {
    window.document.documentElement.dataset.theme = theme;
    await window.eval(`(async () => { ${renderer}; await loadBitcoinOnchain(); })()`);
    const panel = window.document.querySelector('#bitcoin-onchain');
    assert.match(panel.textContent, /状态：部分成功/);
    assert.match(panel.textContent, /矿工收入：来源成功响应，但未返回记录/);
    assert.match(panel.textContent, /来源数据截至/);
    assert.match(panel.textContent, /MoneyMoney 抓取于/);
    assert.match(panel.innerHTML, /var\(--text-secondary\)/);
    assert.match(panel.innerHTML, /var\(--bg-card\)/);
  }
  dom.window.close();
});

test('empty on-chain responses show the provider reason instead of a generic unavailable message', async () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('async function loadBitcoinOnchain()');
  const end = source.indexOf('\nasync function loadCrossAssetCorrelation()', start);
  const renderer = source.slice(start, end);
  const dom = new JSDOM('<!doctype html><html><body><div id="bitcoin-onchain"></div></body></html>', { runScripts: 'outside-only' });
  dom.window.safeNewsText = value => String(value ?? '').replace(/[&<>"']/g, '');
  dom.window.fetch = async () => ({ json: async () => ({ success: false, dataStatus: 'unavailable', reason: 'Blockchain.com hash-rate HTTP 503', data: { dataStatus: 'unavailable', reason: 'Blockchain.com hash-rate HTTP 503', metrics: [], regimeBoost: null } }) });
  await dom.window.eval(`(async () => { ${renderer}; await loadBitcoinOnchain(); })()`);
  assert.match(dom.window.document.querySelector('#bitcoin-onchain').textContent, /来源不可用/);
  assert.match(dom.window.document.querySelector('#bitcoin-onchain').textContent, /Blockchain.com hash-rate HTTP 503/);
  assert.doesNotMatch(dom.window.document.querySelector('#bitcoin-onchain').textContent, /通用|稍后会自动重试/);
  dom.window.close();
});

test('successful empty chart sources keep the empty status and provider explanation in the workspace', async () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('async function loadBitcoinOnchain()');
  const end = source.indexOf('\nasync function loadCrossAssetCorrelation()', start);
  const renderer = source.slice(start, end);
  const dom = new JSDOM('<!doctype html><html><body><div id="bitcoin-onchain"></div></body></html>', { runScripts: 'outside-only' });
  dom.window.safeNewsText = value => String(value ?? '').replace(/[&<>"']/g, '');
  dom.window.fetch = async () => ({ json: async () => ({
    success: false,
    dataStatus: 'empty',
    reason: '来源成功响应，但未返回记录',
    data: { dataStatus: 'empty', reason: '来源成功响应，但未返回记录', metrics: [], regimeBoost: null, signal: 'unavailable', signalZh: '链上综合判断不可用', summaryZh: '无可用链上指标', advisorBiasZh: '暂不计算' },
  }) });
  await dom.window.eval(`(async () => { ${renderer}; await loadBitcoinOnchain(); })()`);
  const panel = dom.window.document.querySelector('#bitcoin-onchain');
  assert.match(panel.textContent, /暂无数据/);
  assert.match(panel.textContent, /来源成功响应，但未返回记录/);
  assert.doesNotMatch(panel.textContent, /比特币链上雷达不可用/);
  dom.window.close();
});
