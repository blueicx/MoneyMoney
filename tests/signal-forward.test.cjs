const { test } = require('node:test');
const assert = require('node:assert/strict');
const { observeForwardSignal } = require('../dist/features/signal-forward');
test('forward results use only post-trigger completed bars up to expiry', () => {
  const signal = { id:'s', market:'stocks', instrument:'stock:us:AAPL', strategyId:'m', strategyVersion:'v2', timeframe:'1h', source:'real', triggeredAt:0, entryPrice:100, expiresAt:9000000 };
  const bars = [{ time:0, high:200, low:1, close:150 }, { time:3600000, high:110, low:95, close:105 }, { time:7200000, high:500, low:1, close:400 }];
  const result = observeForwardSignal(signal,bars,10800000);
  assert.equal(result.points.length,1);
  assert.equal(result.mfePct,10); assert.equal(result.maePct,-5);
  assert.equal(result.returnPct,5); assert.equal(result.strategyVersion,'v2');
});
test('missing data and unknown timeframe produce explicit unavailable reasons', () => {
  const signal = { id:'s', market:'crypto',instrument:'crypto:binance:BTCUSDT',strategyId:'m',timeframe:'mystery',source:'real',triggeredAt:0,entryPrice:100 };
  assert.equal(observeForwardSignal(signal,[],10000).dataStatus,'unsupported');
  assert.equal(observeForwardSignal({ ...signal,timeframe:'1h' },[],10000).dataStatus,'empty');
});
