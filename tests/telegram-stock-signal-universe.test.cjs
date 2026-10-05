const test = require('node:test');
const assert = require('node:assert/strict');
const telegramSearch = require('../dist/web/telegram-search');

const normalize = telegramSearch.normalizeTelegramStockSignalIdentity;
const buildUniverse = telegramSearch.buildTelegramStockSignalUniverse;

test('exposes a canonical identity resolver for stock signal candidates', () => {
  assert.equal(typeof normalize, 'function');
  assert.equal(typeof buildUniverse, 'function');
});

test('normalizes explicit legacy and canonical stock IDs without guessing a market', { skip: typeof normalize !== 'function' }, () => {
  assert.deepEqual(normalize('usAAPL'), { market: 'us', symbol: 'AAPL', instrumentId: 'stock:us:AAPL' });
  assert.deepEqual(normalize('stock:us:aapl'), { market: 'us', symbol: 'AAPL', instrumentId: 'stock:us:AAPL' });
  assert.deepEqual(normalize('hk00700'), { market: 'hk', symbol: '00700', instrumentId: 'stock:hk:00700' });
  assert.deepEqual(normalize('stock:sh:600519'), { market: 'sh', symbol: '600519', instrumentId: 'stock:sh:600519' });
  assert.equal(normalize('AAPL'), null);
  assert.equal(normalize('crypto:binance:BTCUSDT'), null);
});

test('merges fixed, mover, and permitted watchlist sources by full instrument identity', { skip: typeof buildUniverse !== 'function' }, () => {
  const result = buildUniverse({
    telegramWatchlistIds: ['stock:us:SNDK', 'hk00700', 'crypto:binance:BTCUSDT'],
    administratorWatchlistIds: ['stock:us:SNDK', 'stock:us:MU'],
    isAdmin: false,
    movers: [{ symbol: 'SNDK', name: 'Sandisk', changePct: 8.2, volume: 500000, marketCapUsd: 2_000_000_000 }],
    moverStatus: { state: 'live', source: 'Nasdaq Public Screener', updatedAt: '2026-10-06T00:00:00.000Z' },
  });
  const sndk = result.candidates.find(item => item.instrumentId === 'stock:us:SNDK');
  assert.deepEqual(sndk.sources, ['mover', 'watchlist']);
  assert.equal(result.candidates.some(item => item.instrumentId === 'stock:us:MU'), false);
  assert.equal(result.candidates.some(item => item.instrumentId === 'crypto:binance:BTCUSDT'), false);
  assert.equal(result.candidates.filter(item => item.instrumentId === 'stock:hk:00700').length, 1);
  assert.ok(result.candidates.some(item => item.instrumentId === 'stock:us:NVDA' && item.sources.includes('fixed')));
});

test('admin watchlist visibility is explicit and mover failures do not remove fixed or personal candidates', { skip: typeof buildUniverse !== 'function' }, () => {
  const privateList = buildUniverse({
    telegramWatchlistIds: ['usSNDK'],
    administratorWatchlistIds: ['usMU'],
    isAdmin: false,
    movers: [],
    moverStatus: { state: 'unavailable', source: 'Nasdaq Public Screener', updatedAt: null, reason: 'timeout' },
  });
  assert.equal(privateList.candidates.some(item => item.instrumentId === 'stock:us:MU'), false);
  assert.equal(privateList.candidates.some(item => item.instrumentId === 'stock:us:SNDK' && item.sources.includes('watchlist')), true);
  assert.equal(privateList.moverStatus.state, 'unavailable');

  const admin = buildUniverse({
    telegramWatchlistIds: [], administratorWatchlistIds: ['usMU'], isAdmin: true, movers: [],
    moverStatus: { state: 'empty', source: 'Nasdaq Public Screener', updatedAt: '2026-10-06T00:00:00.000Z' },
  });
  assert.equal(admin.candidates.some(item => item.instrumentId === 'stock:us:MU' && item.sources.includes('watchlist')), true);
  assert.equal(admin.moverStatus.state, 'empty');
});
