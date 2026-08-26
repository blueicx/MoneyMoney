const assert = require('node:assert/strict');
const { buildPortfolioRiskOverview } = require('../dist/features/risk-overview');

const paper = {
  startingBalance: 1000,
  cashBalance: 760,
  positions: [{
    id: 'paper-btc',
    marketId: 42,
    marketTitle: 'Will Bitcoin close above $100,000?',
    outcomeIndex: 0,
    outcomeName: 'YES',
    side: 'BUY',
    entryPrice: 0.5,
    quantity: 200,
    entryTime: new Date().toISOString(),
    status: 'OPEN',
  }],
  tradeLog: [],
  totalPnl: 40,
  winsCount: 8,
  lossesCount: 4,
  maxDrawdownPct: 6,
  peakEquity: 1045,
};

const overview = buildPortfolioRiskOverview(
  {
    journal: {
      openTrades: [{
        venue: 'Predict.fun',
        confidencePct: 68,
        title: 'Bitcoin dominance test',
        symbol: 'BTCUSDT',
      }],
    },
    regime: { labelZh: '温和扩张' },
    context: {
      crossAssetRisk: { riskScore: 58 },
      cautionFlags: [{
        id: 'test-caution',
        severity: 'high',
        severityZh: '高',
        titleZh: '测试提醒',
        adviceZh: '先降低仓位',
        source: 'test',
      }],
    },
    cryptoActions: [{
      id: 'btc',
      venue: 'Binance',
      symbol: 'BTCUSDT',
      title: 'BTC trend test',
      action: 'BUY',
      actionZh: '买入观察',
      confidencePct: 72,
      suggestedRiskPct: 1,
      horizon: 'swing',
      reasons: [],
      metrics: {},
    }],
  },
  { ...paper, equity: 1040, openPositionsValue: 240 },
  { var95Usd: -32, profitFactor: 1.2, winRate: 0.67 },
  {
    ready: true,
    markets: [{
      id: 'sample',
      platform: 'Polymarket',
      title: 'Sample event?',
      titleZh: '样本事件吗？',
      yesPrice: 0.35,
      modelProbability: 0.62,
      probabilityConfidence: 74,
      liquidity: 20000,
      volume24h: 8000,
      activityScore: 2,
      endDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    }],
  },
);

assert.equal(overview.cautions.length, 1);
assert.equal(overview.highConvictionCount, 1);
assert.equal(overview.radarWatchlist.length, 1);
assert.equal(overview.radarWatchlist[0].marketId, 'sample');
assert.ok(overview.radarWatchlist[0].watchToken);
assert.ok(overview.radarWatchlist[0].edgePct >= 20);
assert.equal(overview.expiringSoonCount, 1);
assert.ok(overview.commandSummaryZh.includes('临近截止'));
assert.ok(overview.recommendationsZh.join(' ').includes('7 天内截止'));
assert.equal(overview.themeClusters.length, 1);
assert.equal(overview.themeClusters[0].themeZh, '比特币');
assert.equal(overview.themeClusters[0].count, 2);

console.log('risk command center helpers: all assertions passed');
