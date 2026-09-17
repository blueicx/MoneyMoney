import express from 'express';
import { researchRepository } from './research-repository';
import { assertMarketContext, createResearchJob, JobStatus, MARKET_IDS, MarketId, ResearchJob } from './research-contracts';
import { runResearchExperiment, generateExperimentArtifacts } from './experiment-runner';
import { unifiedInstrumentService } from './unified-instruments';
import { stateStore } from '../storage/sqlite-state';

import { globalStrategyRegistry } from './strategy-registry';

export const researchJobsRouter = express.Router();

let runnerInterval: NodeJS.Timeout | null = null;
const activeJobs = new Set<string>();

async function processJob(job: ResearchJob) {
    if (activeJobs.has(job.id)) return;

    // Check lock via stateStore
    const lockKey = `job_lock_${job.id}`;
    const owner = process.pid.toString() + '_' + Date.now();
    const now = Date.now();
    const leaseTimeMs = 30000;

    const existingLock = stateStore.get<{owner: string, expiresAt: number}>(lockKey);
    if (existingLock && existingLock.expiresAt && now < existingLock.expiresAt) {
        return;
    }

    activeJobs.add(job.id);
    stateStore.set(lockKey, { owner, expiresAt: now + leaseTimeMs, lockedAt: new Date().toISOString() });

    const heartbeat = setInterval(() => {
        const lock = stateStore.get<{owner: string, expiresAt: number}>(lockKey);
        if (lock && lock.owner === owner) {
             stateStore.set(lockKey, { ...lock, expiresAt: Date.now() + leaseTimeMs });
        }
    }, 10000);
    heartbeat.unref();

    try {
        // Re-check status before running in case it was cancelled while waiting
        const currentJob = researchRepository.getJob(job.id);
        if (currentJob && currentJob.status === 'cancelling') {
            researchRepository.updateJobStatus(job.id, 'cancelled');
            return;
        }

        researchRepository.updateJobStatus(job.id, 'running');

        let jobInput: any = {};
        try {
            jobInput = JSON.parse(job.inputSummary || '{}');
        } catch (e) {
            jobInput = { instrument: job.inputSummary };
        }

        const reqInstrument = String(jobInput.instrument || '').trim();
        if (!reqInstrument) {
            researchRepository.addEvent(job.id, 'ERROR', { reason: 'Missing or invalid instrument' });
            researchRepository.updateJobStatus(job.id, 'failed', 0, 'Missing or invalid instrument');
            return;
        }

        const reqTimeframe = String(jobInput.timeframe || '1d').trim();
        const reqStrategy = String(jobInput.strategy || 'default').trim();

        const instrumentRef = {
            id: reqInstrument,
            symbol: reqInstrument.split(':').pop() || reqInstrument,
            type: job.market === 'stocks' ? 'stock' : job.market === 'options' ? 'option' : job.market as any,
            venue: 'us',
            title: '',
            aliases: [],
            marketId: job.market
        };

        const overview = await unifiedInstrumentService.overview(instrumentRef).catch((err) => {
            researchRepository.addEvent(job.id, 'ERROR', { reason: `Source unavailable: ${err.message}` });
            return null;
        });

        if (!overview) {
            researchRepository.updateJobStatus(job.id, 'failed', 0, 'Unavailable data');
            return;
        }

        const expectedType = job.market === 'stocks' ? 'stock' : job.market === 'options' ? 'option' : job.market;
        if (overview.instrument.type !== expectedType && overview.instrument.type !== job.market) {
            researchRepository.addEvent(job.id, 'ERROR', { reason: 'Instrument does not belong to the requested market' });
            researchRepository.updateJobStatus(job.id, 'failed', 0, 'Market mismatch');
            return;
        }

        if (!overview.klines || overview.klines.length < 2) {
            researchRepository.addEvent(job.id, 'ERROR', { reason: 'Insufficient or unavailable data for instrument' });
            researchRepository.updateJobStatus(job.id, 'failed', 0, 'Unavailable data');
            return;
        }

        const strategyDef = globalStrategyRegistry.get(reqStrategy);
        if (!strategyDef) {
            researchRepository.addEvent(job.id, 'ERROR', { reason: `Strategy unavailable: ${reqStrategy}` });
            researchRepository.updateJobStatus(job.id, 'failed', 0, `Strategy unavailable: ${reqStrategy}`);
            return;
        }

        const prices = overview.klines.map((k: any) => Number(k.close));
        const times = overview.klines.map((k: any) => Number(k.timestamp || 0));
        let signals: Array<{ timeIndex: number, direction: 'buy' | 'sell' | 'neutral' }> = [];

        try {
            const points = strategyDef.analyze({
                marketId: job.market,
                timeframe: reqTimeframe,
                prices,
                times,
                volumes: overview.klines.map((k: any) => Number(k.volume || 0))
            });
            signals = points.map(p => ({
                timeIndex: p.index ?? prices.length - 1,
                direction: p.direction
            }));
        } catch (err: any) {
            researchRepository.addEvent(job.id, 'ERROR', { reason: `Strategy evaluation failed: ${err.message}` });
            researchRepository.updateJobStatus(job.id, 'failed', 0, err.message);
            return;
        }

        const result = runResearchExperiment({
            context: {
                market: job.market,
                instrument: reqInstrument,
                timeframe: reqTimeframe,
                workspace: job.workspace,
                dataSource: overview.sourceStatus?.source || 'unified',
                dataStatus: (overview.sourceStatus?.status === 'ok' ? 'live' : overview.sourceStatus?.status === 'stale' ? 'delayed' : 'unavailable')
            },
            prices,
            signals: signals as any
        });

        if (!result.gate.passed) {
            researchRepository.addEvent(job.id, 'INFO', { message: `Promotion gate failed: ${result.gate.reasons.join(', ')}` });
        }

        const artifacts = generateExperimentArtifacts(job.id, result);
        artifacts.manifests.forEach(m => {
            researchRepository.saveArtifact(m);
            researchRepository.saveEvidenceBundle({
                id: m.id, context: { market: job.market, workspace: job.workspace, instrument: reqInstrument, timeframe: reqTimeframe }, artifacts: [m.uri], createdAt: m.createdAt
            });
        });

        researchRepository.updateJobStatus(job.id, 'succeeded', 100);
    } catch (err: any) {
        researchRepository.addEvent(job.id, 'ERROR', { reason: err.message || 'Execution failed' });
        researchRepository.updateJobStatus(job.id, 'failed', 0, err.message);
    } finally {
        clearInterval(heartbeat);
        activeJobs.delete(job.id);
        const lock = stateStore.get<{owner: string}>(lockKey);
        if (lock && lock.owner === owner) {
             stateStore.set(lockKey, { owner: '', expiresAt: 0 });
        }
    }
}

