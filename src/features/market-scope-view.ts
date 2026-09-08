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

function actionScope(action: { venue?: string; id?: string }): MarketScope | null {
  const venue = String(action.venue || '').toLowerCase();
  if (venue === 'stocks') return 'stocks';
  if (venue === 'binance') return 'crypto';
  if (venue === 'predict.fun') return 'prediction';
  if (venue === 'options') return 'options';
  if (venue === 'macro') return 'stocks';
  return scopeForInstrument({ id: action.id });
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
    macroActions: scope === 'stocks' ? rows('macroActions') : [],
    reminders: (Array.isArray(report.reminders) ? report.reminders : []).filter((item: any) => actionScope(item) === scope),
  };
}
