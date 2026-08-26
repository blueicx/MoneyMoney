const assert = require('node:assert/strict');
const { buildRiskHistoryInsight } = require('../dist/features/risk-history');

const now = Date.now();
const point = (minutesAgo, level, overrides = {}) => ({
  t: new Date(now - minutesAgo * 60_000).toISOString(),
  level,
  riskScore: { 稳健: 0, 观察: 1, 偏高: 2, 危险: 3 }[level],
  openCount: 4,
  exposureUsd: 300,
  concentrationPct: 40,
  marketRiskScore: 55,
  highRiskFlags: 0,
  expiringSoonCount: 2,
  themeClusterCount: 0,
  var95Usd: -10,
  ...overrides,
});

const worsening = buildRiskHistoryInsight([
  point(180, '稳健', { concentrationPct: 32, exposureUsd: 240 }),
  point(60, '观察', { concentrationPct: 48, exposureUsd: 320 }),
  point(10, '偏高', { concentrationPct: 62, exposureUsd: 410, highRiskFlags: 1, expiringSoonCount: 5 }),
]);

assert.equal(worsening.direction, 'worsening');
assert.equal(worsening.deltaRiskScore, 2);
assert.ok(worsening.hours >= 2);
assert.match(worsening.headlineZh, /升至「偏高」/);
assert.match(worsening.detailZh, /恶化时优先减少新仓/);

const improving = buildRiskHistoryInsight([
  point(120, '偏高', { highRiskFlags: 2 }),
  point(30, '稳健', { highRiskFlags: 0 }),
]);
assert.equal(improving.direction, 'improving');
assert.match(improving.headlineZh, /降至「稳健」/);

const insufficient = buildRiskHistoryInsight([point(10, '观察')]);
assert.equal(insufficient.direction, 'insufficient');

console.log('risk history insight: all assertions passed');
