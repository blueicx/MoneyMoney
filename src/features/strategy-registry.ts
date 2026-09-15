export interface StrategyContext {
  marketId: string;
  timeframe: string;
  prices: number[];
  times?: number[];
  volumes?: number[];
  highs?: number[];
  lows?: number[];
}

export interface StrategyPoint {
  index?: number;
  price: number;
  time: number;
  direction: 'buy' | 'sell' | 'neutral';
  pattern?: string;
  explanation?: string;
  confirmed?: boolean;
}

export interface SignalEvent {
  strategyId: string;
  marketId: string;
  direction: 'buy' | 'sell';
  confidence: number;
  timestamp: number;
}

export type StrategyLifecycle = 'experimental' | 'active' | 'deprecated' | 'retired';

export interface StrategyDefinition {
  version?: string;
  lifecycle?: StrategyLifecycle;
  marketScope?: readonly string[];
  timeframes?: readonly string[];
  capabilities?: readonly string[];
  requiredHistory?: number;
  allowBacktest?: boolean;
  allowPaper?: boolean;
  allowAlerts?: boolean;
  analyze: (context: StrategyContext) => StrategyPoint[];
}

export class StrategyRegistry {
  private readonly strategies = new Map<string, StrategyDefinition>();

  register(id: string, strategy: StrategyDefinition): void {
    if (!id.trim()) throw new Error('Strategy id is required');
    if (typeof strategy.analyze !== 'function') throw new Error(`Strategy ${id} must define analyze()`);
    this.strategies.set(id, strategy);
  }

  get(id: string): StrategyDefinition | undefined {
    return this.strategies.get(id);
  }

  evaluatePoints(strategyId: string, context: StrategyContext): StrategyPoint[] {
    const strategy = this.get(strategyId);
    if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);
    if (strategy.marketScope?.length && !strategy.marketScope.includes(context.marketId)) return [];
    if (strategy.timeframes?.length && !strategy.timeframes.includes(context.timeframe)) {
      throw new Error(`Strategy ${strategyId} does not support timeframe ${context.timeframe}`);
    }
    const requiredHistory = Math.max(0, strategy.requiredHistory ?? 0);
    if (context.prices.length < requiredHistory) return [];
    return strategy.analyze(context) ?? [];
  }
}

export const globalStrategyRegistry = new StrategyRegistry();

export interface ChanPointDef {
  index: number;
  time: number;
  price: number;
  confirmed: boolean;
  explanation: string;
}

export interface ChanFractal extends ChanPointDef {
  type: 'top_fractal' | 'bottom_fractal';
}

export interface ChanBi extends ChanPointDef {
  type: 'top' | 'bottom';
}

export interface ChanSegment {
  type: 'segment';
  start: ChanBi;
  end: ChanBi;
  direction: 'up' | 'down';
  startIndex: number;
  endIndex: number;
  confirmed: boolean;
  explanation: string;
}

export interface ChanHub {
  type: 'hub';
  high: number;
  low: number;
  startIndex: number;
  endIndex: number;
  confirmed: boolean;
  explanation: string;
}

export interface ChanTrend {
  type: 'trend';
  direction: 'up' | 'down' | 'range';
  startHub: ChanHub;
  endHub: ChanHub;
  explanation: string;
}

export interface ChanBuySellPoint extends ChanPointDef {
  type: 'buy1' | 'buy2' | 'buy3' | 'sell1' | 'sell2' | 'sell3';
  direction: 'buy' | 'sell';
}

export interface ChanAnalysisResult {
  fractals: ChanFractal[];
  strokes: ChanBi[];
  segments: ChanSegment[];
  hubs: ChanHub[];
  trends: ChanTrend[];
  points: ChanBuySellPoint[];
}

function pointTime(times: number[], index: number): number {
  return times[index] ?? index;
}

// This is a deterministic, explainable structure layer for research and paper trading.
// It deliberately exposes confirmation state and does not claim to be an execution signal.
export class ChanAnalysis {
  static analyzeFractal(highs: number[], lows: number[], times: number[] = []): ChanFractal[] {
    if (highs.length !== lows.length) throw new Error('High/low series must have the same length');
    const fractals: ChanFractal[] = [];
    for (let index = 1; index < highs.length - 1; index += 1) {
      if (highs[index] > highs[index - 1] && highs[index] > highs[index + 1]) {
        fractals.push({ type: 'top_fractal', index, time: pointTime(times, index), price: highs[index], confirmed: true, explanation: '顶分型：局部高点已被两侧K线确认，通常意味着短线卖压或上行暂停。' });
      }
      if (lows[index] < lows[index - 1] && lows[index] < lows[index + 1]) {
        fractals.push({ type: 'bottom_fractal', index, time: pointTime(times, index), price: lows[index], confirmed: true, explanation: '底分型：局部低点已被两侧K线确认，通常意味着短线买盘或下行暂停。' });
      }
    }
    return fractals;
  }

