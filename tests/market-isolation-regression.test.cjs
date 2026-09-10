const assert = require('node:assert/strict');
const { buildDailyResearchBriefing } = require('../dist/features/research-briefing');

function testIsolation(scope, expectedStatus) {
  const briefing = buildDailyResearchBriefing({
    scope,
    markets: [{ yesPrice: 0.5, modelProbability: 0.8, volume24h: 100000, liquidity: 100000 }],
    radarReady: true,
    paper: { equity: 1000, cashBalance: 1000, openPositionsValue: 0, totalPnl: 0, winRate: 0, openCount: 0, closedCount: 0, maxDrawdownPct: 0 },
    metrics: { var95Usd: 0, profitFactor: 1 },
    forecastLab: { activeCount: 0 }
  });

  assert.equal(briefing.sourceStatus, expectedStatus, `Scope ${scope} should have sourceStatus ${expectedStatus}`);

  if (expectedStatus === 'unavailable') {
    assert.equal(briefing.focusMarkets.length, 0, 'No prediction focus for non-prediction market');
    assert.match(briefing.headlineZh, /当前市场暂无专用研究简报数据/, 'Headline should indicate unavailable');
    assert.match(briefing.forecastLab.verdictZh, /非预测市场视图/, 'ForecastLab should indicate unavailable');
    assert.match(briefing.forecastLab.bestGroupZh, /非预测市场视图/, 'ForecastLab group should indicate unavailable');
  }
}

testIsolation('stocks', 'unavailable');
testIsolation('options', 'unavailable');
testIsolation('crypto', 'unavailable');
testIsolation('prediction', 'ok');
testIsolation('overview', 'ok');

console.log('market isolation regression: all assertions passed');
