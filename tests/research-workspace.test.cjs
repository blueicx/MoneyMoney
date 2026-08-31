const assert = require('node:assert/strict');
const {
  createResearchEntry,
  summarizeResearchEntry,
  appendResearchNote,
} = require('../dist/features/research-workspace');

const entry = createResearchEntry({
  subjectType: 'prediction',
  subjectId: 'poly-42',
  title: 'BTC 今年突破新高？',
  thesis: '链上活动改善，但资金费率偏高。',
  tags: ['比特币', '宏观'],
}, new Date('2026-08-30T08:00:00Z'));

assert.equal(entry.status, 'WATCHING');
assert.equal(entry.subjectId, 'poly-42');
assert.equal(entry.notes.length, 0);

const withSnapshot = {
  ...entry,
  snapshots: [{
    capturedAt: '2026-08-30T09:00:00Z',
    marketProbability: 0.58,
    modelProbability: 0.71,
    confidence: 76,
    sources: [{ name: 'Binance', status: 'fresh', capturedAt: '2026-08-30T09:00:00Z' }],
  }],
};
const summary = summarizeResearchEntry(withSnapshot);
assert.equal(summary.marketProbabilityPct, 58);
assert.equal(summary.modelProbabilityPct, 71);
assert.equal(summary.edgePct, 13);
assert.equal(summary.sourceCount, 1);
assert.equal(summary.freshSourceCount, 1);

const noted = appendResearchNote(withSnapshot, '等待资金费率回落后再评估。', ['等待']);
assert.equal(noted.notes.length, 1);
assert.equal(noted.notes[0].tags[0], '等待');

console.log('research workspace helpers: all assertions passed');
