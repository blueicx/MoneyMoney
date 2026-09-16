import express from 'express';
import { researchRepository } from './research-repository';
import { assertMarketContext, createResearchJob, JobStatus, MARKET_IDS, MarketId } from './research-contracts';

export const researchJobsRouter = express.Router();

import { runResearchExperiment, generateExperimentArtifacts } from './experiment-runner';
import { unifiedInstrumentService } from './unified-instruments';

researchJobsRouter.post('/jobs', express.json(), (req, res) => {
  try {
    const requestedInstrument = String(req.body?.instrument || '').trim();
    if (!requestedInstrument || requestedInstrument === 'UNKNOWN') {
        return res.status(400).json({ success: false, error: 'Missing or invalid instrument' });
    }
    const job = createResearchJob(req.body);
    assertMarketContext({ market: job.market, workspace: job.workspace, instrument: requestedInstrument });
    researchRepository.saveJob(job);
    res.status(201).json({ success: true, data: job, id: job.id });
    // Simulate background execution
    setTimeout(async () => {
       try {
           try { researchRepository.updateJobStatus(job.id, 'running'); } catch (e) { return; }

           const reqInstrument = String(req.body.instrument || '').trim();
           if (!reqInstrument || reqInstrument === 'UNKNOWN') {
               researchRepository.addEvent(job.id, 'ERROR', { reason: 'Missing or invalid instrument' });
               researchRepository.updateJobStatus(job.id, 'failed', 0, 'Missing or invalid instrument');
               return;
           }
           const reqTimeframe = String(req.body.timeframe || '1d');

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

           const prices = overview.klines.map((k: any) => Number(k.close));
           const signals: Array<{ timeIndex: number, direction: 'buy' | 'sell' }> = [];
           for (let i = 1; i < prices.length; i++) {
               if (prices[i] > prices[i-1] * 1.02) signals.push({ timeIndex: i, direction: 'buy' });
               else if (prices[i] < prices[i-1] * 0.98) signals.push({ timeIndex: i, direction: 'sell' });
           }

           const result = runResearchExperiment({
               context: {
                   market: job.market,
                   instrument: reqInstrument,
                   timeframe: reqTimeframe,
                   workspace: job.workspace,
                   dataSource: overview.sourceStatus?.source || 'unified'
               },
               prices,
               signals
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
           try { researchRepository.updateJobStatus(job.id, 'succeeded', 100); } catch(e) {}
       } catch (err: any) {
           try {
               researchRepository.addEvent(job.id, 'ERROR', { reason: err.message || 'Execution failed' });
               researchRepository.updateJobStatus(job.id, 'failed', 0, err.message);
           } catch (ignore) {}
       }
    }, 1000);
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
    res.write(':\\n\\n'); // Heartbeat

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
