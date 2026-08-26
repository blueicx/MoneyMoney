// ============================================
// AUTO TRADER - Automated trading with risk management
// ============================================

import chalk from 'chalk';
import { config } from '../config';
import { tradingEngine } from '../trading';
import { api } from '../api';
import { AnalysisEngine } from './engine';
import { DataCollector } from './collector';
import { Recommendation, AnalysisReport, MarketSnapshot } from './types';
import { Side } from '../types';

export interface AutoTraderConfig {
  enabled: boolean;
  minConfidence: number;       // Minimum confidence to trigger trade (0-100)
  maxPositionUsd: number;      // Max USD per single position
  maxTotalExposureUsd: number; // Max total open exposure
  maxDailyTrades: number;      // Max trades per day
  stopLossPct: number;         // Stop loss percentage (e.g. 0.15 = 15%)
  takeProfitPct: number;       // Take profit percentage (e.g. 0.25 = 25%)
  checkIntervalSec: number;    // How often to scan markets
}

const DEFAULT_CONFIG: AutoTraderConfig = {
  enabled: false,
  minConfidence: 65,
  maxPositionUsd: 50,
  maxTotalExposureUsd: 500,
  maxDailyTrades: 20,
  stopLossPct: 0.15,
  takeProfitPct: 0.25,
  checkIntervalSec: 60,
};

interface TrackedTrade {
  marketId: number;
  action: string;
  entryPrice: number;
  quantity: number;
  timestamp: number;
  orderHash: string;
}

const _PLACEHOLDER = false;

interface TrackedTrade {
  marketId: number;
  action: string;
  entryPrice: number;
  quantity: number;
  timestamp: number;
  orderHash: string;
}

export class AutoTrader {
  private analysisEngine: AnalysisEngine;
  private dataCollector: DataCollector;
  private autoConfig: AutoTraderConfig;
  private trackedTrades: Map<number, TrackedTrade> = new Map();
  private dailyTradeCount: number = 0;
  private dailyResetTime: number = Date.now() + 24 * 60 * 60 * 1000;
  private isRunning: boolean = false;
  private approvalsSet: boolean = false;

