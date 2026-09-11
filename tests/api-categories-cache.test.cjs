const assert = require('node:assert/strict');
const test = require('node:test');

test('getCategories propagates an uncached upstream error', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'upstream down',
  });

  const { api } = require('../dist/api');
  await assert.rejects(
    api.getCategories(1, 'uncached-error', 'OPEN'),
    /failed after 1 attempts|API Error 500/
  );
});
