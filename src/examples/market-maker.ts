/**
 * ============================================
 * MARKET MAKER EXAMPLE
 * ============================================
 *
 * Simple market making strategy:
 * 1. Get current orderbook
 * 2. Place orders on both sides (bid and ask)
 * 3. Earn from spread
 *
 * WARNING: This is an educational example!
 * Real trading requires:
 * - Risk management
 * - Inventory management
 * - More complex pricing logic
 *
 * Run:
 *   ts-node src/examples/market-maker.ts
 */

import { Wallet, JsonRpcProvider, parseUnits } from 'ethers';
import { OrderBuilder, ChainId } from '@predictdotfun/sdk';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  API_KEY: process.env.API_KEY || 'YOUR_API_KEY',
  PRIVATE_KEY: process.env.PRIVATE_KEY || 'YOUR_PRIVATE_KEY',
  API_URL: 'https://api.predict.fun',
  RPC_URL: 'https://bsc-dataseed.bnbchain.org/',

  // Market maker settings
  MARKET_ID: 1, // Market ID
  SPREAD_BPS: 200, // 2% spread (200 basis points)
  ORDER_SIZE: 10, // 10 shares per side
  REFRESH_INTERVAL_MS: 30000, // Refresh every 30 sec
};

// ============================================
// HELPERS
// ============================================

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

let jwtToken: string | null = null;

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': CONFIG.API_KEY,
  };

  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`;
  }

  const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json() as Promise<ApiResponse<T>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// MARKET MAKER
// ============================================

async function runMarketMaker() {
  console.log('\nPredict.fun Market Maker\n');
  console.log('='.repeat(50));

  // Initialize
  const provider = new JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new Wallet(CONFIG.PRIVATE_KEY, provider);
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Market ID: ${CONFIG.MARKET_ID}`);
  console.log(`Spread: ${CONFIG.SPREAD_BPS / 100}%`);
  console.log(`Order Size: ${CONFIG.ORDER_SIZE} shares`);
  console.log('='.repeat(50));

  // Authentication
  console.log('\nAuthenticating...');
  const messageRes = await fetchApi<{ message: string }>('/v1/auth/message');
  const signature = await wallet.signMessage(messageRes.data.message);

  const authRes = await fetchApi<{ token: string }>('/v1/auth', {
    method: 'POST',
    body: JSON.stringify({
      signer: wallet.address,
      message: messageRes.data.message,
      signature,
    }),
  });

  jwtToken = authRes.data.token;
  console.log('Authenticated!\n');

  // Get market info
  const marketRes = await fetchApi<any>(`/v1/markets/${CONFIG.MARKET_ID}`);
  const market = marketRes.data;

  console.log(`Market: ${market.title}`);
  console.log(`Outcomes: ${market.outcomes.map((o: any) => o.name).join(' / ')}`);
  console.log(`Fee: ${market.feeRateBps / 100}%\n`);

  // Main loop
  while (true) {
    try {
      console.log(`\n[${new Date().toISOString()}] Checking market...`);

      // Cancel old orders
      const ordersRes = await fetchApi<any[]>('/v1/orders?status=OPEN');
      const openOrders = ordersRes.data.filter(
        (o: any) => o.marketId === CONFIG.MARKET_ID
      );

      if (openOrders.length > 0) {
        console.log(`   Cancelling ${openOrders.length} old orders...`);
        await fetchApi<any>('/v1/orders/remove', {
          method: 'POST',
          body: JSON.stringify({
            data: { ids: openOrders.map((o: any) => o.id) },
          }),
        });
      }

      // Get current orderbook
      const orderbookRes = await fetchApi<any>(
        `/v1/markets/${CONFIG.MARKET_ID}/orderbook`
      );
      const orderbook = orderbookRes.data;

      // Calculate mid price
      const bestBid = orderbook.bids[0]?.[0] || 0.5;
      const bestAsk = orderbook.asks[0]?.[0] || 0.5;
      const midPrice = (bestBid + bestAsk) / 2;

      console.log(`   Mid Price: $${midPrice.toFixed(4)}`);

      // Calculate our prices with spread
      const halfSpread = CONFIG.SPREAD_BPS / 20000;
      const ourBidPrice = Math.max(0.01, midPrice - halfSpread);
      const ourAskPrice = Math.min(0.99, midPrice + halfSpread);

      console.log(`   Our Bid: $${ourBidPrice.toFixed(4)}`);
      console.log(`   Our Ask: $${ourAskPrice.toFixed(4)}`);

      // Place BID (buy)
      await placeOrder({
        orderBuilder,
        wallet,
        market,
        side: 0, // BUY
        outcome: market.outcomes[0], // YES
        price: ourBidPrice,
        quantity: CONFIG.ORDER_SIZE,
      });

      // Place ASK (sell)
      await placeOrder({
        orderBuilder,
        wallet,
        market,
        side: 1, // SELL
        outcome: market.outcomes[0], // YES
        price: ourAskPrice,
        quantity: CONFIG.ORDER_SIZE,
      });

      console.log(`   Orders placed!`);

      // Wait before next iteration
      await sleep(CONFIG.REFRESH_INTERVAL_MS);
    } catch (error) {
      console.error(`   Error:`, error);
      await sleep(5000); // Short pause on error
    }
  }
}

async function placeOrder(params: {
  orderBuilder: OrderBuilder;
  wallet: Wallet;
  market: any;
  side: 0 | 1;
  outcome: any;
  price: number;
  quantity: number;
}) {
  const { orderBuilder, wallet, market, side, outcome, price, quantity } =
    params;

  const { makerAmount, takerAmount, pricePerShare } =
    orderBuilder.getLimitOrderAmounts({
      side,
      pricePerShareWei: parseUnits(price.toFixed(6), 18),
      quantityWei: parseUnits(quantity.toString(), 18),
    });

  const order = orderBuilder.buildOrder('LIMIT', {
    maker: wallet.address,
    signer: wallet.address,
    side,
    tokenId: outcome.onChainId,
    makerAmount,
    takerAmount,
    nonce: 0n,
    feeRateBps: market.feeRateBps,
    expiresAt: new Date(Date.now() + 300 * 1000), // 5 minutes
  });

  const typedData = orderBuilder.buildTypedData(order, {
    isNegRisk: market.isNegRisk,
    isYieldBearing: market.isYieldBearing,
  });

  const signedOrder = await orderBuilder.signTypedDataOrder(typedData);
  const hash = orderBuilder.buildTypedDataHash(typedData);

  await fetchApi<any>('/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        order: { ...signedOrder, hash },
        pricePerShare: pricePerShare.toString(),
        strategy: 'LIMIT',
      },
    }),
  });
}

// Run
runMarketMaker().catch(err => {
  console.error('\nFatal Error:', err);
  process.exit(1);
});
