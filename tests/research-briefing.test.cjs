const assert = require('node:assert/strict');
const { buildDailyResearchBriefing } = require('../dist/features/research-briefing');

const endDate = new Date(Date.now() + 4 * 86_400_000).toISOString();
const market = {
  platform: 'Polymarket',
  id: 'test-market',
  title: 'Will the sample event resolve YES?',
  category: 'Test',
  group: 'Research',
  outcome: 'YES',
  url: 'https://example.com/market',
  yesPrice: 0.42,
  noPrice: 0.58,
  volume24h: 24_000,
  volumeTotal: 120_000,
  liquidity: 52_000,
  endDate,
  activityScore: 2.2,
  internalEdge: 0,
  modelProbability: 0.61,
  probabilityConfidence: 78,
};

const briefing = buildDailyResearchBriefing({
  markets: [market],
  radarReady: true,
  paper: {
    equity: 1040,
    cashBalance: 790,
    openPositionsValue: 250,
    totalPnl: 40,
    winRate: 0.62,
    openCount: 3,
    closedCount: 21,
    maxDrawdownPct: 6.5,
  },
  metrics: { var95Usd: -38, profitFactor: 1.35 },
  forecastLab: {
    updatedAt: new Date().toISOString(),
    activeCount: 1,
    resolvedCount: 8,
    evaluatedCases: 8,
    evaluatedSamples: 34,
    model: { cases: 8, samples: 34, brier: 0.184, logLoss: 0.51, hitRatePct: 71 },
    market: { cases: 8, samples: 34, brier: 0.201, logLoss: 0.55, hitRatePct: 68 },
    modelEdgePct: 4.6,
    verdictZh: '样本测试结论',
    calibration: [],
    platforms: [],
    groups: [{ name: '科技', cases: 3, samples: 9, modelBrier: 0.16, marketBrier: 0.22, edgePct: 5 }],
    confidenceGroups: [],
    activeCases: [],
    resolvedCases: [],
    noteZh: '',
  },
});

assert.equal(briefing.focusMarkets.length, 1);
assert.equal(briefing.focusMarkets[0].marketPct, 42);
assert.equal(briefing.focusMarkets[0].modelPct, 61);
assert.equal(briefing.risk.levelZh, '稳健');
assert.equal(briefing.forecastLab.evaluatedSamples, 34);
assert.match(briefing.forecastLab.bestGroupZh, /科技/);
assert.ok(briefing.checklistZh.length >= 4);

console.log('research briefing helpers: all assertions passed');