  constructor(analysisEngine: AnalysisEngine, dataCollector: DataCollector, autoConfig?: Partial<AutoTraderConfig>) {
    this.analysisEngine = analysisEngine;
    this.dataCollector = dataCollector;
    this.autoConfig = { ...DEFAULT_CONFIG, ...autoConfig };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(partial: Partial<AutoTraderConfig>): void {
    Object.assign(this.autoConfig, partial);
  }

  getConfig(): AutoTraderConfig {
    return { ...this.autoConfig };
  }

  /**
   * Set trading approvals (must be called once before any trade)
   */
  async ensureApprovals(): Promise<void> {
    if (this.approvalsSet) return;
    console.log(chalk.yellow('  Setting trading approvals...'));
    await tradingEngine.setApprovals();
    this.approvalsSet = true;
    console.log(chalk.green('  Approvals set.'));
  }

  /**
   * Start the auto trader loop
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initialize trading engine
    await tradingEngine.initialize();

    // Set approvals
    await this.ensureApprovals();

    console.log(chalk.green.bold('\n  🤖 Auto Trader Started'));
    console.log(chalk.gray(`     Min Confidence: ${this.autoConfig.minConfidence}%`));
    console.log(chalk.gray(`     Max Position: $${this.autoConfig.maxPositionUsd}`));
    console.log(chalk.gray(`     Max Exposure: $${this.autoConfig.maxTotalExposureUsd}`));
    console.log(chalk.gray(`     Check Interval: ${this.autoConfig.checkIntervalSec}s\n`));

    while (this.isRunning) {
      try {
        await this.runCycle();
      } catch (err: any) {
        console.error(chalk.red(`  [AutoTrader] Cycle error: ${err.message}`));
      }

      await new Promise(r => setTimeout(r, this.autoConfig.checkIntervalSec * 1000));
    }
  }

  /**
   * Stop the auto trader
   */
  stop(): void {
    this.isRunning = false;
    console.log(chalk.yellow('\n  Auto Trader stopped.'));
  }

  isAutoTrading(): boolean {
    return this.isRunning;
  }

  getTrackedTrades(): TrackedTrade[] {
    return Array.from(this.trackedTrades.values());
  }

  /**
   * One cycle of the auto trading loop
   */
  private async runCycle(): Promise<void> {
    const now = Date.now();

    // Reset daily counter
    if (now > this.dailyResetTime) {
      this.dailyTradeCount = 0;
      this.dailyResetTime = now + 24 * 60 * 60 * 1000;
    }

    // Check daily limit
    if (this.dailyTradeCount >= this.autoConfig.maxDailyTrades) {
      console.log(chalk.gray(`  [AutoTrader] Daily trade limit reached (${this.autoConfig.maxDailyTrades}). Waiting...`));
      return;
    }

    // Run analysis
    const report = await this.analysisEngine.analyzeAll();

    // Get positions for exposure calc
    let totalExposure = 0;
    try {
      const posRes = await api.getPositions();
      totalExposure = posRes.data.reduce((sum, p) => sum + parseFloat(p.valueUsd), 0);
    } catch {
      // Can't check exposure, skip cycle to be safe
      return;
    }

    // Filter opportunities that meet criteria
    const candidates = report.recommendations.filter(rec =>
      rec.action !== 'HOLD' &&
      rec.confidence >= this.autoConfig.minConfidence &&
      rec.suggestedSize !== null &&
      rec.entryPrice !== null
    );

    if (candidates.length === 0) {
      console.log(chalk.gray('  [AutoTrader] No qualifying opportunities this cycle.'));
      return;
    }

    for (const candidate of candidates) {
      // Skip already tracked market
      if (this.trackedTrades.has(candidate.marketId)) continue;

      // Check exposure limit
      const positionSize = Math.min(
        candidate.suggestedSize || this.autoConfig.maxPositionUsd,
        this.autoConfig.maxPositionUsd,
        Math.max(this.autoConfig.maxTotalExposureUsd - totalExposure, 0)
      );

      if (positionSize < 1) {
        console.log(chalk.gray(`  [AutoTrader] Skipping ${candidate.title} - exposure limit reached`));
        continue;
      }

      // Execute trade
      try {
        await this.executeTrade(candidate, positionSize);
        totalExposure += positionSize;
        this.dailyTradeCount++;
      } catch (err: any) {
        console.error(chalk.red(`  [AutoTrader] Trade failed for "${candidate.title}": ${err.message}`));
      }
    }
  }

  /**
   * Execute a single trade based on recommendation
   */
  private async executeTrade(rec: Recommendation, sizeUsd: number): Promise<void> {
    const side = rec.action === 'BUY_YES' ? 'BUY' : 'SELL';
    const outcomeIndex = rec.action === 'BUY_YES' ? 0 : 1;

    // Fetch market info
    const marketRes = await api.getMarketById(rec.marketId);
    const market = marketRes.data;

    const price = rec.entryPrice!;
    const quantity = Math.floor(sizeUsd / price);

    if (quantity < 1) {
      console.log(chalk.gray(`  [AutoTrader] Quantity < 1 share, skipping.`));
      return;
    }

    console.log(chalk.cyan.bold(`\n  🤖 EXECUTING TRADE`));
    console.log(chalk.white(`     Market: ${rec.title}`));
    console.log(chalk.white(`     Action: ${side} ${outcomeIndex === 0 ? 'YES' : 'NO'}`));
    console.log(chalk.white(`     Price:  $${price.toFixed(3)} × ${quantity} shares = $${(price * quantity).toFixed(2)}`));
    console.log(chalk.white(`     Confidence: ${rec.confidence}%\n`));

    // Place limit order
    const hash = await tradingEngine.createLimitOrder({
      market,
      side: rec.action === 'BUY_YES' ? Side.BUY : Side.SELL,
      outcomeIndex,
      pricePerShare: price,
      quantity
    });

    // Track the trade
    this.trackedTrades.set(rec.marketId, {
      marketId: rec.marketId,
      action: rec.action,
      entryPrice: price,
      quantity,
      timestamp: Date.now(),
      orderHash: hash
    });

    console.log(chalk.green(`  ✅ Order placed! Hash: ${hash.substring(0, 20)}...\n`));
  }

  /**
   * Check open positions for stop loss / take profit triggers
   */
  async manageOpenPositions(): Promise<void> {
    const snapshots = await this.dataCollector.collectAllMarkets();
    const snapMap: Map<number, MarketSnapshot> = new Map(snapshots.map((s: MarketSnapshot) => [s.marketId, s]));

    for (const [marketId, trade] of this.trackedTrades) {
      const snap = snapMap.get(marketId);
      if (!snap || !snap.midPrice) continue;

      const currentPrice = snap.midPrice;
      const pnlPct = (currentPrice - trade.entryPrice) / trade.entryPrice;

      // Stop loss
      if (pnlPct <= -this.autoConfig.stopLossPct) {
        console.log(chalk.red(`  [AutoTrader] STOP LOSS triggered for market #${marketId} @ ${(pnlPct * 100).toFixed(1)}%`));
        await this.closePosition(trade, snap);
      }
      // Take profit
      else if (pnlPct >= this.autoConfig.takeProfitPct) {
        console.log(chalk.green(`  [AutoTrader] TAKE PROFIT triggered for market #${marketId} @ +${(pnlPct * 100).toFixed(1)}%`));
        await this.closePosition(trade, snap);
      }
    }
  }

  /**
   * Close a tracked position by placing opposite order
   */
  private async closePosition(trade: TrackedTrade, snap: MarketSnapshot): Promise<void> {
    try {
      const marketRes = await api.getMarketById(trade.marketId);
      const market = marketRes.data;

      const exitSide = trade.action === 'BUY_YES' ? Side.SELL : Side.BUY;
      const outcomeIndex = trade.action === 'BUY_YES' ? 0 : 1;

      const exitPrice = exitSide === Side.SELL ? snap.bestBid : snap.bestAsk;
      if (!exitPrice) return;

      await tradingEngine.createMarketOrder({
        market,
        side: exitSide,
        outcomeIndex,
        quantity: trade.quantity
      });

      this.trackedTrades.delete(trade.marketId);
      console.log(chalk.green(`  ✅ Position closed for market #${trade.marketId}\n`));
    } catch (err: any) {
      console.error(chalk.red(`  [AutoTrader] Failed to close position: ${err.message}`));
    }
  }
}



