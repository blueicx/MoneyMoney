const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { AiRunnerTickCoordinator, buildAiRunnerTickIdempotencyKey } = require('../dist/features/ai-runner-coordinator');

function makeStore(root) {
  return new SQLiteStateStore(path.join(root, 'state.sqlite'), root);
}

test('manual and scheduled workers cannot commit the same AI runner tick twice', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-runner-lock-'));
  const firstStore = makeStore(root);
  const secondStore = makeStore(root);
  try {
    const first = new AiRunnerTickCoordinator(firstStore);
    const second = new AiRunnerTickCoordinator(secondStore);
    const tickKey = buildAiRunnerTickIdempotencyKey('r1', new Date('2026-10-05T00:10:42.000Z'));
    let prepared = 0;
    let committed = 0;
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const active = first.run('r1', tickKey, async () => { prepared += 1; await blocked; return { action: 'BUY' }; }, data => { committed += 1; return data; }, 'worker-one');
    await new Promise(resolve => setTimeout(resolve, 20));
    const concurrent = await second.run('r1', tickKey, async () => { prepared += 1; return { action: 'BUY' }; }, data => { committed += 1; return data; }, 'worker-two');
    release();
    const completed = await active;
    const retry = await second.run('r1', tickKey, async () => { prepared += 1; return { action: 'BUY' }; }, data => { committed += 1; return data; }, 'worker-two');

    assert.equal(concurrent.status, 'busy');
    assert.equal(completed.status, 'completed');
    assert.equal(retry.status, 'duplicate');
    assert.equal(prepared, 1);
    assert.equal(committed, 1);
  } finally {
    firstStore.close();
    secondStore.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a slow preparation renews its SQLite lease and a superseded owner cannot commit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-runner-heartbeat-'));
  const firstStore = makeStore(root);
  const secondStore = makeStore(root);
  try {
    const first = new AiRunnerTickCoordinator(firstStore, 60);
    const second = new AiRunnerTickCoordinator(secondStore, 60);
    let release;
    let committed = 0;
    const blocked = new Promise(resolve => { release = resolve; });
    const active = first.run('r-slow', 'slow-tick-1', async () => { await blocked; return { action: 'BUY' }; }, value => { committed += 1; return value; }, 'slow-owner');
    await new Promise(resolve => setTimeout(resolve, 90));
    const concurrent = await second.run('r-slow', 'slow-tick-1', async () => ({ action: 'BUY' }), value => { committed += 1; return value; }, 'second-owner');
    assert.equal(concurrent.status, 'busy');
    release();
    const completed = await active;
    assert.equal(completed.status, 'completed');
    assert.equal(committed, 1);
  } finally {
    firstStore.close();
    secondStore.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
