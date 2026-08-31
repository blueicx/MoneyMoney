const assert = require('node:assert/strict');
const {
  calculatePaperPortfolioValue,
  validatePaperOrderInput,
} = require('../dist/features/paper-trading');

const portfolio = {
  startingBalance: 1000,
  cashBalance: 800,
  positions: [{
    id: 'p1', marketId: 42, marketTitle: 'test', outcomeIndex: 0,
    outcomeName: 'YES', side: 'BUY', entryPrice: 0.5, quantity: 400,
    currentPrice: 0.65, entryTime: '2026-08-30T08:00:00Z', status: 'OPEN',
  }],
  tradeLog: [], totalPnl: 0, winsCount: 0, lossesCount: 0,
  maxDrawdownPct: 0, peakEquity: 1000,
};
const value = calculatePaperPortfolioValue(portfolio);
assert.equal(value.openPositionsValue, 260);
assert.equal(value.equity, 1060);
assert.equal(value.unrealizedPnl, 60);

assert.equal(validatePaperOrderInput({ price: 0.4, amountUsd: 20 }).ok, true);
assert.equal(validatePaperOrderInput({ price: 0, amountUsd: 20 }).ok, false);
assert.equal(validatePaperOrderInput({ price: 0.4, amountUsd: -1 }).ok, false);

console.log('paper trading helpers: all assertions passed');
