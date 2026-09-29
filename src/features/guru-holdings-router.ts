import express from 'express';
import type { Request, Response } from 'express';
import type {
  Guru13FReport,
  GuruConsensusSnapshot,
  GuruManagerSnapshot,
  GuruStockHoldersSnapshot,
} from './guru-holdings';

interface GuruHoldingsRouteService {
  listGuruManagers(query?: string): Promise<any[]>;
  getGuruManagerSnapshot(cik: string): GuruManagerSnapshot;
  getGuruManagerHistory(cik: string, limit?: number): GuruManagerSnapshot & {
    reports: Guru13FReport[];
    availableReportCount: number;
    requestedLimit: number;
  };
  getGuruConsensus(reportPeriod?: string, symbol?: string): GuruConsensusSnapshot;
  getGuruStockHolders(symbol: string, ciks?: string[]): Promise<GuruStockHoldersSnapshot>;
  refreshGuruManager(cik: string, force?: boolean): Promise<GuruManagerSnapshot>;
}

type AdminOnly = (req: Request, res: Response) => boolean;
type WatchlistProvider = () => string[];

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

function isValidReportPeriod(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

export function createGuruHoldingsRouter(
  service: GuruHoldingsRouteService,
  adminOnly: AdminOnly,
  listWatchlist: WatchlistProvider = () => [],
) {
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

  router.get('/consensus', (req, res) => {
    if (req.query.reportPeriod != null && typeof req.query.reportPeriod !== 'string') {
      return routeError(res, 400, '报告期参数无效');
    }
    if (req.query.symbol != null && typeof req.query.symbol !== 'string') {
      return routeError(res, 400, '股票代码参数无效');
    }
    const reportPeriod = typeof req.query.reportPeriod === 'string' ? req.query.reportPeriod : undefined;
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() || undefined : undefined;
    if (reportPeriod && !isValidReportPeriod(reportPeriod)) {
      return routeError(res, 400, '报告期必须为有效 YYYY-MM-DD 日期');
    }
    if (symbol && !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return routeError(res, 400, '股票代码无效');
    try {
      return res.json(envelope(service.getGuruConsensus(reportPeriod, symbol), symbol || null));
    } catch (error) {
      return routeError(res, 400, error instanceof Error ? error.message : '机构重合查询失败');
    }
  });

  router.get('/managers/:cik/history', (req, res) => {
    const cik = normalizeCikPath(req.params.cik);
    if (!cik) return routeError(res, 400, 'CIK 必须为 1 至 10 位正整数');
    const rawLimit = req.query.limit == null ? '4' : typeof req.query.limit === 'string' ? req.query.limit : '';
    const limit = Number(rawLimit);
    if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 4) {
      return routeError(res, 400, 'limit 必须为 1 至 4 的整数');
    }
    try {
      return res.json(envelope(service.getGuruManagerHistory(cik, limit), null));
    } catch (error) {
      return routeError(res, 400, error instanceof Error ? error.message : '机构历史查询失败');
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

  router.get('/watchlist/changes', async (req, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const symbols = [...new Set(listWatchlist().flatMap(id => {
        const match = String(id || '').trim().match(/^stock:us:([A-Z][A-Z0-9.-]{0,9})$/i);
        return match ? [match[1].toUpperCase()] : [];
      }))].slice(0, 20);
      if (!symbols.length) {
        return res.json(envelope({
          dataStatus: 'empty', instrument: null, symbols: [],
          reason: '自选中没有可用于 SEC 13F 比较的已识别美股标的。',
          caveats: ['13F 为季度滞后披露，不代表实时持仓。', '只展示逐机构申报变化，不将机构股数相加冒充市场总持仓。'],
        }, null));
      }
      const results = await Promise.all(symbols.map(async symbol => {
        try {
          const snapshot = await service.getGuruStockHolders(symbol);
          return { symbol, ...snapshot };
        } catch (error) {
          return {
            symbol, market: 'stocks' as const, instrument: symbol, dataStatus: 'failed' as const,
            source: ROUTE_SOURCE, updatedAt: null, reason: error instanceof Error ? error.message : '读取 SEC 快照失败',
            evidenceRefs: [], mapping: null, holders: [], caveats: [],
          };
        }
      }));
      const updatedAt = results.map(item => item.updatedAt).filter((value): value is string => typeof value === 'string').sort().at(-1) || null;
      const evidenceRefs = [...new Set(results.flatMap(item => item.evidenceRefs || []))].filter(value => /^https:\/\//i.test(value));
      const hasFailure = results.some(item => item.dataStatus === 'failed' || item.dataStatus === 'unavailable' || item.dataStatus === 'partial');
      const hasRows = results.some(item => item.holders.length > 0);
      const dataStatus = hasFailure && hasRows ? 'partial' : hasFailure ? 'unavailable' : hasRows ? 'delayed' : 'empty';
      return res.json(envelope({
        dataStatus,
        instrument: null,
        source: ROUTE_SOURCE,
        updatedAt,
        reason: hasRows ? '以下仅为各机构最近已保存且可核验的季度披露变化。' : '没有可用的自选股票 13F 变化；可能缺少 SEC 身份映射或本地报告快照。',
        evidenceRefs,
        caveats: ['13F 通常在报告期结束后延迟申报，不代表实时持仓。', '股数只在同一机构、已核验证券身份和相邻可比报告期内比较。', '不汇总不同机构股数作为市场总持仓。'],
        symbols: results.map(result => ({
          symbol: result.symbol,
          market: 'stocks',
          instrument: result.symbol,
          dataStatus: result.dataStatus,
          source: result.source || ROUTE_SOURCE,
          updatedAt: result.updatedAt,
          reason: result.reason,
          mapping: result.mapping,
          evidenceRefs: result.evidenceRefs || [],
          holders: result.holders.map(holder => ({
            managerName: holder.manager.personAssociation || holder.manager.filingName,
            filingName: holder.manager.filingName,
            cik: holder.manager.cik,
            reportPeriod: holder.reportPeriod,
            filedAt: holder.filedAt,
            previousReportPeriod: holder.previousReportPeriod || null,
            previousFiledAt: holder.previousFiledAt || null,
            shares: holder.shares,
            previousShares: holder.previousShares,
            shareDelta: holder.shareDelta,
            change: holder.change,
            sourceUrl: /^https:\/\//i.test(holder.sourceUrl) ? holder.sourceUrl : null,
            previousSourceUrl: /^https:\/\//i.test(String(holder.previousSourceUrl || '')) ? holder.previousSourceUrl : null,
          })),
        })),
      }, null));
    } catch (error) {
      return routeError(res, 500, error instanceof Error ? error.message : '读取自选 13F 变化失败');
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
