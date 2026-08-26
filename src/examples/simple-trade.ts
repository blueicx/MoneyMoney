/**
 * ============================================
 * SIMPLE TRADE EXAMPLE
 * ============================================
 *
 * This example shows how to:
 * 1. Connect to Predict.fun API
 * 2. Get list of markets
 * 3. View orderbook
 * 4. Place a limit order
 *
 * Run:
 *   ts-node src/examples/simple-trade.ts
 */

import { Wallet, JsonRpcProvider, parseUnits, formatUnits } from 'ethers';
import { OrderBuilder, ChainId } from '@predictdotfun/sdk';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Your API key (get from Discord)
  API_KEY: 'YOUR_API_KEY',

  // Wallet private key (WITHOUT 0x)
  PRIVATE_KEY: 'YOUR_PRIVATE_KEY',

  // API URL
  API_URL: 'https://api.predict.fun',

  // RPC URL
  RPC_URL: 'https://bsc-dataseed.bnbchain.org/',
};

// ============================================
// HELPERS
// ============================================

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json() as Promise<ApiResponse<T>>;
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log('\n Predict.fun Simple Trade Example\n');

  // 1. Create provider and wallet
  const provider = new JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new Wallet(CONFIG.PRIVATE_KEY, provider);

  console.log(`Wallet: ${wallet.address}`);

  // 2. Initialize OrderBuilder
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, wallet);

  // 3. Authentication
  console.log('\nAuthenticating...');

  // Get message to sign
  const messageRes = await fetchApi<{ message: string }>('/v1/auth/message');
  const message = messageRes.data.message;

  // Sign it
  const signature = await wallet.signMessage(message);

  // Get JWT
  const authRes = await fetchApi<{ token: string }>('/v1/auth', {
    method: 'POST',
    body: JSON.stringify({
      signer: wallet.address,
      message,
      signature,
    }),
  });

  const jwtToken = authRes.data.token;
  console.log('Authenticated!');

  // 4. Get markets list
  console.log('\nFetching markets...');
  const marketsRes = await fetchApi<any[]>('/v1/markets?first=10');
  const markets = marketsRes.data;

  console.log(`Found ${markets.length} markets:\n`);
  markets.slice(0, 5).forEach((m: any) => {
    console.log(`  [${m.id}] ${m.title}`);
  });

  // 5. Select first active market
  const market = markets.find((m: any) => m.status !== 'RESOLVED');
  if (!market) {
    console.log('No active markets found');
    return;
  }

  console.log(`\nSelected market: ${market.title}`);
  console.log(`   Outcomes: ${market.outcomes.map((o: any) => o.name).join(' / ')}`);

  // 6. Get orderbook
  const orderbookRes = await fetchApi<any>(`/v1/markets/${market.id}/orderbook`);
  const orderbook = orderbookRes.data;

  console.log('\nOrderbook:');
  console.log(`   Best Bid: $${orderbook.bids[0]?.[0] || 'N/A'}`);
  console.log(`   Best Ask: $${orderbook.asks[0]?.[0] || 'N/A'}`);

  // 7. Check balance
  const balance = await orderBuilder.balanceOf();
  console.log(`\nBalance: ${formatUnits(balance, 18)} USDT`);

  // 8. Create limit order (example)
  console.log('\nCreating limit order...');

  const outcome = market.outcomes[0]; // YES
  const pricePerShare = 0.40; // $0.40 per share
  const quantity = 10; // 10 shares

  // Calculate amounts
  const { makerAmount, takerAmount, pricePerShare: pps } =
    orderBuilder.getLimitOrderAmounts({
      side: 0, // BUY
      pricePerShareWei: parseUnits(pricePerShare.toString(), 18),
      quantityWei: parseUnits(quantity.toString(), 18),
    });

  // Build order
  const expiresAt = new Date(Date.now() + 3600 * 1000); // +1 hour

  const order = orderBuilder.buildOrder('LIMIT', {
    maker: wallet.address,
    signer: wallet.address,
    side: 0, // BUY
    tokenId: outcome.onChainId,
    makerAmount,
    takerAmount,
    nonce: 0n,
    feeRateBps: market.feeRateBps,
    expiresAt,
  });

  // Typed data for signing
  const typedData = orderBuilder.buildTypedData(order, {
    isNegRisk: market.isNegRisk,
    isYieldBearing: market.isYieldBearing,
  });

  // Sign
  const signedOrder = await orderBuilder.signTypedDataOrder(typedData);
  const hash = orderBuilder.buildTypedDataHash(typedData);

  console.log(`   Side: BUY`);
  console.log(`   Outcome: ${outcome.name}`);
  console.log(`   Price: $${pricePerShare}`);
  console.log(`   Quantity: ${quantity} shares`);
  console.log(`   Total: $${(pricePerShare * quantity).toFixed(2)}`);

  // 9. Submit order
  console.log('\nSubmitting order...');

  const orderRes = await fetchApi<{ code: string }>('/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwtToken}`,
    },
    body: JSON.stringify({
      data: {
        order: { ...signedOrder, hash },
        pricePerShare: pps.toString(),
        strategy: 'LIMIT',
      },
    }),
  });

  if (orderRes.success) {
    console.log(`Order placed! Hash: ${hash}`);
  } else {
    console.log('Failed to place order');
  }

  console.log('\nDone!\n');
}

// Run
main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