  static analyzeBi(highs: number[], lows: number[], times: number[] = []): ChanBi[] {
    return this.analyzeFractal(highs, lows, times).map(fractal => ({
      type: fractal.type === 'top_fractal' ? 'top' : 'bottom',
      index: fractal.index,
      time: fractal.time,
      price: fractal.price,
      confirmed: fractal.confirmed,
      explanation: fractal.type === 'top_fractal' ? '笔端点：由顶分型确认，通常用于连接后续向下结构。' : '笔端点：由底分型确认，通常用于连接后续向上结构。',
    }));
  }

  static analyzeSegment(strokes: ChanBi[]): ChanSegment[] {
    const segments: ChanSegment[] = [];
    for (let index = 0; index < strokes.length - 1; index += 1) {
      const start = strokes[index];
      const end = strokes[index + 1];
      if (start.type === end.type || start.index >= end.index) continue;
      const direction = end.price >= start.price ? 'up' : 'down';
      segments.push({ type: 'segment', start, end, direction, startIndex: start.index, endIndex: end.index, confirmed: start.confirmed && end.confirmed, explanation: `线段：${direction === 'up' ? '向上' : '向下'}结构，通常表示该区间的主导方向。` });
    }
    return segments;
  }

  static analyzeHub(segments: ChanSegment[]): ChanHub[] {
    const hubs: ChanHub[] = [];
    for (let index = 0; index < segments.length - 2; index += 1) {
      const group = segments.slice(index, index + 3);
      const high = Math.min(...group.map(segment => Math.max(segment.start.price, segment.end.price)));
      const low = Math.max(...group.map(segment => Math.min(segment.start.price, segment.end.price)));
      if (low < high) {
        hubs.push({ type: 'hub', high, low, startIndex: group[0].startIndex, endIndex: group[2].endIndex, confirmed: group.every(segment => segment.confirmed), explanation: '中枢：多个线段价格区间重叠，通常意味着多空暂时达成平衡，突破方向需要后续确认。' });
      }
    }
    return hubs;
  }

  static analyzeTrend(hubs: ChanHub[]): ChanTrend[] {
    const trends: ChanTrend[] = [];
    for (let index = 0; index < hubs.length - 1; index += 1) {
      const startHub = hubs[index];
      const endHub = hubs[index + 1];
      const direction = endHub.high > startHub.high && endHub.low >= startHub.low ? 'up' : endHub.high < startHub.high && endHub.low <= startHub.low ? 'down' : 'range';
      trends.push({ type: 'trend', direction, startHub, endHub, explanation: `走势：${direction === 'up' ? '上行' : direction === 'down' ? '下行' : '震荡'}，通常用于判断中枢之间的方向关系。` });
    }
    return trends;
  }

  static analyzeBuySellPoints(trends: ChanTrend[], hubs: ChanHub[], strokes: ChanBi[]): ChanBuySellPoint[] {
    if (!trends.length || !hubs.length) return [];
    const trend = trends[trends.length - 1];
    const hub = hubs[hubs.length - 1];
    const stroke = strokes[strokes.length - 1];
    const isUp = trend.direction === 'up';
    const type: ChanBuySellPoint['type'] = isUp ? 'sell1' : 'buy1';
    const direction: ChanBuySellPoint['direction'] = isUp ? 'sell' : 'buy';
    return [{ type, direction, index: stroke?.index ?? hub.endIndex, time: stroke?.time ?? hub.endIndex, price: isUp ? hub.high : hub.low, confirmed: Boolean(stroke?.confirmed), explanation: `${type}：走势${isUp ? '向上' : '向下'}后的研究标记，通常需要背驰、离开中枢和后续K线共同确认，不构成交易指令。` }];
  }

  static analyze(input: { highs: number[]; lows: number[]; times?: number[] }): ChanAnalysisResult {
    const times = input.times ?? [];
    const fractals = this.analyzeFractal(input.highs, input.lows, times);
    const strokes = this.analyzeBi(input.highs, input.lows, times);
    const segments = this.analyzeSegment(strokes);
    const hubs = this.analyzeHub(segments);
    const trends = this.analyzeTrend(hubs);
    return { fractals, strokes, segments, hubs, trends, points: this.analyzeBuySellPoints(trends, hubs, strokes) };
  }
}
