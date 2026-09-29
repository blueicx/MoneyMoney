import { MARKET_SCOPES, type MarketScope } from './market-scope';
import { normalizeDataStatus, type DataStatus } from './data-status';

export type DashboardField =
  | 'market-indices' | 'crypto-overview' | 'prediction-activity' | 'breadth' | 'sectors'
  | 'sec-filings' | 'option-chain' | 'implied-volatility' | 'greeks' | 'prices'
  | 'funding-rate' | 'open-interest' | 'on-chain' | 'prediction-probability' | 'liquidity'
  | 'watchlist-summary' | 'current-price' | 'events';

export interface DashboardMetric {
  label: string;
  value: string | number;
  unit?: string;
  changePct?: number | null;
}

export interface DashboardProviderResult {
  market?: MarketScope;
  status?: DataStatus | string;
  source?: string | null;
  updatedAt?: string | null;
  fetchedAt?: string | null;
  reason?: string | null;
  metrics?: DashboardMetric[];
  evidenceRefs?: string[];
  data?: unknown;
}

export interface MarketDashboardCard {
  id: string;
  title: string;
  market: MarketScope;
  source: string;
  status: DataStatus;
  fields: DashboardField[];
  workspace: string;
  updatedAt: string | null;
  fetchedAt: string | null;
  reason: string | null;
  metrics: DashboardMetric[];
  evidenceRefs: string[];
  data?: unknown;
  private?: boolean;
}

interface CardDefinition {
  id: string;
  title: string;
  source: string;
  fields: DashboardField[];
  workspace: string;
  private?: boolean;
}

const CARD_MATRIX: Record<MarketScope, readonly CardDefinition[]> = {
  overview: [
    { id: 'overview-markets', title: '跨市场大盘', source: 'MoneyMoney 综合数据', fields: ['market-indices', 'crypto-overview', 'prediction-activity'], workspace: 'overview' },
    { id: 'overview-events', title: '跨市场事件', source: '公开事件源', fields: ['events'], workspace: 'events' },
  ],
  stocks: [
    { id: 'stock-indices', title: '股票指数', source: 'Tencent Finance', fields: ['market-indices'], workspace: 'stock-quotes' },
    { id: 'stock-breadth', title: '市场宽度', source: 'Nasdaq Public Screener', fields: ['breadth', 'sectors'], workspace: 'breadth' },
    { id: 'stock-events', title: '股票事件', source: 'SEC EDGAR / 财报日历', fields: ['sec-filings', 'events'], workspace: 'events' },
    { id: 'stock-guru-watchlist', title: '自选 13F 变化', source: 'SEC EDGAR Form 13F', fields: ['sec-filings', 'watchlist-summary'], workspace: 'guru-holdings', private: true },
  ],
  options: [
    { id: 'option-chain', title: '期权链', source: 'CBOE / Deribit Public', fields: ['option-chain'], workspace: 'option-chain' },
    { id: 'option-volatility', title: '波动率与 Greeks', source: '公开期权链', fields: ['implied-volatility', 'greeks'], workspace: 'volatility' },
    { id: 'option-events', title: '期权相关事件', source: '当前期权标的的事件源', fields: ['events'], workspace: 'events' },
  ],
  crypto: [
    { id: 'crypto-prices', title: '交易所行情', source: 'Binance Public', fields: ['prices'], workspace: 'crypto-quotes' },
    { id: 'crypto-derivatives', title: '衍生品结构', source: '公开永续合约', fields: ['funding-rate', 'open-interest'], workspace: 'funding-rate' },
    { id: 'crypto-chain', title: '链上数据', source: 'Blockchain.com', fields: ['on-chain'], workspace: 'on-chain' },
  ],
  prediction: [
    { id: 'prediction-probability', title: '预测概率', source: 'Predict.fun / 公共缓存', fields: ['prediction-probability'], workspace: 'prediction-radar' },
    { id: 'prediction-liquidity', title: '市场流动性', source: '预测市场快照', fields: ['liquidity'], workspace: 'prediction-radar' },
  ],
  watchlist: [
    { id: 'watchlist-summary', title: '自选摘要', source: '本地自选库', fields: ['watchlist-summary', 'current-price'], workspace: 'watchlist', private: true },
    { id: 'watchlist-events', title: '自选事件', source: '当前市场事件源', fields: ['events'], workspace: 'watchlist', private: true },
  ],
};

function safeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim()).filter(item => /^https?:\/\//i.test(item)))].slice(0, 10);
}

function safeMetrics(value: unknown): DashboardMetric[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const metric = item as Record<string, unknown>;
    const label = String(metric.label || '').trim().slice(0, 60);
    const rawValue = metric.value;
    const safeValue = typeof rawValue === 'string'
      ? rawValue.slice(0, 80)
      : typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : undefined;
    if (!label || safeValue === undefined) return [];
    const changePct = Number(metric.changePct);
    return [{
      label,
      value: safeValue,
      ...(typeof metric.unit === 'string' ? { unit: metric.unit.slice(0, 16) } : {}),
      ...(metric.changePct == null ? {} : { changePct: Number.isFinite(changePct) ? changePct : null }),
    }];
  });
}

export async function collectDashboardResults(
  providers: Record<string, () => Promise<DashboardProviderResult> | DashboardProviderResult>,
): Promise<Record<string, DashboardProviderResult>> {
  const entries = await Promise.all(Object.entries(providers).map(async ([id, provider]) => {
    try {
      return [id, await provider()] as const;
    } catch (error) {
      return [id, { status: 'failed', reason: error instanceof Error ? error.message : '来源请求失败' } satisfies DashboardProviderResult] as const;
    }
  }));
  return Object.fromEntries(entries);
}

export function resolveMarketDashboardCards(
  scope: MarketScope,
  results: Record<string, DashboardProviderResult> = {},
  options: { guest?: boolean } = {},
): MarketDashboardCard[] {
  const resolvedScope = MARKET_SCOPES.includes(scope) ? scope : 'overview';
  return CARD_MATRIX[resolvedScope].map(definition => {
    if (options.guest && definition.private) {
      return {
        ...definition, market: resolvedScope, status: 'unavailable', updatedAt: null, fetchedAt: null,
        reason: '访客只读模式不读取私人自选数据。', metrics: [], evidenceRefs: [],
      };
    }
    const result = results[definition.id];
    const wrongMarket = result?.market && result.market !== resolvedScope;
    return {
      ...definition,
      market: resolvedScope,
      status: wrongMarket ? 'unavailable' : normalizeDataStatus(result?.status),
      source: result?.source || definition.source,
      updatedAt: result?.updatedAt || null,
      fetchedAt: result?.fetchedAt || result?.updatedAt || null,
      reason: wrongMarket ? '数据提供方返回了其他市场的数据，已隔离。' : result?.reason || (!result ? '该卡片当前没有可用的数据快照。' : null),
      metrics: wrongMarket ? [] : safeMetrics(result?.metrics),
      evidenceRefs: wrongMarket ? [] : safeEvidenceRefs(result?.evidenceRefs),
      ...(!wrongMarket && result?.data !== undefined ? { data: result.data } : {}),
    };
  });
}
