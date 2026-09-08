const assert = require('node:assert/strict');

const {
  validateUnifiedPaperOrder,
  applyUnifiedPaperOrder,
  markUnifiedPaperPrices,
  calculateUnifiedPerformance,
  replayUnifiedPaperOrders,
  emptyUnifiedPaperLedger,
} = require('../dist/features/unified-paper-trading');

assert.equal(validateUnifiedPaperOrder({ instrumentId: 'stock:us:AAPL', instrumentType: 'stock', side: 'BUY', price: 100, quantity: 2 }).ok, true);
assert.equal(validateUnifiedPaperOrder({ instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto', side: 'SELL', price: 100000, quantity: 0.01 }).ok, true);
assert.equal(validateUnifiedPaperOrder({ instrumentId: 'prediction:predictfun:42', instrumentType: 'prediction', side: 'YES', price: 0.4, quantity: 10 }).ok, true);
assert.equal(validateUnifiedPaperOrder({ instrumentId: 'prediction:predictfun:42', instrumentType: 'prediction', side: 'BUY', price: 0.4, quantity: 10 }).ok, false);

let ledger = emptyUnifiedPaperLedger(1000);
ledger = applyUnifiedPaperOrder(ledger, { instrumentId: 'stock:us:AAPL', instrumentType: 'stock', title: 'Apple', side: 'BUY', price: 100, quantity: 2, timestamp: '2026-09-08T01:00:00.000Z' });
assert.equal(ledger.cash, 800);
assert.equal(ledger.positions[0].quantity, 2);
ledger = applyUnifiedPaperOrder(ledger, { instrumentId: 'stock:us:AAPL', instrumentType: 'stock', title: 'Apple', side: 'SELL', price: 110, quantity: 1, timestamp: '2026-09-08T02:00:00.000Z' });
assert.equal(ledger.cash, 910);
assert.equal(ledger.realizedPnl, 10);
assert.equal(ledger.positions[0].quantity, 1);

ledger = applyUnifiedPaperOrder(ledger, { instrumentId: 'prediction:predictfun:42', instrumentType: 'prediction', title: 'Will it happen?', side: 'NO', price: 0.3, quantity: 100, timestamp: '2026-09-08T03:00:00.000Z' });
assert.equal(ledger.positions.find(p => p.instrumentId.includes('prediction')).outcome, 'NO');
ledger = markUnifiedPaperPrices(ledger, new Map([['stock:us:AAPL', 120], ['prediction:predictfun:42', 0.2]]));
const performance = calculateUnifiedPerformance(ledger);
assert.equal(performance.unrealizedPnl, 10);
assert.equal(performance.totalTrades, 3);

const replay = replayUnifiedPaperOrders({ startingCash: 1000, orders: [
  { instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto', side: 'BUY', price: 100, quantity: 1, timestamp: '2026-09-08T00:00:00.000Z' },
  { instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto', side: 'SELL', price: 120, quantity: 1, timestamp: '2026-09-08T01:00:00.000Z' },
] });
assert.equal(replay.realizedPnl, 20);
assert.throws(() => replayUnifiedPaperOrders({ startingCash: 1000, orders: [{ instrumentId: 'crypto:binance:BTCUSDT', instrumentType: 'crypto', side: 'BUY', price: 100, quantity: 1, timestamp: '2026-09-08T00:00:00.000Z' }], prices: {} }), /历史价格/);


const fsNode = require('fs');
const path = require('path');
const indexHtml = fsNode.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'index.html'), 'utf8');

assert.match(indexHtml, /id=.admin-paper-unified-stats./, 'Critical DOM: admin-paper-unified-stats is present');
assert.match(indexHtml, /id=.admin-paper-unified-categories./, 'Critical DOM: admin-paper-unified-categories is present');
assert.match(indexHtml, /\/api\/paper\/performance/, 'API: fetches performance');
assert.match(indexHtml, /\/api\/paper\/positions/, 'API: fetches positions');
assert.match(indexHtml, /typeLabels\s*=\s*{/, 'Category display: types mapped correctly');

console.log('unified paper trading: all assertions passed');