function startBackgroundRunner() {
    if (runnerInterval) return;
    runnerInterval = setInterval(() => {
        const jobs = researchRepository.listJobs();
        const queuedJobs = jobs.filter(j => j.status === 'queued' || j.status === 'running' || j.status === 'cancelling');
        for (const job of queuedJobs) {
            if ((job.status === 'running' || job.status === 'cancelling') && !activeJobs.has(job.id)) {
                // Recover stuck jobs
                processJob(job).catch(console.error);
            } else if (job.status === 'queued') {
                processJob(job).catch(console.error);
            }
        }
    }, 5000);
    runnerInterval.unref();
}

// Start runner
startBackgroundRunner();

researchJobsRouter.post('/jobs', express.json(), (req, res) => {
  try {
    const job = createResearchJob(req.body);
    const reqInstrument = String(req.body?.instrument || '').trim();
    if (reqInstrument) {
      assertMarketContext({ market: job.market, workspace: job.workspace, instrument: reqInstrument });
      job.inputSummary = JSON.stringify({
          instrument: reqInstrument,
          timeframe: req.body?.timeframe || '1d',
          strategy: req.body?.strategy || 'default',
          dataSource: req.body?.dataSource || 'unified'
      });
    }

    // Idempotency key from header
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (idempotencyKey) {
       const existing = stateStore.getIdempotent(`job_idem_${idempotencyKey}`);
       if (existing) {
           return res.status(200).json({ success: true, data: existing, id: (existing as any).id, cached: true });
       }
    }

    researchRepository.saveJob(job);

    if (idempotencyKey) {
        stateStore.setIdempotent(`job_idem_${idempotencyKey}`, job);
    }

    res.status(201).json({ success: true, data: job, id: job.id });

    // Background execution will pick this up
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

researchJobsRouter.get('/jobs', (req, res) => {
  const requestedMarket = typeof req.query.market === 'string' ? req.query.market : undefined;
  if (requestedMarket && !MARKET_IDS.includes(requestedMarket as MarketId)) {
    return res.status(400).json({ success: false, error: 'Invalid market context' });
  }
  res.status(200).json({ success: true, data: researchRepository.listJobs(requestedMarket as MarketId | undefined) });
});

researchJobsRouter.get('/jobs/:id', (req, res) => {
  const job = researchRepository.getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  res.json({ success: true, data: job });
});

researchJobsRouter.get('/jobs/:id/events', (req, res) => {
  const job = researchRepository.getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const lastEventId = Number(req.headers['last-event-id']) || Number(req.query.lastEventId) || 0;
  let currentLastId = lastEventId;

  const sendEvents = () => {
    const events = researchRepository.getEvents(req.params.id, currentLastId);
    events.forEach((ev: any) => {
      res.write(`id: ${ev.id}\n`);
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
      currentLastId = ev.id;
    });
  };

  sendEvents();

  const interval = setInterval(() => {
    sendEvents();
    res.write(':\n\n'); // Heartbeat

    const currentJob = researchRepository.getJob(req.params.id);
    if (!currentJob || ['succeeded', 'failed', 'cancelled'].includes(currentJob.status)) {
      clearInterval(interval);
      res.write(`event: end\ndata: {}\n\n`);
      res.end();
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

researchJobsRouter.post('/jobs/:id/cancel', (req, res) => {
  try {
    const job = researchRepository.getJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ success: false, error: 'Job already finished' });
    }
    const newStatus: JobStatus = job.status === 'queued' ? 'cancelled' : 'cancelling';
    researchRepository.updateJobStatus(req.params.id, newStatus);
    res.json({ success: true, data: researchRepository.getJob(req.params.id) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

researchJobsRouter.post('/jobs/:id/resume', (req, res) => {
  try {
    const job = researchRepository.getJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    if (job.status !== 'running') {
      researchRepository.updateJobStatus(req.params.id, 'running');
    }
    res.json({ success: true, data: researchRepository.getJob(req.params.id) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

researchJobsRouter.get('/artifacts/:id', (req, res) => {
  const artifacts = researchRepository.getArtifacts(req.params.id);
  if (!artifacts.length) return res.status(404).json({ success: false, error: 'No artifacts found for this job' });
  res.json({ success: true, data: artifacts });
});
