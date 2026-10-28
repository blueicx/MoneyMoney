import express from 'express';
import { getMethodology, listMethodologies, methodologyCatalogDigest } from '../features/methodology-catalog';
import { buildEvidenceGapMap, renderEvidenceGapCsv } from '../features/evidence-gap-map';
import { buildWorkspaceSearchIndex, searchWorkspaceIndex, type WorkspaceSearchDocument } from '../features/workspace-search';
import { buildAuditTimeline, renderAuditCsv, type RawAuditEntry } from '../features/audit-timeline';
import { buildSourceHealthDashboard, type SourceHealthObservation } from '../features/source-health-dashboard';

/**
 * Read-only insight endpoints: methodology, evidence gaps, cross-project
 * search, unified audit timeline and the long-window source health board.
 * None of these write, call a model or fetch an upstream provider.
 */

export interface InsightDependencies {
  adminOnly(req: express.Request, res: express.Response): boolean;
  gapRows(): unknown[];
  searchDocuments(): WorkspaceSearchDocument[];
  auditEntries(): RawAuditEntry[];
  sourceObservations(): SourceHealthObservation[];
  now?: () => number;
}

export function createInsightRouter(deps: InsightDependencies) {
  const router = express.Router();
  const clock = deps.now ?? Date.now;
  const fail = (res: express.Response, error: unknown, status = 400) => res.status(status).json({ success: false, dataStatus: 'unavailable', reason: error instanceof Error ? error.message : '研究洞察不可用' });
  const privatePaths = ['/evidence-gaps', '/workspace/search', '/audit/timeline', '/source-health/dashboard'];
  router.use((req, res, next) => {
    const isMethodology = req.path === '/methodology' || req.path.startsWith('/methodology/');
    const owned = isMethodology || privatePaths.some(prefix => req.path === prefix || req.path.startsWith(prefix + '/'));
    if (!owned) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    if (isMethodology) return next();
    if (!deps.adminOnly(req, res)) return;
    next();
  });

  router.get('/methodology', (_req, res) => {
    try {
      res.json({ success: true, dataStatus: 'historical', digest: methodologyCatalogDigest(), data: listMethodologies() });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/methodology/:ref', (req, res) => {
    try {
      const entry = getMethodology(String(req.params.ref));
      if (!entry) return fail(res, Error('方法论不存在或版本不受支持'), 404);
      res.json({ success: true, dataStatus: 'historical', data: entry });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/evidence-gaps', (req, res) => {
    try {
      const map = buildEvidenceGapMap(deps.gapRows(), clock());
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=evidence-gaps.csv');
        return res.status(200).send(renderEvidenceGapCsv(map));
      }
      if (req.query.format !== undefined) throw Error('仅支持 json 或 csv');
      res.json({ success: true, ...map });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/workspace/search', (req, res) => {
    try {
      const index = buildWorkspaceSearchIndex(deps.searchDocuments());
      const data = searchWorkspaceIndex(index, String(req.query.q ?? ''), () => true, {
        market: req.query.market === undefined ? undefined : String(req.query.market),
        types: req.query.types === undefined ? undefined : String(req.query.types).split(',').filter(Boolean),
        from: req.query.from === undefined ? undefined : String(req.query.from),
        to: req.query.to === undefined ? undefined : String(req.query.to),
        limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
        now: clock(),
      });
      res.json({ success: true, dataStatus: data.total ? 'historical' : 'empty', ...data });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/audit/timeline', (req, res) => {
    try {
      const timeline = buildAuditTimeline({
        entries: deps.auditEntries(),
        from: req.query.from === undefined ? undefined : String(req.query.from),
        to: req.query.to === undefined ? undefined : String(req.query.to),
        category: req.query.category === undefined ? undefined : String(req.query.category),
        projectId: req.query.projectId === undefined ? undefined : String(req.query.projectId),
        limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
        now: clock(),
      });
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=audit-timeline.csv');
        return res.status(200).send(renderAuditCsv(timeline));
      }
      if (req.query.format !== undefined) throw Error('仅支持 json 或 csv');
      res.json({ success: true, ...timeline });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/source-health/dashboard', (req, res) => {
    try {
      const windowDays = req.query.windowDays === undefined ? 7 : Number(req.query.windowDays);
      if (!Number.isFinite(windowDays) || windowDays <= 0 || windowDays > 30) throw Error('健康窗口必须是 0–30 天');
      const data = buildSourceHealthDashboard({ observations: deps.sourceObservations(), windowMs: windowDays * 86_400_000, now: clock() });
      res.json({ success: true, ...data });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
