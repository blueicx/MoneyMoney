const assert = require('node:assert/strict');
const test = require('node:test');

const { getTelegramCommandHandlers } = require('../dist/web/server.js');
const { researchRepository } = require('../dist/features/research-repository.js');
const { telegramCommandCenterStore } = require('../dist/features/telegram-command-center.js');

const replyText = (reply) => typeof reply === 'string' ? reply : reply.text;

test('telegram tasks lists details and rejects cross-market operations', async () => {
  const handlers = getTelegramCommandHandlers();
  const chatId = `telegram-tasks-${Date.now()}`;
  const jobs = new Map([
    ['job-stocks', { id: 'job-stocks', market: 'stocks', workspace: 'backtest', status: 'queued', progress: 0, inputSummary: 'AAPL 1d' }],
    ['job-options', { id: 'job-options', market: 'options', workspace: 'backtest', status: 'paused', progress: 42, inputSummary: 'SPY options' }]
  ]);
  const original = {
    listJobs: researchRepository.listJobs,
    getJob: researchRepository.getJob,
    updateJobStatus: researchRepository.updateJobStatus,
    getEvents: researchRepository.getEvents,
    getArtifacts: researchRepository.getArtifacts
  };

  researchRepository.listJobs = (market) => [...jobs.values()].filter(job => !market || job.market === market);
  researchRepository.getJob = (id) => jobs.get(id) || null;
  researchRepository.updateJobStatus = (id, status) => {
    const job = jobs.get(id);
    if (!job) throw new Error('Job not found');
    job.status = status;
  };
  researchRepository.getEvents = (id) => [{ id: 1, createdAt: '2026-09-18T00:00:00.000Z', eventType: 'STATUS_UPDATE', payload: { status: jobs.get(id).status } }];
  researchRepository.getArtifacts = () => [{ id: 'artifact-1', hash: 'sha256:test', uri: 'evidence/job-stocks.json' }];

  try {
    telegramCommandCenterStore.setActiveMarketScope(chatId, 'stocks');

    const list = replyText(await handlers.tasks({ chatId, args: [] }));
    assert.match(list, /job-stocks/);
    assert.doesNotMatch(list, /job-options/);

    const details = replyText(await handlers.tasks({ chatId, args: ['job-stocks'] }));
    assert.match(details, /研究任务详情/);
    assert.match(details, /AAPL 1d/);

    const events = replyText(await handlers.tasks({ chatId, args: ['events', 'job-stocks'] }));
    assert.match(events, /STATUS_UPDATE/);

    const artifacts = replyText(await handlers.tasks({ chatId, args: ['artifact', 'job-stocks'] }));
    assert.match(artifacts, /sha256:test/);

    const crossMarket = replyText(await handlers.tasks({ chatId, args: ['job-options'] }));
    assert.match(crossMarket, /拒绝跨市场操作/);
    assert.equal(jobs.get('job-options').status, 'paused');

    const cancelled = replyText(await handlers.tasks({ chatId, args: ['cancel', 'job-stocks'] }));
    assert.match(cancelled, /cancelled/);
    assert.equal(jobs.get('job-stocks').status, 'cancelled');
  } finally {
    researchRepository.listJobs = original.listJobs;
    researchRepository.getJob = original.getJob;
    researchRepository.updateJobStatus = original.updateJobStatus;
    researchRepository.getEvents = original.getEvents;
    researchRepository.getArtifacts = original.getArtifacts;
  }
});

setTimeout(() => process.exit(0), 10);
