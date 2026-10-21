import type { Request, Response, RequestHandler } from 'express';
import { MARKET_IDS, type MarketId } from '../features/research-contracts';
import type { StrategyCandidateRegistry } from '../features/strategy-candidates';

export function createCandidateHandlers(store: StrategyCandidateRegistry) {
  const market = (value: unknown): MarketId => {
    if (typeof value !== 'string' || !MARKET_IDS.includes(value as MarketId)) throw new Error('需要明确有效的市场上下文');
    return value as MarketId;
  };
  const fields = (req: Request, keys: string[]) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some(key => !keys.includes(key))) throw new Error('候选参数无效，不接受客户端证明或审批结论');
  };
  const scoped = (req: Request) => {
    const row = store.get(String(req.params.id));
    if (row.market !== market(req.method === 'GET' ? req.query.market : req.body?.market)) throw new Error('候选市场上下文不匹配');
    return row;
  };
  const respond = (res: Response, data: any, m: string, instrument: string | null, status = 200) =>
    res.status(status).json({ success: true, data, market: m, instrument, dataStatus: 'historical',
      source: '私人策略证据目录', updatedAt: data?.updatedAt ? new Date(data.updatedAt).toISOString() : null,
      reason: data?.gate?.passed === false ? data.gate.reasons.join('；') : null,
      evidenceRefs: data?.evidenceRef?.observationId ? [data.evidenceRef.observationId] : [] });
  const guard = (fn: (req: Request, res: Response) => unknown, errorStatus = 400): RequestHandler => (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if ((req as any).user?.role !== 'admin') { res.status(403).json({ success: false, dataStatus: 'unavailable', reason: '候选策略仅限管理员' }); return; }
    try { fn(req, res); } catch (error) {
      const reason = error instanceof Error ? error.message : '候选处理失败';
      res.status(errorStatus).json({ success: false, dataStatus: 'failed', reason, error: reason });
    }
  };
  return {
    list: guard((req, res) => {
      const m = req.query.market === undefined ? undefined : market(req.query.market);
      respond(res, store.list(m), m || 'all', null);
    }),
    create: guard((req, res) => {
      fields(req, ['id', 'market', 'instrument', 'version', 'metrics', 'evidenceRef']);
      const b = req.body, m = market(b.market);
      const row = store.saveDraft({ id: b.id, market: m, instrument: b.instrument, version: b.version, metrics: b.metrics || {}, evidenceRef: b.evidenceRef });
      respond(res, row, row.market, row.instrument || null, 201);
    }),
    evaluate: guard((req, res) => {
      fields(req, ['market', 'minTrades', 'minOutOfSampleReturnPct']); const row = scoped(req);
      const data = store.evaluate(row.id, { minTrades: req.body.minTrades, minOutOfSampleReturnPct: req.body.minOutOfSampleReturnPct });
      respond(res, data, row.market, row.instrument || null);
    }),
    proof: guard((req, res) => {
      if (Object.keys(req.query).some(key => key !== 'market')) throw new Error('证据读取不接受客户端指标');
      const row = scoped(req); respond(res, store.proof(row.id), row.market, row.instrument || null);
    }),
    approve: guard((req, res) => {
      fields(req, ['market']); const row = scoped(req); respond(res, store.approve(row.id), row.market, row.instrument || null);
    }, 409),
    reject: guard((req, res) => {
      fields(req, ['market']); const row = scoped(req); respond(res, store.reject(row.id), row.market, row.instrument || null);
    }),
    retire: guard((req, res) => {
      fields(req, ['market', 'reason']); const row = scoped(req); respond(res, store.retire(row.id, req.body.reason), row.market, row.instrument || null);
    }),
  };
}
