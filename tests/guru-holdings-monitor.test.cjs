const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuruHoldingsRefreshMonitor } = require('../dist/features/guru-holdings-refresh-monitor.js');

function createStore() {
  const values = new Map();
  const leases = new Map();
  return {
    values,
    leases,
    get: key => values.get(key) ?? null,
    set: (key, value) => values.set(key, value),
    acquireLease(key, owner, now, leaseMs) {
      const current = leases.get(key);
      if (current && current.expiresAt > now && current.owner !== owner) return false;
      leases.set(key, { owner, expiresAt: now + leaseMs });
      return true;
    },
    releaseLease(key, owner) {
      if (leases.get(key)?.owner !== owner) return false;
      leases.delete(key);
      return true;
    },
  };
}

test('daily refresh is once per Shanghai day and persists the result', async () => {
  const store = createStore();
  let refreshes = 0;
  const forceArguments = [];
  const monitor = createGuruHoldingsRefreshMonitor({
    store,
    owner: 'one',
    now: () => new Date('2026-09-29T02:00:00.000Z'),
    refreshFeaturedManagers: async force => { refreshes += 1; forceArguments.push(force); return [{ dataStatus: 'cached' }, { dataStatus: 'unavailable', reason: 'SEC timeout' }]; },
  });
  const first = await monitor.runIfDue();
  const second = await monitor.runIfDue();
  assert.equal(first.ran, true);
  assert.equal(second.ran, false);
  assert.equal(refreshes, 1);
  assert.deepEqual(forceArguments, [true]);
  assert.equal(store.values.get('guru13f:daily-refresh:last-run').localDate, '2026-09-29');
  assert.equal(store.leases.size, 0);
});

test('a competing process with the daily lease does not start SEC refresh', async () => {
  const store = createStore();
  store.acquireLease('guru13f:daily-refresh:lease', 'other-process', Date.parse('2026-09-29T02:00:00Z'), 600_000);
  let refreshes = 0;
  const monitor = createGuruHoldingsRefreshMonitor({
    store,
    owner: 'this-process',
    now: () => new Date('2026-09-29T02:00:00.000Z'),
    refreshFeaturedManagers: async () => { refreshes += 1; return []; },
  });
  const result = await monitor.runIfDue();
  assert.equal(result.ran, false);
  assert.equal(refreshes, 0);
  assert.equal(store.leases.get('guru13f:daily-refresh:lease').owner, 'other-process');
});

test('start and stop manage the low-frequency timer and await an active refresh', async () => {
  const store = createStore();
  let timerCallback;
  let timerCleared = false;
  let finishRefresh;
  const monitor = createGuruHoldingsRefreshMonitor({
    store,
    owner: 'timer-test',
    now: () => new Date('2026-09-29T02:00:00.000Z'),
    refreshFeaturedManagers: () => new Promise(resolve => { finishRefresh = resolve; }),
    setIntervalFn: callback => { timerCallback = callback; return 41; },
    clearIntervalFn: handle => { timerCleared = handle === 41; },
  });
  monitor.start();
  assert.equal(typeof timerCallback, 'function');
  const stopped = monitor.stop();
  assert.equal(timerCleared, true);
  finishRefresh([]);
  await stopped;
  assert.equal(store.leases.size, 0);
});
