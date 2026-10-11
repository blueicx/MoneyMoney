const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

require('ts-node/register/transpile-only');
const { createYieldQualityService, yieldQualityHttpResponse } = require('../src/features/yield-quality');

const NOW = Date.parse('2026-10-12T06:00:00.000Z');
const SOURCE_URL = 'https://yields.llama.fi/pools';

function pool(overrides = {}) {
  return {
    pool: 'pool-1',
    project: 'Example Protocol',
    symbol: 'USDC-USDT',
    chain: 'Ethereum',
    tvlUsd: 6_000_000,
    apy: 8,
    apyReward: 0,
    apyMean30d: 2,
    apyPct7d: -30,
    stablecoin: false,
    ilRisk: 'no',
    exposure: 'unknown',
    outlier: false,
    ...overrides,
  };
}

function service(data, options = {}) {
  return createYieldQualityService({
    fetchPools: options.fetchPools || (async () => ({ data })),
    now: options.now || (() => new Date(NOW)),
    cacheTtlMs: options.cacheTtlMs,
  });
}

test('unknown impermanent-loss metadata is not scored as a confirmed no-risk pool', async () => {
  const complete = await service([pool()])();
  const unknown = await service([pool({ ilRisk: undefined })])();
  const completeRow = complete.top[0];
  const unknownRow = unknown.top[0];

  assert.equal(completeRow.impermanentLossRisk, false);
  assert.equal(unknownRow.impermanentLossRisk, null);
  assert.equal(completeRow.riskScore - unknownRow.riskScore, 15);
  assert.ok(unknownRow.qualityWarnings.some(item => /无常损失/.test(item)));
  assert.ok(unknownRow.adviceZh.includes('字段信息不完整'));
  assert.ok(!unknownRow.reasonZh.includes('无常损失风险标记为否'));
});

test('invalid seven-day APY change is not converted to zero or given a stability bonus', async () => {
  const missing = await service([pool({ apyPct7d: null })])();
  const invalid = await service([pool({ apyPct7d: 'not-a-number' })])();
  const flat = await service([pool({ apyPct7d: 0 })])();

  assert.equal(invalid.top[0].change7dPct, null);
  assert.equal(invalid.top[0].riskScore, missing.top[0].riskScore);
  assert.equal(flat.top[0].riskScore, missing.top[0].riskScore + 4);
  assert.ok(invalid.top[0].qualityWarnings.some(item => /7日收益变化/.test(item)));
});

test('unknown stablecoin and reward fields are flagged instead of silently treated as false and zero', async () => {
  const result = await service([pool({ stablecoin: undefined, apyReward: undefined })])();
  const row = result.top[0];

  assert.equal(row.stablecoin, null);
  assert.ok(row.qualityWarnings.some(item => /稳定币/.test(item)));
  assert.ok(row.qualityWarnings.some(item => /奖励收益/.test(item)));
  assert.ok(!row.reasonZh.includes('收益主要依赖奖励代币'));
  assert.ok(row.adviceZh.includes('字段信息不完整'));
});

test('response distinguishes source time from retrieval time and does not claim live freshness', async () => {
  const result = await service([pool()])();

  assert.equal(result.market, 'crypto');
  assert.equal(result.instrument, null);
  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.source, 'DefiLlama Yields Pools');
  assert.equal(result.sourceUpdatedAt, null);
  assert.equal(result.retrievedAt, new Date(NOW).toISOString());
  assert.equal(result.updatedAt, result.retrievedAt);
  assert.equal(result.cacheStatus, 'miss');
  assert.ok(result.evidenceRefs.includes(SOURCE_URL));
  assert.match(result.reason, /来源时点|抓取时间/);
});

test('successful empty response and malformed provider response have different states', async () => {
  const empty = await service([])();
  const broken = await service(null)();

  assert.equal(empty.dataStatus, 'empty');
  assert.match(empty.reason, /请求成功|没有返回池记录/);
  assert.equal(broken.dataStatus, 'unavailable');
  assert.match(broken.reason, /data 数组/);
  assert.equal(broken.top.length, 0);
});

test('pool rows without protocol, asset, or chain identity are excluded instead of labeled Unknown', async () => {
  const result = await service([
    pool({ project: undefined }),
    pool({ symbol: '  ' }),
    pool({ chain: null }),
  ])();

  assert.equal(result.invalidRows, 3);
  assert.equal(result.eligible, 0);
  assert.equal(result.top.length, 0);
  assert.equal(result.dataStatus, 'partial');
  assert.match(result.reason, /缺少有效身份、TVL\/APY 或对象结构/);
});

