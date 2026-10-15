const test = require('node:test');
const assert = require('node:assert/strict');

test('timeline summaries identify long layout call sites without retaining trace payloads', () => {
  const { summarizeTimeline } = require('../scripts/benchmark-profile.cjs');
  assert.equal(typeof summarizeTimeline, 'function');
  const summary = summarizeTimeline([
    { name:'Layout', ph:'X', ts:1000, dur:50000, args:{ beginData:{ stackTrace:[{ functionName:'draw', url:'https://example.test/chart.js?private=secret', lineNumber:12 }] }, private:'secret' } },
    { name:'Layout', ph:'X', ts:60000, dur:10000 },
    { name:'UpdateLayoutTree', ph:'X', ts:80000, dur:20000 },
    { name:'ResourceSendRequest', ph:'X', dur:10000, args:{ data:{ url:'https://example.test/private' } } },
    { name:'Layout', ph:'B', dur:10000 },
  ]);
  assert.equal(summary.totals.find(row => row.name === 'Layout').durationMs, 60);
  assert.equal(summary.longest[0].durationMs, 50);
  assert.equal(summary.longest[0].stack[0].path, '/chart.js');
  assert.equal(summary.longest[0].stack[0].lineNumber, 12);
  assert.ok(!JSON.stringify(summary).includes('secret'));
  assert.ok(!JSON.stringify(summary).includes('private'));
});

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
