import express from 'express';
import { previewPositionSizing } from '../features/position-sizing';
import { buildCorrelationMatrix, renderCorrelationCsv } from '../features/correlation-matrix';
import { buildSignalBoard } from '../features/strategy-signal-board';

/** Pure analysis previews. They never persist results or touch an account. */
export function createAnalysisPreviewRouter(deps: {
  adminOnly(req: express.Request, res: express.Response): boolean;
  csrfValid(req: express.Request): boolean;
  listSignals?(market: string, instrument?: string): unknown[];
}) {
  const router = express.Router();
  const fail = (res: express.Response, error: unknown, status = 400) => res.status(status).json({ success: false, dataStatus: 'unavailable', reason: error instanceof Error ? error.message : '分析预览不可用' });
  const ownedPaths = ['/position-sizing', '/correlation-matrix', '/signals'];
  router.use((req, res, next) => {
    if (!ownedPaths.some(prefix => req.path === prefix || req.path.startsWith(prefix + '/'))) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    if (!deps.adminOnly(req, res)) return;
    if (req.method !== 'GET' && !deps.csrfValid(req)) return fail(res, Error('CSRF 校验失败'), 403);
    next();
  });

  router.post('/position-sizing/preview', (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['stats', 'bankroll', 'currency', 'maxFraction', 'minimumSamples'].includes(key))) throw Error('仓位请求包含未支持字段');
      res.json({ success: true, ...previewPositionSizing(body) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/correlation-matrix/preview', (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['series', 'minSamples', 'format'].includes(key))) throw Error('相关性请求包含未支持字段');
      const matrix = buildCorrelationMatrix({ series: body.series, minSamples: body.minSamples });
      if (body.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=correlation-matrix.csv');
        return res.status(200).send(renderCorrelationCsv(matrix));
      }
      if (body.format !== undefined && body.format !== 'json') throw Error('仅支持 json 或 csv');
      res.json({ success: true, ...matrix });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/signals', (req, res) => {
    try {
      if (!deps.listSignals) throw Error('信号存储未接线');
      const instrument = req.query.instrument === undefined ? undefined : String(req.query.instrument);
      const asOf = req.query.asOf === undefined ? undefined : Date.parse(String(req.query.asOf));
      if (req.query.asOf !== undefined && !Number.isFinite(asOf)) throw Error('信号时点无效');
      const board = buildSignalBoard({ signals: deps.listSignals(String(req.query.market ?? ''), instrument), market: String(req.query.market ?? ''), instrument, asOf });
      res.json({ success: true, ...board });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
