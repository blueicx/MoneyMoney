const test = require('node:test');
const assert = require('node:assert');
const { SignalMonitor } = require('../dist/features/signal-monitor.js');

test('Signal Monitor handles deduplication and cooldown', () => {
    const monitor = new SignalMonitor(5000);
    
    const s1 = { id: '1', strategyId: 'stratA', marketId: 'BTC', timestamp: 10000, direction: 'buy' };
    assert.strictEqual(monitor.processSignal(s1), 'confirmed');
    
    const s2 = { id: '2', strategyId: 'stratA', marketId: 'BTC', timestamp: 10000, direction: 'buy' };
    assert.strictEqual(monitor.processSignal(s2), 'deduplicated');
    
    const s3 = { id: '3', strategyId: 'stratA', marketId: 'BTC', timestamp: 12000, direction: 'buy' };
    assert.strictEqual(monitor.processSignal(s3), 'cooldown');
    
    const s4 = { id: '4', strategyId: 'stratA', marketId: 'BTC', timestamp: 16000, direction: 'buy' };
    assert.strictEqual(monitor.processSignal(s4), 'confirmed');
});