test('provider failures are not cached and a later successful request recovers', async () => {
  let calls = 0;
  const load = createYieldQualityService({
    now: () => new Date(NOW),
    fetchPools: async () => {
      calls += 1;
      if (calls === 1) throw new Error('DefiLlama timeout');
      return { data: [pool()] };
    },
  });

  const failed = await load();
  const recovered = await load();
  assert.equal(failed.dataStatus, 'unavailable');
  assert.match(failed.reason, /timeout/);
  assert.equal(recovered.dataStatus, 'partial');
  assert.equal(calls, 2);
});

test('API returns successful empty data separately from an upstream service failure', async () => {
  const empty = await service([])();
  const unavailable = await service(null)();
  const emptyResponse = yieldQualityHttpResponse(empty);
  const unavailableResponse = yieldQualityHttpResponse(unavailable);

  assert.equal(emptyResponse.status, 200);
  assert.equal(emptyResponse.body.success, true);
  assert.equal(emptyResponse.body.dataStatus, 'empty');
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.body.success, false);
  assert.equal(unavailableResponse.body.dataStatus, 'unavailable');
  assert.ok(unavailableResponse.body.reason);
});

test('cache hits are labeled cached without changing the original retrieval time', async () => {
  let nowMs = NOW;
  let calls = 0;
  const load = createYieldQualityService({
    now: () => new Date(nowMs),
    fetchPools: async () => { calls += 1; return { data: [pool()] }; },
  });

  const first = await load();
  nowMs += 5_000;
  const second = await load();
  assert.equal(first.dataStatus, 'partial');
  assert.equal(second.dataStatus, 'cached');
  assert.equal(second.cacheStatus, 'hit');
  assert.equal(second.retrievedAt, first.retrievedAt);
  assert.equal(calls, 1);
});

test('existing DeFi panel displays freshness, source-time caveat, and real empty/failure reasons', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const start = source.indexOf('function renderDefiYieldQuality()');
  const end = source.indexOf('function setDefiYieldFilter(', start);
  assert.ok(start >= 0 && end > start, 'DeFi renderer should remain an isolated function block');
  const dom = new JSDOM('<div id="defi-yields"></div>');
  const context = {
    document: dom.window.document,
    window: { _defiYieldFilter: 'all' },
    safeNewsText: value => String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]),
    compactUsd: value => `$${value}`,
  };
  vm.runInNewContext(`${source.slice(start, end)}; renderDefiYieldQuality();`, context);
  const element = dom.window.document.getElementById('defi-yields');
  context.window._defiYieldData = {
    dataStatus: 'empty',
    source: 'DefiLlama Yields Pools',
    sourceUpdatedAt: null,
    retrievedAt: '2026-10-12T06:00:00.000Z',
    reason: '来源成功但没有返回符合条件的收益池',
    scanned: 0,
    eligible: 0,
    conservative: 0,
    balanced: 0,
    aggressive: 0,
    highRisk: 0,
    signalZh: '暂无可评估池',
    adviceZh: '数据不完整',
    top: [],
  };
  vm.runInNewContext(`${source.slice(start, end)}; renderDefiYieldQuality();`, context);

  assert.match(element.innerHTML, /来源更新时间未验证/);
  assert.match(element.innerHTML, /抓取时间/);
  assert.match(element.innerHTML, /来源成功但没有返回符合条件的收益池/);
  assert.match(element.innerHTML, /var\(--text-secondary\)/);

  context.window._defiYieldData.top = [{
    project: 'Example Protocol', symbol: 'USDC-USDT', chain: 'Ethereum', tvlUsd: 6_000_000,
    apy: 8, sustainableApy: 2, riskAdjustedApy: 1.2, riskScore: 60, riskColor: 'warning',
    riskLevelZh: '平衡', stablecoin: null, impermanentLossRisk: null,
    adviceZh: '字段信息不完整，风险评分仅基于已知字段。',
    qualityWarnings: ['稳定币标记缺失', '奖励收益拆分缺失，无法判断代币激励占比'],
  }];
  context.window._defiYieldData.dataStatus = 'partial';
  context.window._defiYieldData.eligible = 1;
  context.window._defiYieldData.scanned = 1;
  context.window._defiYieldData.top[0].qualityWarnings.push('<img src=x onerror=alert(1)>');
  vm.runInNewContext(`${source.slice(start, end)}; renderDefiYieldQuality();`, context);
  assert.match(element.innerHTML, /奖励收益拆分缺失/);
  assert.doesNotMatch(element.innerHTML, /<img src=x onerror=alert\(1\)>/);
  assert.match(element.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
