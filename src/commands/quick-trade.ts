#!/usr/bin/env ts-node
/**
 * Quick Trade Script
 *
 * Usage:
 *   ts-node quick-trade.ts <market_id> <side> <outcome> <quantity> [price]
 *
 * Examples:
 *   ts-node quick-trade.ts 123 buy yes 10 0.45   # Limit buy 10 YES @ $0.45
 *   ts-node quick-trade.ts 123 sell no 5        # Market sell 5 NO shares
 */

import { formatUnits } from 'ethers';
import { config, validateConfig } from '../config';
import { api } from '../api';
import { tradingEngine } from '../trading';
import { Side } from '../types';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    QUICK TRADE SCRIPT                        ║
╠══════════════════════════════════════════════════════════════╣
║ Usage:                                                       ║
║   npm run trade <market_id> <side> <outcome> <qty> [price]   ║
║                                                              ║
║ Arguments:                                                   ║
║   market_id  - Market ID number                              ║
║   side       - "buy" or "sell"                               ║
║   outcome    - "yes" (0) or "no" (1)                         ║
║   qty        - Number of shares                              ║
║   price      - Price per share (optional, for limit orders)  ║
║                                                              ║
║ Examples:                                                    ║
║   npm run trade 123 buy yes 10 0.45   # Limit order          ║
║   npm run trade 123 sell no 5         # Market order         ║
╚══════════════════════════════════════════════════════════════╝
    `);
    process.exit(1);
  }

  const [marketIdStr, sideStr, outcomeStr, quantityStr, priceStr] = args;

  const marketId = parseInt(marketIdStr);
  const side = sideStr.toLowerCase() === 'buy' ? Side.BUY : Side.SELL;
  const outcomeIndex = outcomeStr.toLowerCase() === 'yes' ? 0 : 1;
  const quantity = parseFloat(quantityStr);
  const price = priceStr ? parseFloat(priceStr) : null;

  // Validate
  validateConfig();

  if (isNaN(marketId) || isNaN(quantity)) {
    console.error('Invalid market ID or quantity');
    process.exit(1);
  }

  if (price !== null && (isNaN(price) || price <= 0 || price >= 1)) {
    console.error('Price must be between 0 and 1');
    process.exit(1);
  }

  console.log('\n🚀 Quick Trade');
  console.log('═'.repeat(50));
  console.log(`Network: ${config.network}`);

  // Initialize
  await tradingEngine.initialize();

  // Get market info
  const marketRes = await api.getMarketById(marketId);
  const market = marketRes.data;

  console.log(`\nMarket: ${market.title}`);
  console.log(`Outcome: ${market.outcomes[outcomeIndex]?.name || 'Unknown'}`);
  console.log(`Side: ${side === Side.BUY ? 'BUY' : 'SELL'}`);
  console.log(`Quantity: ${quantity} shares`);

  if (price) {
    console.log(`Price: $${price} (LIMIT order)`);
    console.log(`Est. Total: $${(quantity * price).toFixed(2)}`);
  } else {
    console.log(`Type: MARKET order`);
  }

  console.log('═'.repeat(50));

  // Execute trade
  let hash: string;

  if (price) {
    hash = await tradingEngine.createLimitOrder({
      market,
      side,
      outcomeIndex,
      pricePerShare: price,
      quantity
    });
  } else {
    hash = await tradingEngine.createMarketOrder({
      market,
      side,
      outcomeIndex,
      quantity
    });
  }

  console.log(`\n✅ Order placed successfully!`);
  console.log(`   Hash: ${hash}`);
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});
