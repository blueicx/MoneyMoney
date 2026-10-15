const test = require('node:test');
const assert = require('node:assert/strict');

test('CPU summaries count self and inclusive time without retaining URLs or page content', () => {
  const { summarizeCpuProfile } = require('../scripts/benchmark-profile.cjs');
  const summary = summarizeCpuProfile({
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2] },
      { id: 2, callFrame: { functionName: 'renderChart', url: 'https://example.test/assets/chart.js?secret=private' }, children: [3] },
      { id: 3, callFrame: { functionName: 'layout', url: '' } },
    ], samples: [2, 3, 3], timeDeltas: [1000, 2000, 3000],
  });
  assert.equal(summary.sampledMs, 6);
  const chart = summary.frames.find(row => row.functionName === 'renderChart');
  assert.equal(chart.selfMs, 1);
  assert.equal(chart.inclusiveMs, 6);
  assert.equal(chart.path, '/assets/chart.js');
  assert.ok(!JSON.stringify(summary).includes('private'));
});
