import { MARKET_SCOPES, type MarketScope } from './market-scope';

export type DashboardField =
  | 'market-indices'
  | 'crypto-overview'
  | 'prediction-activity'
  | 'breadth'
  | 'sectors'
  | 'sec-filings'
  | 'option-chain'
  | 'implied-volatility'
  | 'greeks'
  | 'prices'
  | 'funding-rate'
  | 'open-interest'
  | 'on-chain'
  | 'prediction-probability'
  | 'liquidity'
  | 'watchlist-summary'
  | 'current-price'
  | 'events';

export interface MarketDashboardCard {
  id: string;
  title: string;
  source: string;
  fetchedAt: string | null;
  status: 'live' | 'stale' | 'degraded' | 'unavailable';
  fields: DashboardField[];
}

const CARD_MATRIX: Record<MarketScope, readonly Omit<MarketDashboardCard, 'fetchedAt'>[]> = {
  overview: [
    { id: 'overview-markets', title: '跨市场大盘', source: 'MoneyMoney 综合数据', status: 'unavailable', fields: ['market-indices', 'crypto-overview', 'prediction-activity'] },
    { id: 'overview-events', title: '跨市场事件', source: '公开事件源', status: 'unavailable', fields: ['events'] },
  ],
  stocks: [
    { id: 'stock-indices', title: '股票指数', source: 'Nasdaq / Tencent Finance', status: 'unavailable', fields: ['market-indices'] },
    { id: 'stock-breadth', title: '市场宽度', source: 'Nasdaq Public Screener', status: 'unavailable', fields: ['breadth', 'sectors'] },
    { id: 'stock-events', title: '股票事件', source: 'SEC EDGAR / 财报日历', status: 'unavailable', fields: ['sec-filings', 'events'] },
  ],
  options: [
    { id: 'option-chain', title: '期权链', source: 'CBOE / Deribit Public', status: 'unavailable', fields: ['option-chain'] },
    { id: 'option-volatility', title: '波动率与 Greeks', source: '公开期权链', status: 'unavailable', fields: ['implied-volatility', 'greeks'] },
    { id: 'option-events', title: '期权相关事件', source: '公开事件源', status: 'unavailable', fields: ['events'] },
  ],
  crypto: [
    { id: 'crypto-prices', title: '交易所行情', source: 'Binance Public', status: 'unavailable', fields: ['prices'] },
    { id: 'crypto-derivatives', title: '衍生品结构', source: 'Binance Public', status: 'unavailable', fields: ['funding-rate', 'open-interest'] },
    { id: 'crypto-chain', title: '链上与事件', source: 'CoinGecko / DeFiLlama / 公开链上源', status: 'unavailable', fields: ['on-chain', 'events'] },
  ],
  prediction: [
    { id: 'prediction-probability', title: '预测概率', source: 'Predict.fun / Polymarket Public', status: 'unavailable', fields: ['prediction-probability'] },
    { id: 'prediction-liquidity', title: '市场流动性', source: '公开预测市场快照', status: 'unavailable', fields: ['liquidity', 'events'] },
  ],
  watchlist: [
    { id: 'watchlist-summary', title: '自选摘要', source: '本地自选库', status: 'unavailable', fields: ['watchlist-summary', 'current-price'] },
    { id: 'watchlist-events', title: '自选事件', source: '当前市场事件源', status: 'unavailable', fields: ['events'] },
  ],
};

export function resolveMarketDashboardCards(scope: MarketScope): MarketDashboardCard[] {
  const resolvedScope = MARKET_SCOPES.includes(scope) ? scope : 'overview';
  return CARD_MATRIX[resolvedScope].map(card => ({
    ...card,
    fields: [...card.fields],
    fetchedAt: null,
  }));
}
