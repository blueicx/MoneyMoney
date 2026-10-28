import express from 'express';
import { checkResearchTemplate, getResearchTemplate, listResearchTemplates, researchTemplateCatalogDigest } from '../features/research-templates';

export function createResearchTemplateRouter(deps: {
  adminOnly(req: express.Request, res: express.Response): boolean;
  csrfValid(req: express.Request): boolean;
}) {
  const router = express.Router();
  const fail = (res: express.Response, error: unknown, status = 400) => res.status(status).json({ success: false, dataStatus: 'unavailable', reason: error instanceof Error ? error.message : '研究模板不可用' });
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!deps.adminOnly(req, res)) return;
    if (req.method !== 'GET' && !deps.csrfValid(req)) return fail(res, Error('CSRF 校验失败'), 403);
    next();
  });
  router.get('/', (req, res) => {
    try {
      const market = req.query.market === undefined ? undefined : String(req.query.market);
      res.json({ success: true, dataStatus: 'historical', digest: researchTemplateCatalogDigest(), data: listResearchTemplates(market) });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get('/:ref', (req, res) => {
    try {
      const template = getResearchTemplate(String(req.params.ref));
      if (!template) return fail(res, Error('研究模板不存在'), 404);
      res.json({ success: true, dataStatus: 'historical', data: template });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/:ref/checklist', (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'completed') || !Array.isArray(body.completed)) throw Error('检查清单请求只接受 completed 数组');
      res.json({ success: true, ...checkResearchTemplate(String(req.params.ref), body.completed) });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
