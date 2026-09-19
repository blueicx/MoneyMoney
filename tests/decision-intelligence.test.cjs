const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  createEvidenceSnapshot,
  compareEvidenceSnapshots,
  runScenario,
  createDecisionRecord,
  reviewDecision,
  importPortfolioRows,
  analyzePortfolio,
  analyzeSignalQuality,
  createSavedWorkspace,
} = require('../dist/features/decision-intelligence.js');

test('evidence snapshots expose transparent quality dimensions and deterministic hashes', () => {
  const input = {
    market: 'stocks', instrument: 'AAPL', workspace: 'analysis', dataStatus: 'live',
    source: { id: 'nasdaq-public-quote', name: 'Nasdaq', url: 'https://www.nasdaq.com/market-activity/stocks/aapl' },
    observedAt: '2026-09-19T01:00:00.000Z', fetchedAt: '2026-09-19T01:00:03.000Z',
    fields: { price: 240.5, changePct: 1.2 }, expectedFields: ['price', 'changePct', 'volume'],
    corroboratingSources: 2,
  };
  const first = createEvidenceSnapshot(input);
  const second = createEvidenceSnapshot(input);
  assert.equal(first.hash, second.hash);
  assert.equal(first.market, 'stocks');
  assert.equal(first.quality.completeness, 2 / 3);
  assert.equal(first.quality.freshness, 1);
  assert.ok(first.quality.sourceReliability > 0);
  assert.ok(first.quality.corroboration > 0);
  assert.equal('score' in first.quality, false, 'quality must not collapse into an opaque score');
  assert.throws(() => createEvidenceSnapshot({ ...input, market: 'stocks', instrument: 'BTCUSDT' }), /market|标的/i);
});

test('evidence comparison reports changed fields without mutating either snapshot', () => {
  const base = createEvidenceSnapshot({
    market: 'crypto', instrument: 'BTCUSDT', workspace: 'analysis', dataStatus: 'cached',
    source: { id: 'binance-public', name: 'Binance' }, observedAt: '2026-09-19T01:00:00Z',
    fetchedAt: '2026-09-19T01:00:01Z', fields: { price: 60000, funding: 0.01 }, expectedFields: ['price', 'funding'],
  });
  const next = createEvidenceSnapshot({ ...base, id: undefined, hash: undefined, fields: { price: 61000, funding: 0.01 }, fetchedAt: '2026-09-19T02:00:01Z' });
  const changes = compareEvidenceSnapshots(base, next);
  assert.deepEqual(changes.map(item => item.field), ['price']);
  assert.equal(base.fields.price, 60000);
});

test('scenario runs are deterministic stress tests and never claim to be forecasts', () => {
  const scenario = {
    id: 'risk-off', name: 'Risk off', market: 'stocks',
    shocks: [{ target: 'market', kind: 'pricePct', value: -10 }, { target: 'volatility', kind: 'absolute', value: 8 }],
  };
  const portfolio = [{ instrument: 'AAPL', market: 'stocks', quantity: 10, price: 200, beta: 1.2 }];
  const first = runScenario(scenario, portfolio);
  const second = runScenario(scenario, portfolio);
  assert.deepEqual(first, second);
  assert.equal(first.kind, 'stress-test');
  assert.match(first.disclaimer, /压力测试|预测/i);
  assert.ok(first.impact.totalValueAfter < first.impact.totalValueBefore);
  assert.throws(() => runScenario({ ...scenario, market: 'crypto' }, portfolio), /market|市场/i);
});

test('decision records preserve evidence and review invalidation breaches', () => {
  const decision = createDecisionRecord({
    market: 'stocks', instrument: 'AAPL', direction: 'long', thesis: '盈利修正改善',
    counterEvidence: ['估值偏高'], invalidation: { field: 'price', operator: 'lt', value: 180 },
    horizonAt: '2026-12-01T00:00:00Z', evidenceIds: ['ev_1'], strategyId: 'quality-momentum',
  });
  const reviewed = reviewDecision(decision, { price: 170 }, '2026-12-02T00:00:00Z');
  assert.equal(reviewed.status, 'invalidated');
  assert.equal(reviewed.invalidationBreached, true);
  assert.deepEqual(reviewed.evidenceIds, ['ev_1']);
});

