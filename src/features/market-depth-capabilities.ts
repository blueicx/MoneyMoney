import type { MarketScope } from './market-scope';

export type MarketDepthCapability =
  | 'breadth'
  | 'insider'
  | 'institutional'
  | 'analyst'
  | 'fundamentals'
  | 'short-interest'
  | 'option-chain'
  | 'volatility'
  | 'greeks'
  | 'funding-rate'
  | 'open-interest'
  | 'on-chain'
  | 'order-flow'
  | 'prediction-radar'
  | 'event-evidence';

const CAPABILITIES: Record<MarketScope, readonly MarketDepthCapability[]> = {
  stocks: ['breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest'],
  options: ['option-chain', 'volatility', 'greeks'],
  crypto: ['funding-rate', 'open-interest', 'on-chain', 'order-flow'],
  prediction: ['prediction-radar', 'event-evidence'],
  overview: [
    'breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest',
    'option-chain', 'volatility', 'greeks', 'funding-rate', 'open-interest', 'on-chain',
    'order-flow', 'prediction-radar', 'event-evidence',
  ],
  watchlist: [
    'breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest',
    'option-chain', 'volatility', 'greeks', 'funding-rate', 'open-interest', 'on-chain',
    'order-flow', 'prediction-radar', 'event-evidence',
  ],
};

export function marketDepthCapabilities(scope: MarketScope): MarketDepthCapability[] {
  return [...(CAPABILITIES[scope] || [])];
}

export function hasMarketDepthCapability(scope: MarketScope, capability: MarketDepthCapability): boolean {
  return CAPABILITIES[scope]?.includes(capability) ?? false;
}

export function unavailableMarketDepthCapability(
  scope: MarketScope,
  capability: MarketDepthCapability,
  reason: string,
) {
  return { scope, capability, status: 'unavailable' as const, reason: reason || '当前市场数据源暂不可用' };
}
