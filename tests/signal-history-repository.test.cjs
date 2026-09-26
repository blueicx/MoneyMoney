const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-signal-store-'));
process.env.MONEYMONEY_DATA_DIR = root;
const { decisionIntelligenceStore } = require('../dist/features/decision-intelligence-store.js');
const { researchRepository, setDbPath } = require('../dist/features/research-repository.js');
const { stateStore } = require('../dist/storage/sqlite-state.js');

test('signal store persists lifecycle transitions with market scope, reason, and evidence refs', () => {
  try {
    setDbPath(path.join(root, 'research.sqlite'));
    const base = { id: 'sig-1', market: 'stocks', instrument: 'AAPL', strategyId: 'momentum', timeframe: '1d', source: 'test', triggeredAt: 1_790_481_600_000, entryPrice: 250, sample: 'paper' };
    decisionIntelligenceStore.saveSignalOutcome({ ...base, status: 'generated' });
    decisionIntelligenceStore.saveSignalOutcome({ ...base, status: 'confirmed', statusReason: '收盘条件已确认', evidenceRefs: ['ev-aapl-1'] });
    decisionIntelligenceStore.saveSignalOutcome({ ...base, status: 'invalidated', statusReason: '来源数据过期导致策略条件失效', invalidationReason: '来源过期', evidenceRefs: ['ev-aapl-2'] });
    const history = researchRepository.listSignalHistory('stocks', 'sig-1');
    assert.equal(history.length, 3);
    assert.deepEqual(history.map(item => item.status), ['generated', 'confirmed', 'invalidated']);
    assert.equal(history.at(-1).reason, '来源数据过期导致策略条件失效');
    assert.deepEqual(history.at(-1).evidenceRefs, ['ev-aapl-2']);
    assert.equal(history.at(-1).instrument, 'AAPL');
    assert.deepEqual(researchRepository.listSignalHistory('crypto', 'sig-1'), []);
  } finally {
    stateStore.close();
    setDbPath(':memory:');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
