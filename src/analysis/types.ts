// ============================================
// ANALYSIS TYPES
// ============================================

export interface MarketSnapshot {
  marketId: number;
  title: string;
  categorySlug: string;
  status: string;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  outcomes: string[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  midPrice: number | null;
  totalLiquidityUsd: number;
  volumeTotalUsd: number;
  volume24hUsd: number;
  bidDepth: number;   // sum of top 10 bid sizes
  askDepth: number;   // sum of top 10 ask sizes
  imbalance: number;  // (bidDepth - askDepth) / (bidDepth + askDepth), range -1 to 1
  timestamp: string;
}

export interface Signal {
  type: 'MOMENTUM' | 'MEAN_REVERSION' | 'IMBALANCE' | 'SPREAD' | 'LIQUIDITY' | 'SENTIMENT';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number; // 0 to 100
  reason: string;
}

export interface Recommendation {
  marketId: number;
  title: string;
  action: 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO' | 'HOLD';
  confidence: number; // 0 to 100
  entryPrice: number | null;
  suggestedSize: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  signals: Signal[];
  summary: string;
}

export interface AnalysisReport {
  timestamp: string;
  totalMarkets: number;
  analyzedMarkets: number;
  recommendations: Recommendation[];
  topOpportunities: Recommendation[];
}

