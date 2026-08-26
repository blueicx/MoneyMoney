// ============================================
// TYPE DEFINITIONS
// ============================================

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  cursor?: string | null;
}

// Market types
export interface Market {
  id: number;
  imageUrl: string;
  title: string;
  question: string;
  description: string;
  status: MarketStatus;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  feeRateBps: number;
  resolution: Outcome | null;
  oracleQuestionId: string;
  conditionId: string;
  resolverAddress: string;
  outcomes: Outcome[];
  questionIndex: number | null;
  spreadThreshold: number;
  shareThreshold: number;
  categorySlug: string;
  createdAt: string;
  decimalPrecision: 2 | 3;
  variantData?: {
    endPrice?: number | null;
    priceFeedSymbol?: string;
    startPrice?: number;
    type?: string;
  };
}

export interface Outcome {
  name: string;
  indexSet: number;
  onChainId: string;
  status: 'WON' | 'LOST' | null;
}

export type MarketStatus =
  | 'REGISTERED'
  | 'PRICE_PROPOSED'
  | 'PRICE_DISPUTED'
  | 'PAUSED'
  | 'UNPAUSED'
  | 'RESOLVED';

// Orderbook types
export interface Orderbook {
  marketId: number;
  updateTimestampMs: number;
  asks: [number, number][]; // [price, quantity]
  bids: [number, number][]; // [price, quantity]
}

// Order types
export interface Order {
  hash: string;
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: 0 | 1; // 0 = BUY, 1 = SELL
  signatureType: number;
  signature: string;
}

export interface OrderInfo {
  order: Order;
  id: string;
  marketId: number;
  currency: string;
  amount: string;
  amountFilled: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  strategy: 'LIMIT' | 'MARKET';
  status: OrderStatus;
  rewardEarningRate: number;
}

export type OrderStatus =
  | 'OPEN'
  | 'FILLED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'INVALIDATED';

// Position types
export interface Position {
  id: string;
  market: Market;
  outcome: Outcome;
  amount: string;
  valueUsd: string;
}

// Market statistics
export interface MarketStats {
  totalLiquidityUsd: number;
  volumeTotalUsd: number;
  volume24hUsd: number;
}

// Category types
export interface Category {
  id: number;
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  marketVariant: 'DEFAULT' | 'SPORTS_MATCH' | 'CRYPTO_UP_DOWN';
  createdAt: string;
  startsAt: string;
  endsAt?: string;
  publishedAt?: string;
  isVisible?: boolean;
  shortTitle?: string;
  status: 'OPEN' | 'RESOLVED';
  markets: Market[];
  tags: { id: string; name: string }[];
  variantData?: {
    endPrice?: number | null;
    priceFeedSymbol?: string;
    startPrice?: number;
    type?: string;
  };
}

// Trading side enum
export enum Side {
  BUY = 0,
  SELL = 1
}

// Create order request
export interface CreateOrderRequest {
  data: {
    pricePerShare: string;
    strategy: 'LIMIT' | 'MARKET';
    slippageBps?: string;
    order: {
      hash: string;
      salt: string;
      maker: string;
      signer: string;
      taker: string;
      tokenId: string;
      makerAmount: string;
      takerAmount: string;
      expiration: string | number;
      nonce: string;
      feeRateBps: string;
      side: 0 | 1;
      signatureType: number;
      signature: string;
    };
  };
}
