export interface StrategyContext {
  marketId: string;
  timeframe: string;
  prices: number[];
  volumes?: number[];
  highs?: number[];
  lows?: number[];
}

export interface StrategyPoint {
  price: number;
  time: number;
  direction: 'buy' | 'sell' | 'neutral';
  pattern?: string;
  explanation?: string;
}

export interface SignalEvent {
  strategyId: string;
  marketId: string;
  direction: 'buy' | 'sell';
  confidence: number;
  timestamp: number;
}

export class StrategyRegistry {
  private strategies = new Map<string, any>();

  register(id: string, strategy: any) {
    this.strategies.set(id, strategy);
  }

  get(id: string) {
    return this.strategies.get(id);
  }

  evaluatePoints(strategyId: string, context: StrategyContext): StrategyPoint[] {
    const strategy = this.get(strategyId);
    if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);
    return strategy.analyze(context) || [];
  }
}

export const globalStrategyRegistry = new StrategyRegistry();

// Chan analysis foundation
export class ChanAnalysis {
  static analyzeBi(highs: number[], lows: number[]): any[] {
    const strokes: any[] = [];
    if (highs.length < 3) return strokes;
    for (let i = 1; i < highs.length - 1; i++) {
       if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) {
           strokes.push({ type: 'top', index: i, price: highs[i] });
       }
       if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) {
           strokes.push({ type: 'bottom', index: i, price: lows[i] });
       }
    }
    return strokes;
  }
}
