const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');
const { buildBacktestPreflight } = require('../dist/features/backtest-preflight.js');
const { assessResearchFreshness } = require('../dist/features/research-freshness.js');

test('backtest preflight counts valid unique bars and refuses cross-market identities', () => {
  const bars = Array.from({ length: 14 }, (_, index) => ({
    time: Date.UTC(2026, 0, index + 1), open: 10, high: 11, low: 9, close: 10.5, volume: 100,
  }));
  const ready = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars, source: 'test-source', lookback: 8, holding: 5 });
  assert.equal(ready.dataStatus, 'ready');
  assert.equal(ready.availableBars, 14);
  assert.equal(ready.requiredBars, 14);
  assert.equal(ready.source, 'test-source');
  assert.match(ready.calendarNote, /不推断/);
  const duplicate = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [...bars, bars[0]], source: 'test-source', lookback: 8, holding: 5 });
  assert.equal(duplicate.availableBars, 14);
  const conflictingDuplicate = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [...bars, { ...bars[0], close: 10.75 }], source: 'test-source', lookback: 8, holding: 5 });
  assert.equal(conflictingDuplicate.dataStatus, 'unavailable');
  assert.match(conflictingDuplicate.reason, /异常 OHLCV/);
  const crossed = buildBacktestPreflight({ market: 'crypto', instrument: 'AAPL', bars, source: 'wrong', lookback: 8, holding: 5 });
  assert.equal(crossed.dataStatus, 'unsupported');
  assert.match(crossed.reason, /市场/);
  const malformed = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [{ ...bars[0], low: 12 }], source: 'test-source', lookback: 1, holding: 1 });
  assert.equal(malformed.dataStatus, 'unavailable');
  const sourceFailed = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [], source: 'test-source', sourceStatus: 'unavailable', sourceError: 'timeout', lookback: 1, holding: 1 });
  assert.match(sourceFailed.reason, /来源不可用.*timeout/);
  const sourceEmpty = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [], source: 'test-source', sourceStatus: 'live', lookback: 1, holding: 1 });
  assert.match(sourceEmpty.reason, /成功响应但没有/);
});

test('freshness is unknown without a pinned data snapshot and stale only for matching later evidence', () => {
  const base = {
    market: 'stocks', instrument: 'stock:us:AAPL', timeframe: '1d', createdAt: '2026-01-10T00:00:00.000Z',
    revisions: [], corporateActions: [], strategyVersion: '1', currentStrategyVersion: '1',
  };
  assert.equal(assessResearchFreshness(base).status, 'unknown');
  const pinned = { ...base, dataSnapshotHash: 'a'.repeat(64) };
  assert.equal(assessResearchFreshness(pinned).status, 'current');
  const revised = assessResearchFreshness({ ...pinned, revisions: [
    { market: 'stocks', instrument: 'AAPL', timeframe: '1d', dataset: 'bars', publishedAt: '2026-01-11T00:00:00.000Z', contentHash: 'hash-b' },
    { market: 'crypto', instrument: 'BTCUSDT', timeframe: '1d', dataset: 'bars', publishedAt: '2026-01-12T00:00:00.000Z', contentHash: 'hash-c' },
  ] });
  assert.equal(revised.status, 'stale');
  assert.equal(revised.findings.length, 1);
  const action = assessResearchFreshness({ ...pinned, corporateActions: [
    { market: 'stocks', instrument: 'AAPL', effectiveAt: '2026-01-12T00:00:00.000Z', kind: 'split' },
  ] });
  assert.equal(action.status, 'stale');
  const strategy = assessResearchFreshness({ ...pinned, currentStrategyVersion: '2' });
  assert.equal(strategy.status, 'stale');
});

test('backtest performs a same-market bar coverage preflight before starting the run', () => {
  assert.match(server, /app\.get\('\/api\/backtest\/preflight'/);
  assert.match(server, /buildBacktestPreflight/);
  const runBacktest = page.slice(page.indexOf('async function runBacktest()'), page.indexOf('function drawEquityChart'));
  assert.match(runBacktest, /preflightAssetBacktest[\s\S]*?\/api\/backtest/);
  assert.match(page, /id="backtest-data-preflight"/);
  assert.match(server, /scope === 'stocks'[\s\S]*?stockDataService\.overview/);
  assert.match(server, /scope === 'crypto'[\s\S]*?binanceFeed\.getKlines/);
});

test('research freshness reports later revisions and corporate actions without guessing a snapshot match', () => {
  assert.match(server, /app\.get\('\/api\/research\/experiments\/:id\/freshness'/);
  assert.match(server, /assessResearchFreshness/);
  const pageCandidates = page.slice(page.indexOf('function renderBacktestCandidates'), page.indexOf('window.toggleBacktestCandidates'));
  assert.match(pageCandidates, /refreshBacktestCandidateFreshness/);
  assert.match(page, /人工复跑/);
  assert.match(page, /快照未固定|无法验证/);
});
