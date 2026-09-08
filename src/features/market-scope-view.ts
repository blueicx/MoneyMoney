import { MARKET_SCOPES, type MarketScope } from './market-scope';

const VALID_SCOPES = new Set<string>(MARKET_SCOPES);

export function scopeAllowsSection(declared: string, scope: string): boolean {
  if (!VALID_SCOPES.has(scope)) return false;
  const declaredScopes = String(declared || '').split(/[\s,|]+/).filter(Boolean);
  if (scope === 'overview') return true;
  if (declaredScopes.includes('all')) return true;
  return declaredScopes.includes(scope) || declaredScopes.includes('common');
}

export function scopeQuery(scope: string | undefined): string {
  return scope && VALID_SCOPES.has(scope) ? `scope=${encodeURIComponent(scope)}` : '';
}

export function scopeForInstrument(item: { type?: string; instrumentType?: string; id?: string }): MarketScope | null {
  const type = String(item.type || item.instrumentType || '').toLowerCase();
  if (type === 'stock') return 'stocks';
  if (type === 'crypto') return 'crypto';
  if (type === 'prediction') return 'prediction';
  const id = String(item.id || '').toLowerCase();
  if (id.startsWith('stock:')) return 'stocks';
  if (id.startsWith('crypto:')) return 'crypto';
  if (id.startsWith('prediction:')) return 'prediction';
  return null;
}

export function filterByMarketScope<T extends { type?: string; instrumentType?: string; id?: string }>(items: T[], scope: MarketScope): T[] {
  if (scope === 'overview' || scope === 'watchlist') return [...items];
  return items.filter(item => scopeForInstrument(item) === scope);
}

export function filterUnifiedPaperLedger<T extends {
  startingCash: number;
  cash: number;
  positions: Array<{ instrumentId: string; instrumentType?: string }>;
  orders: Array<{ instrumentId: string; instrumentType?: string; side?: string; price: number; quantity: number; pnlUsd?: number }>;
  realizedPnl: number;
  peakEquity: number;
  maxDrawdownPct: number;
}>(ledger: T, scope: MarketScope): T {
  if (scope === 'overview' || scope === 'watchlist') return ledger;
  const positions = filterByMarketScope(ledger.positions, scope);
  const orders = filterByMarketScope(ledger.orders, scope);
  const cash = orders.reduce((balance, order) => {
    const notional = Number(order.price) * Number(order.quantity);
    return order.side === 'SELL' ? balance + notional : balance - notional;
  }, Number(ledger.startingCash) || 0);
  const realizedPnl = orders.reduce((sum, order) => sum + (Number(order.pnlUsd) || 0), 0);
  return { ...ledger, cash, positions, orders, realizedPnl, peakEquity: Math.max(Number(ledger.startingCash) || 0, cash), maxDrawdownPct: 0 };
}

function actionScope(action: { venue?: string; id?: string }): MarketScope | null {
  const venue = String(action.venue || '').toLowerCase();
  if (venue === 'stocks') return 'stocks';
  if (venue === 'binance') return 'crypto';
  if (venue === 'predict.fun') return 'prediction';
  if (venue === 'options') return 'options';
  if (venue === 'macro') return null;
  return scopeForInstrument({ id: action.id });
}

export function scopeForAction(action: { venue?: string; venueZh?: string; name?: string; id?: string }): MarketScope | null {
  const direct = actionScope(action);
  if (direct) return direct;
  const label = String(action.venueZh || action.name || '').trim().toLowerCase();
  if (['股票', 'stock', 'stocks'].includes(label)) return 'stocks';
  if (['期权', 'option', 'options'].includes(label)) return 'options';
  if (['币安', '加密', 'crypto', 'binance'].includes(label)) return 'crypto';
  if (['预测市场', 'prediction', 'predict.fun'].includes(label)) return 'prediction';
  return null;
}

export function filterAssistantReport<T extends Record<string, any>>(report: T, scope: MarketScope): T {
  if (scope === 'overview' || scope === 'watchlist') return report;
  const rows = (key: string) => {
    const rows = Array.isArray(report[key]) ? report[key] : [];
    return rows;
  };
  return {
    ...report,
    stockActions: scope === 'stocks' ? rows('stockActions') : [],
    cryptoActions: scope === 'crypto' ? rows('cryptoActions') : [],
    predictionPicks: scope === 'prediction' ? rows('predictionPicks') : [],
    optionActions: scope === 'options' ? rows('optionActions') : [],
    sectorActions: scope === 'stocks' ? rows('sectorActions') : [],
    macroActions: [],
    ...(report.context && typeof report.context === 'object'
      ? { context: { ...report.context, crossAssetRisk: undefined, eventRisk: undefined, cautionFlags: [] } }
      : {}),
    journal: report.journal && typeof report.journal === 'object'
      ? { ...report.journal, openTrades: (Array.isArray(report.journal.openTrades) ? report.journal.openTrades : []).filter((item: any) => scopeForAction(item) === scope) }
      : report.journal,
    reminders: (Array.isArray(report.reminders) ? report.reminders : []).filter((item: any) => scopeForAction(item) === scope),
  };
}

function riskScope(item: { venueZh?: string; name?: string; venue?: string; id?: string }): MarketScope | null {
  return scopeForAction(item);
}

export function filterRiskOverview<T extends Record<string, any>>(overview: T, scope: MarketScope): T {
  if (scope === 'overview' || scope === 'watchlist') return overview;
  const groups = Array.isArray(overview.groups) ? overview.groups.filter((item: any) => riskScope(item) === scope) : [];
  const actionSignals = Array.isArray(overview.actionSignals) ? overview.actionSignals.filter((item: any) => riskScope(item) === scope) : [];
  const radarWatchlist = scope === 'prediction' && Array.isArray(overview.radarWatchlist) ? overview.radarWatchlist : [];
  const bullishSignals = actionSignals.filter((item: any) => String(item.directionZh || '').includes('多')).length;
  const bearishSignals = actionSignals.filter((item: any) => String(item.directionZh || '').includes('空')).length;
  const signalBalanceZh = !actionSignals.length ? '暂无明确信号'
    : bullishSignals > bearishSignals * 2 ? '信号明显偏多'
      : bearishSignals > bullishSignals * 2 ? '信号明显偏空' : '多空相对均衡';
  return {
    ...overview,
    groups,
    actionSignals,
    radarWatchlist,
    radarCount: radarWatchlist.length,
    divergenceWatchCount: radarWatchlist.length,
    expiringSoonCount: scope === 'prediction' ? Number(overview.expiringSoonCount || 0) : 0,
    highConvictionCount: actionSignals.filter((item: any) => Number(item.confidencePct || 0) >= 68).length,
    bullishSignals,
    bearishSignals,
    signalBalanceZh,
  };
}

export function filterRiskHistory<T extends { points?: Array<{ scope?: string }> }>(history: T, scope: MarketScope): T {
  if (scope === 'overview' || scope === 'watchlist') return history;
  return { ...history, points: (history.points || []).filter(point => point.scope === scope) };
}
