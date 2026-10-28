import express from 'express';
import type { ReportScheduleStore } from '../features/report-schedules';

export function createReportScheduleRouter(store: ReportScheduleStore, deps: {
  adminOnly(req: express.Request, res: express.Response): boolean;
  csrfValid(req: express.Request): boolean;
}) {
  const router = express.Router();
  const fail = (res: express.Response, error: unknown, status = 400) => res.status(status).json({ success: false, dataStatus: 'unavailable', reason: error instanceof Error ? error.message : '报告计划不可用' });
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!deps.adminOnly(req, res)) return;
    if (req.method !== 'GET' && !deps.csrfValid(req)) return fail(res, Error('CSRF 校验失败'), 403);
    next();
  });
  router.get('/', (_req, res) => {
    try {
      const data = store.list();
      res.json({ success: true, dataStatus: data.length ? 'historical' : 'empty', data });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get('/:id', (req, res) => {
    try {
      res.json({ success: true, data: store.get(String(req.params.id)) });
    } catch (error) {
      fail(res, error, 404);
    }
  });
  router.post('/', (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['projectId', 'linkIds', 'cadence', 'timeOfDay', 'requestId'].includes(key))) throw Error('报告计划请求包含未支持字段');
      res.status(201).json({ success: true, data: store.create(body) });
    } catch (error) {
      fail(res, error);
    }
  });
  router.patch('/:id', (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['expectedVersion', 'enabled', 'linkIds', 'cadence', 'timeOfDay'].includes(key))) throw Error('报告计划更新包含未支持字段');
      if (!Number.isSafeInteger(body.expectedVersion)) throw Error('报告计划版本无效');
      const { expectedVersion, ...patch } = body;
      res.json({ success: true, data: store.update(String(req.params.id), expectedVersion, patch) });
    } catch (error) {
      fail(res, error);
    }
  });
  router.delete('/:id', (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).some(key => key !== 'expectedVersion') || !Number.isSafeInteger(req.body.expectedVersion)) throw Error('删除报告计划需要明确版本');
      res.json({ success: true, data: store.remove(String(req.params.id), req.body.expectedVersion) });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/:id/preview', (req, res) => {
    try {
      res.json({ success: true, data: store.preview(String(req.params.id)) });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/run-due', (_req, res) => {
    try {
      res.json({ success: true, data: store.runDue() });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
