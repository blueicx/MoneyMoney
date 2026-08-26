import { Wallet, JsonRpcProvider, parseUnits, formatUnits, Contract } from 'ethers';
import { OrderBuilder, ChainId } from '@predictdotfun/sdk';
import { config } from './config';
import { api } from './api';
import { Market, Orderbook, Side } from './types';
import { CONTRACTS } from './config';

// Minimal ERC20 ABI for balance check
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

// ============================================
// TRADING ENGINE
// ============================================

export class TradingEngine {
  private signer!: Wallet;
  private orderBuilder: OrderBuilder | null = null;
  private isInitialized = false;

  private _provider: any = null;

  constructor() {
    if (config.privateKey && config.privateKey.startsWith('0x') && config.privateKey.length >= 64) {
      const provider = new JsonRpcProvider(config.rpcUrl);
      this.signer = new Wallet(config.privateKey, provider);
    }
  }

  // ----------------------------------------
  // Initialization
  // ----------------------------------------

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('Initializing trading engine...');

    // Initialize OrderBuilder
    const options = config.predictAccount
      ? { predictAccount: config.predictAccount }
      : undefined;

    this.orderBuilder = await OrderBuilder.make(
      config.chainId,
      this.signer,
      options
    );

    // Authenticate with API
    await this.authenticate();

