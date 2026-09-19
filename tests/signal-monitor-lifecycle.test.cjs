const test = require('node:test');
const { strict: assert } = require('node:assert');
const { SignalMonitor } = require('../dist/features/signal-monitor.js');

test('signal monitor records lifecycle and exposes watch-group deduplication', () => {
  const monitor = new SignalMonitor(5000);
  const signal = { id: 'sig-1', strategyId: 's1', marketId: 'stocks:AAPL', timestamp: 10000, direction: 'buy' };
  assert.equal(monitor.processSignal(signal), 'confirmed');
  assert.equal(monitor.getLifecycle('sig-1').state, 'generated');
  assert.equal(monitor.advance('sig-1', 'confirm').state, 'confirmed');
  assert.equal(monitor.advance('sig-1', 'paper-fill').state, 'paper-filled');
  assert.equal(monitor.advance('sig-1', 'track').state, 'tracking');
  assert.equal(monitor.advance('sig-1', 'close').state, 'closed');
  assert.equal(monitor.advance('sig-1', 'review').state, 'reviewed');

  const grouped = { ...signal, id: 'sig-2', timestamp: 20000 };
  assert.equal(monitor.processSignal(grouped, 'watch:core'), 'confirmed');
  assert.equal(monitor.processSignal({ ...grouped, id: 'sig-3', timestamp: 20000 }, 'watch:core'), 'deduplicated');
  assert.equal(monitor.listLifecycles('stocks:AAPL').length, 3);
});
