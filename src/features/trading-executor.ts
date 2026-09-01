import { paperEngine } from './paper-trading';

export interface TradeIntent {
  marketId: number;
  marketTitle: string;
  outcomeIndex: 0 | 1;
  outcomeName: string;
  price: number;
  amountUsd: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface CloseIntent {
  positionId: string;
  exitPrice: number;
  idempotencyKey?: string;
}

export interface TradePreview {
  allowed: boolean;
  mode: 'paper' | 'real-disabled';
  estimatedCostUsd: number;
  message: string;
}

export interface TradeResult {
  success: boolean;
  mode: 'paper' | 'real-disabled';
  message: string;
  positionId?: string;
  pnl?: number;
}

export interface TradingExecutor {
  previewOpen(input: TradeIntent): Promise<TradePreview>;
  open(input: TradeIntent): Promise<TradeResult>;
  close(input: CloseIntent): Promise<TradeResult>;
}

export class PaperTradingExecutor implements TradingExecutor {
  async previewOpen(input: TradeIntent): Promise<TradePreview> {
    const validation = paperEngine.previewOpen(input.marketId, input.price, input.amountUsd);
    return { allowed: validation.ok, mode: 'paper', estimatedCostUsd: input.amountUsd, message: validation.message };
  }

  async open(input: TradeIntent): Promise<TradeResult> {
    const result = paperEngine.openPosition(input.marketId, input.marketTitle, input.outcomeIndex, input.outcomeName, input.price, input.amountUsd, input.reason || 'Manual');
    return { success: result.success, mode: 'paper', message: result.message, positionId: result.position?.id };
  }

  async close(input: CloseIntent): Promise<TradeResult> {
    const result = paperEngine.closePosition(input.positionId, input.exitPrice);
    return { success: result.success, mode: 'paper', message: result.message, pnl: result.pnl };
  }
}

export class RealTradingExecutorDisabled implements TradingExecutor {
  async previewOpen(input: TradeIntent): Promise<TradePreview> {
    return { allowed: false, mode: 'real-disabled', estimatedCostUsd: input.amountUsd, message: '真实交易执行器已禁用；当前仅支持纸面交易' };
  }
  async open(_input: TradeIntent): Promise<TradeResult> {
    return { success: false, mode: 'real-disabled', message: '真实交易执行器已禁用' };
  }
  async close(_input: CloseIntent): Promise<TradeResult> {
    return { success: false, mode: 'real-disabled', message: '真实交易执行器已禁用' };
  }
}

export const paperTradingExecutor = new PaperTradingExecutor();
