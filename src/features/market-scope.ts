import type { InstrumentSearchResult, InstrumentType } from './unified-instruments';

export type MarketScope = 'overview' | 'stocks' | 'options' | 'crypto' | 'prediction' | 'watchlist';

export const MARKET_SCOPES: readonly MarketScope[] = [
  'overview', 'stocks', 'options', 'crypto', 'prediction', 'watchlist',
];

export function marketScopeForInstrumentType(type: InstrumentType): MarketScope {
  return type === 'stock' ? 'stocks' : type === 'option' ? 'options' : type === 'crypto' ? 'crypto' : 'prediction';
}

export function marketScopeForTab(tab: string): MarketScope {
  if (tab === 'stocks') return 'stocks';
  if (tab === 'options') return 'options';
  if (tab === 'binance') return 'crypto';
  if (tab === 'radar') return 'prediction';
  if (tab === 'positions') return 'watchlist';
  return 'overview';
}

export function defaultTabForMarketScope(scope: MarketScope): string {
  return scope === 'stocks' ? 'stocks'
    : scope === 'options' ? 'options'
      : scope === 'crypto' ? 'binance'
        : scope === 'prediction' ? 'radar'
          : scope === 'watchlist' ? 'positions' : 'command';
}

export function filterInstrumentResults<T extends Pick<InstrumentSearchResult, 'type'>>(items: T[], scope: MarketScope): T[] {
  if (scope === 'overview' || scope === 'watchlist') return items;
  const type = scope === 'stocks' ? 'stock' : scope === 'options' ? 'option' : scope === 'crypto' ? 'crypto' : scope === 'prediction' ? 'prediction' : null;
  return type ? items.filter(item => item.type === type) : [];
}
