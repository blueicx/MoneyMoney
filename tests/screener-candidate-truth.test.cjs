const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const runtimeSource = fs.readFileSync(path.join(__dirname, '../src/web/public/modules/dashboard-runtime.js'), 'utf8');
const start = runtimeSource.indexOf('let lastBacktestResult = null;');
const end = runtimeSource.indexOf('\nasync function preflightAssetBacktest', start);
const screenerStart = runtimeSource.indexOf('window.saveScreenerCandidate = function(index) {');
const screenerEnd = runtimeSource.indexOf('\nwindow.addScreenerToWatchlist = async function(index)', screenerStart);
assert.notEqual(start, -1, 'backtest candidate runtime block should exist');
assert.notEqual(end, -1, 'backtest candidate runtime block should have a boundary');
assert.notEqual(screenerStart, -1, 'screener candidate save action should exist');
assert.notEqual(screenerEnd, -1, 'screener candidate save action should have a boundary');
const candidateRuntime = `${runtimeSource.slice(start, end)}\n${runtimeSource.slice(screenerStart, screenerEnd)}`;

function createCandidateRuntime(initialCandidates = []) {
  const dom = new JSDOM(`
    <div id="backtest-candidates"></div>
    <input id="bt-market-id"><select id="bt-strategy"><option value="momentum">Momentum</option><option value="mean-reversion">Mean reversion</option></select>
    <input id="bt-lookback"><input id="bt-threshold"><input id="bt-holding">
  `, { url: 'https://example.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.localStorage.setItem('mm-backtest-candidates-v1', JSON.stringify(initialCandidates));
  window.mm_isGuest = true;
  window.fetch = async () => { throw new Error('screener observations must not request freshness'); };
  window.showToast = () => {};
  window.eval(`
    let activeMarketScope = 'stocks';
    function backtestScopeLabel() { return '股票'; }
    function marketResearchEscape(value) { return String(value ?? ''); }
    function scopedUrl(value) { return value; }
    function screenerInstrumentRef() { return { symbol: 'AAPL' }; }
    function showTab() {}
    async function runBacktest() {}
    ${candidateRuntime}
    window.__candidateTest = {
      read: readBacktestCandidates,
      render: renderBacktestCandidates,
      refresh: refreshBacktestCandidateFreshness,
      load: window.loadBacktestCandidate,
      saveScreener: window.saveScreenerCandidate,
    };
  `);
  return { dom, window };
}

test('saving a screener row stores an observation, not fabricated backtest performance', () => {
  const { dom, window } = createCandidateRuntime();
  window.__candidateTest.saveScreener(0);
  const [candidate] = JSON.parse(window.localStorage.getItem('mm-backtest-candidates-v1'));

  assert.equal(candidate.scope, 'stocks');
  assert.equal(candidate.instrument, 'AAPL');
  assert.equal(candidate.source, 'screener');
  assert.equal(candidate.resultStatus, 'not-run');
  assert.equal(candidate.strategy, undefined);
  assert.equal(candidate.returnPct, undefined);
  assert.equal(candidate.winRatePct, undefined);
  assert.equal(candidate.maxDrawdownPct, undefined);
  assert.equal(candidate.totalTrades, undefined);
  dom.window.close();
});

test('legacy screener candidates are normalized without changing completed backtests', () => {
  const legacyObservation = {
    scope: 'stocks', instrument: 'AAPL', source: 'screener', strategy: 'momentum',
    strategyLabel: '筛选候选', returnPct: 0, winRatePct: 0, maxDrawdownPct: 0,
    totalTrades: 0, savedAt: '2026-10-01T00:00:00.000Z', customNote: 'keep me',
  };
  const completedZeroResult = {
    scope: 'stocks', instrument: 'MSFT', strategy: 'momentum', strategyLabel: 'Momentum',
    returnPct: 0, winRatePct: 0, maxDrawdownPct: 0, totalTrades: 1, savedAt: '2026-10-02T00:00:00.000Z',
  };
  const { dom, window } = createCandidateRuntime([legacyObservation, completedZeroResult]);
  const [observation, completed] = window.__candidateTest.read();

  assert.equal(observation.resultStatus, 'not-run');
  assert.equal(observation.strategy, undefined);
  assert.equal(observation.returnPct, undefined);
  assert.equal(observation.winRatePct, undefined);
  assert.equal(observation.maxDrawdownPct, undefined);
  assert.equal(observation.totalTrades, undefined);
  assert.equal(observation.customNote, 'keep me');
  assert.equal(completed.returnPct, 0);
  assert.equal(completed.winRatePct, 0);
  assert.equal(completed.totalTrades, 1);

  const [migrated] = JSON.parse(window.localStorage.getItem('mm-backtest-candidates-v1'));
  assert.equal(migrated.resultStatus, 'not-run');
  assert.equal(migrated.returnPct, undefined);
  dom.window.close();
});

test('candidate library labels untested observations explicitly while retaining genuine zero metrics', () => {
  const { dom, window } = createCandidateRuntime([
    { scope: 'stocks', instrument: 'AAPL', source: 'screener', strategy: 'momentum', strategyLabel: '筛选候选', returnPct: 0, winRatePct: 0, maxDrawdownPct: 0, totalTrades: 0, savedAt: '2026-10-01T00:00:00.000Z' },
    { scope: 'stocks', instrument: 'MSFT', strategy: 'momentum', strategyLabel: 'Momentum', returnPct: 0, winRatePct: 0, maxDrawdownPct: 0, totalTrades: 1, savedAt: '2026-10-02T00:00:00.000Z' },
  ]);
  window.__candidateTest.render();
  const text = window.document.getElementById('backtest-candidates').textContent;
  const observationRow = window.document.getElementById('backtest-candidates').querySelector('div.backtest-meta');

  assert.match(observationRow.textContent, /尚未回测/);
  assert.doesNotMatch(observationRow.textContent, /收益\s*0\.00%|胜率\s*0%/);
  assert.match(text, /MSFT/);
  assert.match(text, /收益 0\.00% · 胜率 0%/);
  dom.window.close();
});

test('untested screener observations do not call the freshness endpoint or invent a strategy on load', async () => {
  const { dom, window } = createCandidateRuntime([
    { scope: 'stocks', instrument: 'AAPL', source: 'screener', resultStatus: 'not-run', strategyLabel: '筛选观察', savedAt: '2026-10-01T00:00:00.000Z' },
  ]);
  let requests = 0;
  window.mm_isGuest = false;
  window.mm_isLoggedIn = true;
  window.fetch = async () => { requests += 1; throw new Error('unexpected freshness lookup'); };
  window.document.getElementById('bt-strategy').value = 'mean-reversion';
  window.__candidateTest.render();
  await window.__candidateTest.refresh(window.__candidateTest.read());
  window.__candidateTest.load(0);

  assert.equal(requests, 0);
  assert.match(window.document.querySelector('[data-candidate-freshness]').textContent, /尚未回测/);
  assert.equal(window.document.getElementById('bt-strategy').value, 'mean-reversion');
  dom.window.close();
});