test('portfolio import validates market, units and duplicates before analytics', () => {
  const imported = importPortfolioRows([
    { instrument: 'AAPL', market: 'stocks', quantity: 10, price: 200, currency: 'USD' },
    { instrument: 'AAPL', market: 'stocks', quantity: 10, price: 200, currency: 'USD' },
    { instrument: 'BTCUSDT', market: 'stocks', quantity: 1, price: 60000, currency: 'USD' },
    { instrument: 'ETHUSDT', market: 'crypto', quantity: -1, price: 3000, currency: 'USD' },
  ]);
  assert.equal(imported.accepted.length, 1);
  assert.equal(imported.rejected.length, 3);
  assert.ok(imported.rejected.some(item => /重复/.test(item.reason)));
  assert.ok(imported.rejected.some(item => /market|市场|标的/i.test(item.reason)));

  const analytics = analyzePortfolio(imported.accepted, { benchmarkReturnPct: 5, portfolioReturnPct: 8 });
  assert.equal(analytics.totalValue, 2000);
  assert.equal(analytics.concentrationPct, 100);
  assert.equal(analytics.excessReturnPct, 3);
  assert.ok(Array.isArray(analytics.stressTests));
});

test('signal quality separates cohorts and warns for low samples and data gaps', () => {
  const report = analyzeSignalQuality([
    { id: 's1', market: 'stocks', instrument: 'AAPL', strategyId: 'ma', pattern: 'bullish-engulfing', timeframe: '1d', source: 'nasdaq', triggeredAt: 1, entryPrice: 100, exitPrice: 110, mfePct: 14, maePct: -3, confirmationDelayMs: 1000, sample: 'oos' },
    { id: 's2', market: 'stocks', instrument: 'MSFT', strategyId: 'ma', pattern: 'bullish-engulfing', timeframe: '1d', source: 'nasdaq', triggeredAt: 2, entryPrice: 100, exitPrice: 95, mfePct: 2, maePct: -8, confirmationDelayMs: 2500, sample: 'live', dataGap: true },
  ], { minimumSamples: 10, benchmarkReturnPct: 1 });
  assert.equal(report.total, 2);
  assert.equal(report.hitRate, 0.5);
  assert.equal(report.sampleBreakdown.oos, 1);
  assert.equal(report.sampleBreakdown.live, 1);
  assert.ok(report.warnings.some(item => /样本/.test(item)));
  assert.ok(report.warnings.some(item => /缺口/.test(item)));
});

test('saved workspaces restore only market-scoped instruments and safe layout state', () => {
  const workspace = createSavedWorkspace({
    name: 'AAPL 日线研究', market: 'stocks', workspace: 'analysis', instrument: 'AAPL', timeframe: '1d',
    filters: { changePct: { min: 1 } }, layers: ['ma', 'patterns'], compare: ['MSFT'], layout: { rightLibraryCollapsed: true },
  });
  assert.equal(workspace.market, 'stocks');
  assert.equal(workspace.layout.rightLibraryCollapsed, true);
  assert.throws(() => createSavedWorkspace({ ...workspace, id: undefined, instrument: 'BTCUSDT' }), /market|标的/i);
});

test('stable APIs and one connected decision workspace are present', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const page = fs.readFileSync('src/web/public/index.html', 'utf8');
  for (const route of [
    "app.get('/api/evidence'", "app.post('/api/evidence'", "app.get('/api/scenarios'", "app.post('/api/scenarios/run'",
    "app.get('/api/decisions'", "app.post('/api/decisions'", "app.get('/api/portfolio/analytics'",
    "app.post('/api/portfolio/import'", "app.get('/api/signals/quality'", "app.get('/api/workspaces'", "app.post('/api/workspaces'",
  ]) assert.ok(server.includes(route), `missing ${route}`);
  assert.match(page, /decision-intelligence-tab/);
  assert.match(page, /证据与可信度/);
  assert.match(page, /情景实验室/);
  assert.match(page, /决策日记/);
  assert.match(page, /组合驾驶舱/);
  assert.match(page, /信号质量/);
});
