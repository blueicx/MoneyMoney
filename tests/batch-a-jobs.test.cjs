const test = require('node:test');
const { strict: assert } = require('node:assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');

test('Batch A: Contracts exist with new fields', () => {
  const contracts = require('../dist/features/research-contracts.js');

  // StrategyDefinition
  assert.throws(() => contracts.createStrategyDefinition({ id: 's1', version: '1' }), /market/i);
  const s = contracts.createStrategyDefinition({ id: 's1', version: '1', market: 'stocks', cycle: '1d', capability: ['trend'], source: 'internal', availability: 'public' });
  assert.equal(s.market, 'stocks');
  assert.equal(s.cycle, '1d');
  assert.deepEqual(s.capability, ['trend']);

  // DataSourceDefinition
  const d = contracts.createDataSourceDefinition({ id: 'd1', name: 'D1', market: 'crypto', cycle: '1h', capability: ['tick'], source: 'binance', availability: 'private' });
  assert.equal(d.market, 'crypto');

  // ArtifactManifest
  assert.throws(() => contracts.createArtifactManifest({ id: 'a1' }), /jobId/i);
  const a = contracts.createArtifactManifest({ id: 'a1', jobId: 'j1', uri: 'file://test' });
  assert.equal(a.id, 'a1');
});

test('Batch A: API Integration and SQLite persistence', async () => {
  const { researchJobsRouter } = require('../dist/features/research-jobs-router.js');
  const { researchRepository, setDbPath } = require('../dist/features/research-repository.js');

  const testDb = path.join(__dirname, '../data/test-research2.db');
  if (setDbPath) setDbPath(testDb);

  const app = express();
  app.use(express.json());
  app.use('/api/research', researchJobsRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/research`;

  try {
    // 1. Create job (market isolation check)
    const res1 = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market: 'stocks', workspace: 'w1', inputSummary: 'test api' })
    });
    assert.equal(res1.status, 201);
    const body1 = await res1.json();
    const jobId = body1.id;
    assert.equal(body1.data.market, 'stocks');

    // Cross market rejection check
    const resCross = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market: 'invalid_market', workspace: 'w1' })
    });
    assert.equal(resCross.status, 400);

    // 2. Get job
    const res2 = await fetch(`${baseUrl}/jobs/${jobId}`);
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.data.id, jobId);

    // 3. Artifacts 404
    const resArt = await fetch(`${baseUrl}/artifacts/${jobId}`);
    assert.equal(resArt.status, 404);

    // 4. Invalid State Transition (Cancel already finished)
    researchRepository.updateJobStatus(jobId, 'running');
    researchRepository.updateJobStatus(jobId, 'failed'); // Force it to failed
    const resCancelFail = await fetch(`${baseUrl}/jobs/${jobId}/cancel`, { method: 'POST' });
    assert.equal(resCancelFail.status, 400); // Job already finished

    // Restart logic (close and reopen DB)
    researchRepository.close();
    if (setDbPath) setDbPath(testDb);

    // 5. Read after restart
    const resRestart = await fetch(`${baseUrl}/jobs/${jobId}`);
    assert.equal(resRestart.status, 200);
    const bodyRestart = await resRestart.json();
    assert.equal(bodyRestart.data.status, 'failed');

    // Create a new job for SSE / Resume
    const resNewJob = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market: 'options', workspace: 'w1' })
    });
    const newJobId = (await resNewJob.json()).id;

    // Resume job
    const resResume = await fetch(`${baseUrl}/jobs/${newJobId}/resume`, { method: 'POST' });
    assert.equal(resResume.status, 200);

    // Cancel running job -> cancelling
    const resCancel = await fetch(`${baseUrl}/jobs/${newJobId}/cancel`, { method: 'POST' });
    assert.equal(resCancel.status, 200);

    // 404 job
    const res404 = await fetch(`${baseUrl}/jobs/invalid_id_123`);
    assert.equal(res404.status, 404);

    // SSE basic check
    const resSSE = await fetch(`${baseUrl}/jobs/${newJobId}/events`);
    assert.equal(resSSE.status, 200);
    const type = resSSE.headers.get('content-type');
    assert.ok(type.includes('text/event-stream'));
    if (resSSE.body && typeof resSSE.body.cancel === 'function') {
      resSSE.body.cancel();
    }
  } finally {
    server.close();
    researchRepository.close();
    try { if (fs.existsSync(testDb)) fs.unlinkSync(testDb); } catch(e){}
    try { if (fs.existsSync(testDb + '-wal')) fs.unlinkSync(testDb + '-wal'); } catch(e){}
    try { if (fs.existsSync(testDb + '-shm')) fs.unlinkSync(testDb + '-shm'); } catch(e){}
  }
});
