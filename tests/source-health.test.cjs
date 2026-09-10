const test = require('node:test');
const assert = require('node:assert');

test('readiness should not be blocked by single slow source', async () => {
  const { getSourceHealth } = await import('../dist/features/source-health.js');
  const start = Date.now();
  const result = await getSourceHealth('all');
  const duration = Date.now() - start;
  assert.ok(duration < 7000, 'should return within budget');
  assert.ok(result.items.length > 0, 'should return partial state');
});
