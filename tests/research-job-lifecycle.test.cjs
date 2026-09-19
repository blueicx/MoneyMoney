const test = require('node:test');
const { strict: assert } = require('node:assert');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

test('research jobs expose safe pause/resume lifecycle', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/research-jobs-router.ts'), 'utf8');
  assert.match(source, /jobs\/:id\/pause/);

  const { researchJobsRouter } = require('../dist/features/research-jobs-router.js');
  const { researchRepository, setDbPath } = require('../dist/features/research-repository.js');
  const testDb = path.join(__dirname, '../data/test-research-lifecycle.db');
  setDbPath(testDb);

  const app = express();
  app.use(express.json());
  app.use('/api/research', researchJobsRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}/api/research`;

  try {
    const created = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ market: 'stocks', workspace: 'lifecycle-test' })
    });
    const createdBody = await created.json();
    const jobId = createdBody.id;
    researchRepository.updateJobStatus(jobId, 'running');

    const paused = await fetch(`${baseUrl}/jobs/${jobId}/pause`, { method: 'POST' });
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).data.status, 'paused');

    const resumed = await fetch(`${baseUrl}/jobs/${jobId}/resume`, { method: 'POST' });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).data.status, 'running');

    researchRepository.updateJobStatus(jobId, 'failed', 0, 'test failure');
    const terminalResume = await fetch(`${baseUrl}/jobs/${jobId}/resume`, { method: 'POST' });
    assert.equal(terminalResume.status, 400);
    assert.match((await terminalResume.json()).error, /already finished|cannot resume/i);
  } finally {
    server.close();
    researchRepository.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { if (fs.existsSync(testDb + suffix)) fs.unlinkSync(testDb + suffix); } catch {}
    }
  }
});
