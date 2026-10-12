const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
const start = source.indexOf("for (const [name, original] of [['drawCandles', drawCandles]");
const end = source.indexOf("window.addEventListener('mm-workspace-modules-ready'", start);
assert.notEqual(start, -1, 'chart instrumentation wrapper must exist');
assert.ok(end > start, 'chart instrumentation wrapper must have a bounded source section');
const wrapper = source.slice(start, end);

function renderInVisibility(hidden) {
  const calls = [];
  const measurements = [];
  const context = {
    document: { hidden },
    performance: { now: (() => { let value = 0; return () => ++value; })() },
    recordMmPerformance: (...args) => measurements.push(args),
    drawCandles: () => calls.push('crypto'),
    drawStockKline: () => calls.push('stocks'),
    window: {},
  };
  vm.runInNewContext(`${wrapper}\ndrawCandles(); drawStockKline();`, context);
  return { calls, measurements };
}

test('hidden pages skip chart drawing while visible pages draw and record bounded metrics', () => {
  assert.deepEqual(renderInVisibility(true), { calls: [], measurements: [] });
  const visible = renderInVisibility(false);
  assert.deepEqual(visible.calls, ['crypto', 'stocks']);
  assert.deepEqual(visible.measurements.map(([kind, name]) => [kind, name]), [
    ['chart', 'drawCandles'],
    ['chart', 'drawStockKline'],
  ]);
});
