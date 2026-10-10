const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateAiRunnerPortfolioCorrelation } = require('../dist/features/ai-paper-runner');

function series(instrumentId, returns, options = {}) {
  let close = 100;
  const points = [{ time: 1_800_000_000_000, close }];
  for (let index = 0; index < returns.length; index += 1) {
    close *= 1 + returns[index];
    points.push({ time: 1_800_000_060_000 + index * 60_000, close });
  }
  return {
    market: options.market || 'stocks', instrumentId, timeframe: options.timeframe || '1m',
    source: options.source || 'Yahoo 1m', status: options.status || 'delayed', points,
  };
}

const returns = [0.01, -0.02, 0.015, -0.005, 0.03, -0.012, 0.007, -0.018, 0.022, -0.004, 0.011, -0.009];

test('watchlist correlation gate compares same-market aligned series and blocks highly correlated additions', () => {
  const candidate = series('stock:us:MSFT', returns);
  const held = series('stock:us:AAPL', returns);
  const result = evaluateAiRunnerPortfolioCorrelation({
    market: 'stocks', universeKind: 'watchlist', candidate, openInstrumentIds: ['stock:us:AAPL'],
    universeInstrumentIds: [candidate.instrumentId, held.instrumentId], comparators: [held], asOf: held.points.at(-1).time,
  });
  assert.equal(result.applicable, true);
  assert.equal(result.allowed, false);
  assert.equal(result.comparisons[0].correlation, 1);
  assert.match(result.reason, /高度相关/);
});

test('correlation gate allows a sufficiently independent aligned candidate', () => {
  const inverse = returns.map(value => -value);
  const candidate = series('crypto:binance:ETHUSDT', inverse, { market: 'crypto', source: 'Binance 1h', timeframe: '1h' });
  const held = series('crypto:binance:BTCUSDT', returns, { market: 'crypto', source: 'Binance 1h', timeframe: '1h' });
  const result = evaluateAiRunnerPortfolioCorrelation({
    market: 'crypto', universeKind: 'watchlist', candidate, openInstrumentIds: [held.instrumentId],
    universeInstrumentIds: [candidate.instrumentId, held.instrumentId], comparators: [held], asOf: held.points.at(-1).time,
  });
  assert.equal(result.allowed, true);
  assert.ok(result.comparisons[0].correlation < -0.99);
});

test('correlation gate fails closed on missing or non-comparable data and excludes future points', () => {
  const candidate = series('stock:us:MSFT', returns);
  const held = series('stock:us:AAPL', returns);
  const missing = evaluateAiRunnerPortfolioCorrelation({
    market: 'stocks', universeKind: 'watchlist', candidate, openInstrumentIds: [held.instrumentId], comparators: [],
    universeInstrumentIds: [candidate.instrumentId, held.instrumentId],
    asOf: held.points.at(-1).time,
  });
  assert.equal(missing.allowed, false);
  assert.match(missing.reason, /历史不足|无法比较|来源或周期不可比/);

  const sourceMismatch = evaluateAiRunnerPortfolioCorrelation({
    market: 'stocks', universeKind: 'watchlist', candidate, openInstrumentIds: [held.instrumentId],
    universeInstrumentIds: [candidate.instrumentId, held.instrumentId], comparators: [{ ...held, source: 'Other provider' }], asOf: held.points.at(-1).time,
  });
  assert.equal(sourceMismatch.allowed, false);
  assert.match(sourceMismatch.reason, /来源或周期/);

  const futureCutoff = held.points[8].time;
  const futureExcluded = evaluateAiRunnerPortfolioCorrelation({
    market: 'stocks', universeKind: 'watchlist', candidate, openInstrumentIds: [held.instrumentId],
    universeInstrumentIds: [candidate.instrumentId, held.instrumentId], comparators: [held], asOf: futureCutoff,
  });
  assert.equal(futureExcluded.allowed, false);
  assert.match(futureExcluded.reason, /同步收益不足/);
});

test('correlation gate is explicitly not applicable to single, options, or prediction runners', () => {
  const candidate = series('option:deribit:BTC-30DEC26-50000-C', returns, { market: 'options', source: 'Deribit', timeframe: '1m' });
  for (const input of [
    { market: 'stocks', universeKind: 'single', candidate, openInstrumentIds: [], comparators: [] },
    { market: 'options', universeKind: 'watchlist', candidate, openInstrumentIds: [], comparators: [] },
    { market: 'prediction', universeKind: 'watchlist', candidate, openInstrumentIds: [], comparators: [] },
  ]) {
    const result = evaluateAiRunnerPortfolioCorrelation({ ...input, asOf: candidate.points.at(-1).time });
    assert.equal(result.applicable, false);
    assert.equal(result.allowed, true);
  }
});

test('server records the correlation gate and enforces it only before BUY execution', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  assert.match(source, /snapshot\.portfolioCorrelation = evaluateAiRunnerPortfolioCorrelation/);
  assert.match(source, /name: 'portfolio-correlation', passed: snapshot\.portfolioCorrelation\.allowed/);
  assert.match(source, /action === 'BUY' && correlationCheck && !correlationCheck\.passed/);
  assert.match(source, /comparators: correlationComparators[\s\S]*asOf: now\.getTime\(\)/);
});