    this.isInitialized = true;
    console.log('Trading engine initialized!');
  }

  private async authenticate(): Promise<void> {
    console.log('Authenticating...');

    // Get message to sign
    const message = await api.getAuthMessage();

    // Sign the message
    let signature: string;
    if (config.predictAccount && this.orderBuilder) {
      // For Predict Account (smart wallet)
      signature = await this.orderBuilder.signPredictAccountMessage(message);
    } else {
      // For regular EOA
      signature = await this.signer.signMessage(message);
    }

    // Get JWT token
    const signerAddress = config.predictAccount || this.signer.address;
    await api.authenticate(signerAddress, message, signature);

    console.log('Authenticated successfully!');
  }

  // ----------------------------------------
  // Approvals
  // ----------------------------------------

  async setApprovals(retries = 3): Promise<void> {
    if (!this.orderBuilder) throw new Error('Not initialized');

    console.log('Setting approvals for trading contracts...');

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this.orderBuilder.setApprovals();

        if (!result.success) {
          throw new Error('Approval transaction failed');
        }

        console.log('Approvals set successfully!');
        return;
      } catch (error: any) {
        console.error(`Approval attempt ${attempt}/${retries} failed:`, error.message);

        if (attempt === retries) {
          throw new Error(`Failed to set approvals after ${retries} attempts: ${error.message}`);
        }

        // Wait before retry (exponential backoff)
        const delay = 2000 * attempt;
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // ----------------------------------------
  // Balance
  // ----------------------------------------

  async getBalance(): Promise<{ wei: bigint; formatted: string; usdtWei: bigint; usdtFormatted: string }> {
    if (!this.orderBuilder) throw new Error('Not initialized');

    // Get SDK balance (internal predict.fun balance)
    const balanceWei = await this.orderBuilder.balanceOf();

    // Get actual USDT balance from contract
    const usdtAddress = config.network === 'mainnet'
      ? CONTRACTS.mainnet.USDT
      : CONTRACTS.testnet.USDT;
    const usdtContract = new Contract(usdtAddress, ERC20_ABI, this.signer.provider);
    const usdtWei = await usdtContract.balanceOf(this.signer.address);

    return {
      wei: balanceWei,
      formatted: formatUnits(balanceWei, 18),
      usdtWei: usdtWei,
      usdtFormatted: formatUnits(usdtWei, 18)
    };
  }

  // ----------------------------------------
  // Trading
  // ----------------------------------------

  async createLimitOrder(params: {
    market: Market;
    side: Side;
    outcomeIndex: number; // 0 for YES, 1 for NO
    pricePerShare: number; // e.g., 0.45 for 45 cents
    quantity: number; // number of shares
  }): Promise<string> {
    if (!this.orderBuilder) throw new Error('Not initialized');

    const { market, side, outcomeIndex, pricePerShare, quantity } = params;
    const outcome = market.outcomes[outcomeIndex];

    if (!outcome) {
      throw new Error(`Invalid outcome index: ${outcomeIndex}`);
    }

    console.log(`Creating LIMIT order...`);
    console.log(`  Market: ${market.title}`);
    console.log(`  Side: ${side === Side.BUY ? 'BUY' : 'SELL'}`);
    console.log(`  Outcome: ${outcome.name}`);
    console.log(`  Price: $${pricePerShare}`);
    console.log(`  Quantity: ${quantity} shares`);

    // Convert to wei (18 decimals)
    const pricePerShareWei = parseUnits(pricePerShare.toString(), 18);
    const quantityWei = parseUnits(quantity.toString(), 18);

    // Calculate order amounts
    const { makerAmount, takerAmount, pricePerShare: pps } =
      this.orderBuilder.getLimitOrderAmounts({
        side,
        pricePerShareWei,
        quantityWei,
      });

    // Build order
    const signerAddress = config.predictAccount || this.signer.address;
    const expiresAt = new Date(Date.now() + config.orderExpirationSeconds * 1000);

    const order = this.orderBuilder.buildOrder('LIMIT', {
      maker: signerAddress,
      signer: signerAddress,
      side,
      tokenId: outcome.onChainId,
      makerAmount,
      takerAmount,
      nonce: 0n,
      feeRateBps: market.feeRateBps,
      expiresAt,
    });

    // Build typed data for signing
    const typedData = this.orderBuilder.buildTypedData(order, {
      isNegRisk: market.isNegRisk,
      isYieldBearing: market.isYieldBearing,
    });

    // Sign order
    const signedOrder = await this.orderBuilder.signTypedDataOrder(typedData);
    const hash = this.orderBuilder.buildTypedDataHash(typedData);

    // Submit to API
    const orderData = {
      data: {
        order: { ...signedOrder, hash },
        pricePerShare: pps.toString(),
        strategy: 'LIMIT' as const,
      },
    };

    const result = await api.createOrder(orderData);

    if (result.success) {
      console.log(`Order created! Hash: ${hash}`);
      return hash;
    } else {
      throw new Error('Failed to create order');
    }
  }

  async createMarketOrder(params: {
    market: Market;
    side: Side;
    outcomeIndex: number;
    quantity: number;
    slippageBps?: number;
  }): Promise<string> {
    if (!this.orderBuilder) throw new Error('Not initialized');

    const { market, side, outcomeIndex, quantity, slippageBps } = params;
    const outcome = market.outcomes[outcomeIndex];
    const slippage = slippageBps ?? config.defaultSlippageBps;

    if (!outcome) {
      throw new Error(`Invalid outcome index: ${outcomeIndex}`);
    }

    console.log(`Creating MARKET order...`);
    console.log(`  Market: ${market.title}`);
    console.log(`  Side: ${side === Side.BUY ? 'BUY' : 'SELL'}`);
    console.log(`  Outcome: ${outcome.name}`);
    console.log(`  Quantity: ${quantity} shares`);
    console.log(`  Slippage: ${slippage / 100}%`);

    // Fetch current orderbook
    const orderbookRes = await api.getOrderbook(market.id);
    const book = orderbookRes.data;

    // Convert to wei
    const quantityWei = parseUnits(quantity.toString(), 18);

    // Calculate order amounts from orderbook
    const { makerAmount, takerAmount, pricePerShare: pps } =
      this.orderBuilder.getMarketOrderAmounts(
        { side, quantityWei },
        book as unknown as Parameters<typeof this.orderBuilder.getMarketOrderAmounts>[1]
      );

    // Build order
    const signerAddress = config.predictAccount || this.signer.address;
    const expiresAt = new Date(Date.now() + config.orderExpirationSeconds * 1000);

    const order = this.orderBuilder.buildOrder('MARKET', {
      maker: signerAddress,
      signer: signerAddress,
      side,
      tokenId: outcome.onChainId,
      makerAmount,
      takerAmount,
      nonce: 0n,
      feeRateBps: market.feeRateBps,
      expiresAt,
    });

    // Build typed data for signing
    const typedData = this.orderBuilder.buildTypedData(order, {
      isNegRisk: market.isNegRisk,
      isYieldBearing: market.isYieldBearing,
    });

    // Sign order
    const signedOrder = await this.orderBuilder.signTypedDataOrder(typedData);
    const hash = this.orderBuilder.buildTypedDataHash(typedData);

    // Submit to API
    const orderData = {
      data: {
        order: { ...signedOrder, hash },
        pricePerShare: pps.toString(),
        strategy: 'MARKET' as const,
        slippageBps: slippage.toString(),
      },
    };

    const result = await api.createOrder(orderData);

    if (result.success) {
      console.log(`Order created! Hash: ${hash}`);
      return hash;
    } else {
      throw new Error('Failed to create order');
    }
  }

  // ----------------------------------------
  // Order Management
  // ----------------------------------------

  async cancelOrders(orderIds: string[]): Promise<void> {
    console.log(`Cancelling ${orderIds.length} orders...`);

    const result = await api.removeOrders(orderIds);

    console.log(`Cancelled: ${result.removed.length} orders`);
    if (result.noop.length > 0) {
      console.log(`Already cancelled/filled: ${result.noop.length} orders`);
    }
  }

  async cancelAllOpenOrders(): Promise<void> {
    const ordersRes = await api.getOrders('OPEN');
    const openOrders = ordersRes.data;

    if (openOrders.length === 0) {
      console.log('No open orders to cancel');
      return;
    }

    const ids = openOrders.map(o => o.id);
    await this.cancelOrders(ids);
  }

  // ----------------------------------------
  // Position Management
  // ----------------------------------------

  async redeemPositions(params: {
    conditionId: string;
    indexSet: 1 | 2;
    isNegRisk: boolean;
    isYieldBearing: boolean;
    amount?: bigint;
  }): Promise<void> {
    if (!this.orderBuilder) throw new Error('Not initialized');

    console.log('Redeeming positions...');

    const result = await this.orderBuilder.redeemPositions(params);

    if (result.success) {
      console.log('Positions redeemed successfully!');
    } else {
      throw new Error('Failed to redeem positions');
    }
  }

  async mergePositions(params: {
    conditionId: string;
    amount: bigint;
    isNegRisk: boolean;
    isYieldBearing: boolean;
  }): Promise<void> {
    if (!this.orderBuilder) throw new Error('Not initialized');

    console.log('Merging positions...');

    const result = await this.orderBuilder.mergePositions(params);

    if (result.success) {
      console.log('Positions merged successfully!');
    } else {
      throw new Error('Failed to merge positions');
    }
  }

  // ----------------------------------------
  // Helpers
  // ----------------------------------------

  getSignerAddress(): string {
    return config.predictAccount || this.signer.address;
  }

  getWalletInfo(): { eoaAddress: string; predictAccount: string | null; usingPredictAccount: boolean } {
    return {
      eoaAddress: this.signer.address,
      predictAccount: config.predictAccount || null,
      usingPredictAccount: !!config.predictAccount
    };
  }

  /**
   * Calculate the complementary price for NO outcome
   * Price YES + Price NO = 1
   */
  static getNoPrice(yesPrice: number, decimalPrecision: number = 2): number {
    const factor = 10 ** decimalPrecision;
    return (factor - Math.round(yesPrice * factor)) / factor;
  }

  /**
   * Get best prices from orderbook
   */
  static getBestPrices(orderbook: Orderbook): {
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    midPrice: number | null;
  } {
    const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0][0] : null;
    const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0][0] : null;

    let spread: number | null = null;
    let midPrice: number | null = null;

    if (bestBid !== null && bestAsk !== null) {
      spread = bestAsk - bestBid;
      midPrice = (bestBid + bestAsk) / 2;
    }

    return { bestBid, bestAsk, spread, midPrice };
  }
}

// Export singleton instance
export const tradingEngine = new TradingEngine();
