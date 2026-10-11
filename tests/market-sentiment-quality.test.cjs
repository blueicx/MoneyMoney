const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

require('ts-node/register/transpile-only');

const modulePath = require.resolve('../src/features/market-sentiment');
function loadFreshModule() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function response(payload) {
  return { ok: true, json: async () => payload };
}

function createSentimentPanel() {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('async function loadMarketSentiment()');
  const end = source.indexOf('\nasync function loadPerpetualCrowding()', start);
  const dom = new JSDOM('<div id="fear-greed-card"></div><div id="funding-rates-card"></div>', {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  dom.window.safeNewsText = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  dom.window.eval(`${source.slice(start, end)}; window.__loadMarketSentiment = loadMarketSentiment;`);
  return dom;
}

const contractRows = [
  { name: 'BTC_USDT', funding_rate: '0', funding_interval: 28_800 },
  { name: 'ETH_USDT', funding_rate: '0.0001', funding_interval: 28_800 },
  { name: 'BNB_USDT', funding_rate: '-0.0002', funding_interval: 14_400 },
  { name: 'SOL_USDT', funding_rate: '0.0003' },
  { name: 'X_USDT', funding_rate: '0.01', funding_interval: 28_800 },
  { name: 'Y_USDT', funding_rate: '-0.02', funding_interval: 7_200 },
  { name: 'INVALID_USDT', funding_rate: 'NaN' },
  { name: 'NULL_USDT', funding_rate: null },
  { name: 'EMPTY_USDT', funding_rate: '  ' },
  { name: 'BTC_USDT_20261030', funding_rate: '0.4' },
  { name: 'BTC_USD', funding_rate: '0.5' },
];

test('funding rates retain valid zero values and compute a limit-independent full-universe average', async () => {
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests += 1; return response(contractRows); };
  try {
    const { getFundingRates } = loadFreshModule();
    const topOne = await getFundingRates(1);
    const topTen = await getFundingRates(10);

    assert.deepEqual(topOne.coverage, {
      sourceContractCount: 9,
      validFundingRateCount: 6,
      invalidFundingRateCount: 3,
    });
    assert.equal(topOne.rows.length, 1);
    assert.equal(topOne.rows[0].symbol, 'Y_USDT');
    assert.equal(topOne.avgFundingPct, -0.1633);
    assert.equal(topTen.avgFundingPct, topOne.avgFundingPct);
    assert.equal(topTen.rows.find(row => row.symbol === 'BTC_USDT').fundingRatePct, 0);
    assert.equal(topTen.rows.find(row => row.symbol === 'ETH_USDT').annualizedPct, 10.95);
    assert.equal(topTen.rows.find(row => row.symbol === 'SOL_USDT').annualizedPct, null);
    assert.equal(topTen.extremePositive.symbol, 'X_USDT');
    assert.equal(topTen.extremeNegative.symbol, 'Y_USDT');
    assert.deepEqual(topTen.majorContracts.map(row => row.symbol), [
      'BTC_USDT', 'ETH_USDT', 'BNB_USDT', 'SOL_USDT',
    ]);
    assert.equal(topTen.majorContracts[0].fundingRatePct, 0);
    assert.equal(topTen.dataStatus, 'partial');
    assert.equal(topTen.sourceUpdatedAt, null);
    assert.match(topTen.reason, /3.*费率字段无效/);
    assert.equal(topOne.cacheStatus, 'miss');
    assert.equal(topTen.cacheStatus, 'hit');
    assert.equal(requests, 1, 'limit changes should reuse the normalized provider snapshot');
  } finally {
    global.fetch = originalFetch;
  }
});

test('major funding summary requires all four exact perpetual symbols and never infers missing coverage as neutral', () => {
  const { summarizeMajorFundingRates } = loadFreshModule();
  const partial = summarizeMajorFundingRates([
    { symbol: 'BTC_USDT', fundingRatePct: 0, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'ETH_USDT', fundingRatePct: 0.01, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'BNB_USDT', fundingRatePct: -0.02, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'SOL_USDT_20261030', fundingRatePct: 99, nextFundingTime: '', annualizedPct: 0 },
  ]);

  assert.equal(partial.coverage, 3);
  assert.equal(partial.averagePct, null);
  assert.match(partial.bias, /覆盖不足.*3\/4/);
  assert.match(partial.warning, /3\/4/);

  const complete = summarizeMajorFundingRates([
    { symbol: 'BTC_USDT', fundingRatePct: 0, fundingIntervalSeconds: 28_800, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'ETH_USDT', fundingRatePct: 0.01, fundingIntervalSeconds: 28_800, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'BNB_USDT', fundingRatePct: -0.02, fundingIntervalSeconds: 28_800, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'SOL_USDT', fundingRatePct: 0.03, fundingIntervalSeconds: 28_800, nextFundingTime: '', annualizedPct: 0 },
  ]);
  assert.equal(complete.coverage, 4);
  assert.ok(Math.abs(complete.averagePct - 0.005) < 1e-12);
  assert.equal(complete.warning, null);

  const incomparable = summarizeMajorFundingRates([
    { symbol: 'BTC_USDT', fundingRatePct: 0, fundingIntervalSeconds: 28_800, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'ETH_USDT', fundingRatePct: 0.01, fundingIntervalSeconds: 28_800, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'BNB_USDT', fundingRatePct: -0.02, fundingIntervalSeconds: 28_800, nextFundingTime: '', annualizedPct: 0 },
    { symbol: 'SOL_USDT', fundingRatePct: 0.03, fundingIntervalSeconds: 14_400, nextFundingTime: '', annualizedPct: 0 },
  ]);
  assert.equal(incomparable.coverage, 4);
  assert.equal(incomparable.averagePct, null);
  assert.match(incomparable.bias, /周期口径不一致/);
});

test('a successful but empty or entirely malformed provider response is not reported as a load failure or valid zero rate', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => response([]);
    const empty = await loadFreshModule().getFundingRates();
    assert.equal(empty.dataStatus, 'empty');
    assert.equal(empty.avgFundingPct, null);
    assert.match(empty.reason, /成功响应.*没有.*USDT/);

    global.fetch = async () => response([{ name: 'BTC_USDT', funding_rate: 'invalid' }]);
    const malformed = await loadFreshModule().getFundingRates();
    assert.equal(malformed.dataStatus, 'unavailable');
    assert.equal(malformed.rows.length, 0);
    assert.equal(malformed.avgFundingPct, null);
    assert.match(malformed.reason, /没有有效资金费率/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('funding panel distinguishes provider failure, empty coverage and cached/partial data without claiming source time', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const functionBody = source.slice(source.indexOf('async function loadMarketSentiment()'), source.indexOf('async function loadPerpetualCrowding()'));

  assert.ok(/Promise\.allSettled/.test(functionBody), 'each sentiment provider should fail independently');
  assert.ok(/coverage\.validFundingRateCount/.test(functionBody), 'show valid-rate coverage');
  assert.ok(/coverage\.sourceContractCount/.test(functionBody), 'show the provider contract denominator');
  assert.ok(/dataStatus === 'empty'/.test(functionBody), 'successful empty data should be distinguished');
  assert.ok(/dataStatus === 'unavailable'/.test(functionBody), 'malformed provider data should be distinguished');
  assert.ok(/cacheStatus/.test(functionBody), 'show whether the snapshot came from cache');
  assert.ok(/fetchedAt/.test(functionBody), 'label retrieval time as retrieval time');
  assert.ok(/sourceUpdatedAt/.test(functionBody), 'do not invent a source observation time');
  assert.ok(/全量有效 USDT 永续合约当前周期费率等权/.test(functionBody), 'explain that the aggregate is not interval-normalized');
});

test('funding panel renders partial and empty states while isolating the other sentiment provider', async () => {
  const dom = createSentimentPanel();
  const { window } = dom;
  window.fetch = async url => {
    if (String(url).includes('fear-greed')) throw new Error('fear source offline');
    return response({
      success: true,
      data: {
        dataStatus: 'partial',
        cacheStatus: 'hit',
        coverage: { sourceContractCount: 3, validFundingRateCount: 2, invalidFundingRateCount: 1 },
        rows: [{ symbol: 'BTC_USDT', fundingRatePct: 0 }],
        avgFundingPct: 0,
        extremePositive: null,
        extremeNegative: null,
        fetchedAt: '2026-10-12T01:02:03.000Z',
        sourceUpdatedAt: null,
        reason: '部分费率无效 <script>bad</script>',
      },
    });
  };
  await window.__loadMarketSentiment();
  assert.match(window.document.querySelector('#fear-greed-card').textContent, /fear source offline/);
  const funding = window.document.querySelector('#funding-rates-card');
  assert.match(funding.textContent, /有效费率 2\/3/);
  assert.match(funding.textContent, /未提供可验证时点/);
  assert.match(funding.textContent, /缓存命中/);
  assert.match(funding.textContent, /0\.0000%/);
  assert.equal(funding.querySelector('script'), null, 'source reason must be escaped before insertion');

  window.fetch = async url => String(url).includes('fear-greed')
    ? response({ success: false, error: 'fear source empty' })
    : response({ success: true, data: {
      dataStatus: 'empty', cacheStatus: 'miss', rows: [], avgFundingPct: null,
      coverage: { sourceContractCount: 0, validFundingRateCount: 0, invalidFundingRateCount: 0 },
      fetchedAt: '2026-10-12T01:04:00.000Z', sourceUpdatedAt: null,
      reason: '来源成功但没有 USDT 永续合约记录',
    } });
  await window.__loadMarketSentiment();
  assert.match(window.document.querySelector('#fear-greed-card').textContent, /fear source empty/);
  assert.match(window.document.querySelector('#funding-rates-card').textContent, /来源成功但暂无数据/);

  window.fetch = async url => String(url).includes('fear-greed')
    ? response({ success: true, data: { current: { value: 31, classificationZh: '恐惧' } } })
    : response({ success: true, data: {
      dataStatus: 'partial', cacheStatus: 'miss', rows: [{ symbol: 'BTC_USDT', fundingRatePct: 0 }],
      avgFundingPct: 0, extremePositive: null, extremeNegative: null,
      coverage: { sourceContractCount: 1, validFundingRateCount: 1, invalidFundingRateCount: 0 },
      fetchedAt: '2026-10-12T01:05:00.000Z', sourceUpdatedAt: null,
      reason: '源端观测时间未提供',
    } });
  await assert.doesNotReject(window.__loadMarketSentiment());
  assert.match(window.document.querySelector('#fear-greed-card').textContent, /响应格式无效/);
  assert.match(window.document.querySelector('#funding-rates-card').textContent, /有效费率 1\/1/);
  dom.window.close();
});

test('assistant funding caution consumes the exact major-contract summary and exposes incomplete coverage', () => {
  const source = fs.readFileSync('src/features/trade-assistant.ts', 'utf8');
  const contextStart = source.indexOf('async function buildContext(');
  const contextEnd = source.indexOf('\nfunction confidenceBucket(', contextStart);
  const contextBuilder = source.slice(contextStart, contextEnd);

  assert.ok(/summarizeMajorFundingRates/.test(source), 'use the shared exact-symbol coverage calculation');
  assert.ok(/fundingResult\.value\.majorContracts/.test(contextBuilder), 'assistant must not depend on the extreme top-N list');
  assert.ok(/fundingSummary\.warning/.test(contextBuilder), 'incomplete major-symbol coverage should be disclosed');
  assert.ok(!/fundingResult\.value\.rows/.test(contextBuilder), 'top-N display rows are not the assistant universe');
  assert.ok(/fundingAvgPct !== null/.test(contextBuilder), 'missing coverage must not be silently treated as zero');
});
