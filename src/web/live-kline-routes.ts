import { Router } from 'express';
import { LiveKlineHub, liveKlineScope } from '../features/live-kline-stream';
export function createLiveKlineRouter(hub: LiveKlineHub) {
  const router = Router(); let clients = 0;
  router.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if ((req as any).user?.role !== 'admin') { res.status(403).json({ success: false, reason: '仅管理员可订阅实时行情' }); return; }
    try { liveKlineScope(String(req.query.market || ''), String(req.query.instrument || ''), String(req.query.interval || '5m')); }
    catch (error) { res.status(400).json({ success: false, reason: (error as Error).message }); return; }
    if (clients >= 32) { res.status(429).json({ success: false, reason: '实时订阅容量已满，请使用快照' }); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders(); res.write('retry: 5000\n\n'); clients++;
    let stop = () => {}, ended = false;
    const started = Date.now();
    const heartbeat = setInterval(() => { if (Date.now() - started > 900000 || !res.write(': heartbeat\n\n')) cleanup(); }, 15000); heartbeat.unref();
    const cleanup = () => { if (ended) return; ended = true; clearInterval(heartbeat); stop(); clients--; res.end(); };
    try {
      stop = hub.subscribe(String(req.query.market), String(req.query.instrument), String(req.query.interval || '5m'), event => {
        if (event.type === 'end') { cleanup(); return; }
        if (!ended && !res.write(`event: ${event.type === 'bar' ? 'kline' : 'state'}\ndata: ${JSON.stringify(event)}\n\n`)) cleanup();
      });
      if (ended) stop();
    } catch { cleanup(); }
    res.on('close', cleanup);
  });
  return router;
}
