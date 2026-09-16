const test = require('node:test');
const { strict: assert } = require('node:assert');
const { runResearchExperiment, generateExperimentArtifacts } = require('../dist/features/experiment-runner.js');

test('research experiment records reproducible configuration, folds, evidence and gate', () => {
  const result = runResearchExperiment({
    context: {
      market: 'stocks', instrument: 'AAPL', timeframe: '1d', workspace: 'backtest',
      strategyId: 'ma-cross', strategyVersion: '2.0.0', dataSource: 'fixture',
      dataFrom: '2026-01-01', dataTo: '2026-04-01', feeRate: 0.001, slippage: 0.002, seed: 42,
    },
    prices: [100, 110, 105, 120, 118, 130],
    signals: [
      { timeIndex: 0, direction: 'buy', source: 'ma-cross' },
      { timeIndex: 1, direction: 'sell', source: 'ma-cross', exitReason: 'target' },
      { timeIndex: 4, direction: 'buy', source: 'ma-cross' },
      { timeIndex: 5, direction: 'sell', source: 'ma-cross', exitReason: 'target' },
    ],
    split: { trainSize: 2, testSize: 2, step: 2, purge: 1, embargo: 1 },
    promotion: { minOutOfSampleReturnPct: 0, minTrades: 1 },
  });
  assert.equal(result.experiment.market, 'stocks');
  assert.equal(result.experiment.instrument, 'AAPL');
  assert.ok(result.experiment.id.startsWith('exp_'));
  assert.equal(result.backtest.metrics.totalReturnPct > 0, true);
  assert.ok(result.folds.length >= 1);
  assert.equal(result.evidence.checks.futureData.passed, true);
  assert.equal(result.gate.passed, true);
  assert.match(result.evidence.summary, /stocks\/AAPL/);
});

test('experiment refuses cross-market instrument and failed promotion stays research-only', () => {
  assert.throws(() => runResearchExperiment({
    context: { market: 'stocks', workspace: 'backtest', instrument: 'crypto:BTCUSDT', dataSource: 'fixture' },
    prices: [100, 101], signals: [],
  }), /does not belong/);
  const result = runResearchExperiment({
    context: { market: 'crypto', workspace: 'backtest', instrument: 'crypto:BTCUSDT', dataSource: 'fixture' },
    prices: [100, 101, 99], signals: [],
    promotion: { minOutOfSampleReturnPct: 10, minTrades: 1 },
  });
  assert.equal(result.gate.passed, false);
  assert.equal(result.gate.status, 'draft');
  assert.equal(result.gate.monitoringAllowed, false);
});

test('experiment artifacts are generated correctly as JSON, CSV and Markdown', () => {
  const result = runResearchExperiment({
    context: { market: 'stocks', workspace: 'backtest', instrument: 'AAPL' },
    prices: [100, 110, 105], signals: [{ timeIndex: 0, direction: 'buy' }],
  });
  const { manifests, files } = generateExperimentArtifacts('test_job', result);
  assert.equal(manifests.length, 3);
  assert.ok(files['result.json'].includes('stocks'));
  assert.ok(files['trades.csv'].includes('timeIndex,direction'));
  assert.ok(files['report.md'].includes('# Experiment'));
  assert.ok(manifests.every(m => m.hash.length > 0));
});
