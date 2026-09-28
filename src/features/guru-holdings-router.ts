import express from 'express';
import type { Request, Response } from 'express';
import type { GuruManagerSnapshot, GuruStockHoldersSnapshot } from './guru-holdings';

interface GuruHoldingsRouteService {
  listGuruManagers(query?: string): Promise<any[]>;
  getGuruManagerSnapshot(cik: string): GuruManagerSnapshot;
  getGuruStockHolders(symbol: string, ciks?: string[]): Promise<GuruStockHoldersSnapshot>;
  refreshGuruManager(cik: string, force?: boolean): Promise<GuruManagerSnapshot>;
}

type AdminOnly = (req: Request, res: Response) => boolean;

const ROUTE_SOURCE = 'SEC EDGAR Form 13F';

function envelope(payload: Record<string, any>, instrument?: string | null): Record<string, any> {
  return {
    ...payload,
    market: 'stocks',
    instrument: instrument === undefined ? payload.instrument ?? null : instrument,
    dataStatus: payload.dataStatus || 'unavailable',
    source: payload.source || ROUTE_SOURCE,
    updatedAt: payload.updatedAt || null,
    reason: payload.reason ?? null,
    evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : [],
  };
}

function routeError(res: Response, status: number, reason: string): void {
  res.status(status).json(envelope({ dataStatus: 'failed', reason, source: ROUTE_SOURCE, evidenceRefs: [] }));
}

function normalizeCikPath(value: string): string | null {
  return /^\d{1,10}$/.test(value) && Number(value) > 0 ? value : null;
}

function parseCikSelection(raw: unknown): { ciks?: string[]; error?: string } {
  if (raw == null || raw === '') return {};
  if (typeof raw !== 'string') return { error: 'ciks 必须是逗号分隔的 CIK 列表' };
  const parts = raw.split(',').map(value => value.trim());
  if (parts.length > 20 || parts.some(value => !/^\d{1,10}$/.test(value) || Number(value) <= 0)) {
    return { error: 'CIK 列表无效或超过 20 个' };
  }
  return { ciks: [...new Set(parts)] };
}

export function createGuruHoldingsRouter(service: GuruHoldingsRouteService, adminOnly: AdminOnly) {
  const router = express.Router();

  router.get('/managers', async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (query.length > 80) return routeError(res, 400, '申报机构搜索词最多 80 个字符');
    try {
      const data = await service.listGuruManagers(query);
      const updatedAt = data.map(item => item.updatedAt).filter((value: unknown): value is string => typeof value === 'string')
        .sort().at(-1) || null;
      const evidenceRefs = [...new Set(data.flatMap(item => Array.isArray(item.evidenceRefs) ? item.evidenceRefs : []))];
      return res.json(envelope({
        dataStatus: 'historical',
        source: 'SEC EDGAR CIK registry and saved Form 13F snapshots',
        updatedAt,
        reason: data.length ? null : '没有匹配的申报机构；可以搜索名称或输入十位 CIK。',
        evidenceRefs,
        data,
      }, null));
    } catch (error) {
      return routeError(res, 500, error instanceof Error ? error.message : '读取申报机构目录失败');
    }
  });

  router.get('/managers/:cik', (req, res) => {
    const cik = normalizeCikPath(req.params.cik);
    if (!cik) return routeError(res, 400, 'CIK 必须为 1 至 10 位正整数');
    try {
      return res.json(envelope(service.getGuruManagerSnapshot(cik), null));
    } catch (error) {
      return routeError(res, 400, error instanceof Error ? error.message : 'CIK 查询失败');
    }
  });

  router.get('/symbols/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return routeError(res, 400, '请输入有效的股票代码');
    const selection = parseCikSelection(req.query.ciks);
    if (selection.error) return routeError(res, 400, selection.error);
    try {
      return res.json(envelope(await service.getGuruStockHolders(symbol, selection.ciks), symbol));
    } catch (error) {
      return routeError(res, 400, error instanceof Error ? error.message : '股票持有人查询失败');
    }
  });

  router.post('/managers/:cik/refresh', async (req, res) => {
    const cik = normalizeCikPath(req.params.cik);
    if (!cik) return routeError(res, 400, 'CIK 必须为 1 至 10 位正整数');
    if (!adminOnly(req, res)) return;
    try {
      return res.json(envelope(await service.refreshGuruManager(cik, true), null));
    } catch (error) {
      return routeError(res, 502, error instanceof Error ? error.message : 'SEC 刷新失败');
    }
  });

  return router;
}
