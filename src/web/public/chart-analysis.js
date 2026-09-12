(function attachChartAnalysis(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MoneyChartAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis, function createChartAnalysis() {
  const DEFAULT_CONFIG = {
    signals: true,
    patterns: false,
    structures: false,
    volume: true,
    indicators: { ma: true, boll: false, macd: false },
    maxLabels: 80,
  };

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeBar(bar) {
    const open = finite(bar?.open);
    const close = finite(bar?.close);
    const high = Math.max(open, close, finite(bar?.high));
    const low = Math.min(open, close, finite(bar?.low));
    return { ...bar, time: finite(bar?.time), open, close, high, low, volume: Math.max(0, finite(bar?.volume)) };
  }

  function normalizeOverlayConfig(input = {}) {
    const indicators = input.indicators || {};
    return {
      ...DEFAULT_CONFIG,
      ...input,
      indicators: { ...DEFAULT_CONFIG.indicators, ...indicators },
      maxLabels: Math.max(1, Math.floor(finite(input.maxLabels, DEFAULT_CONFIG.maxLabels))),
    };
  }

  function candleParts(bar) {
    const item = normalizeBar(bar);
    const body = Math.abs(item.close - item.open);
    const range = Math.max(item.high - item.low, Number.EPSILON);
    const upper = item.high - Math.max(item.open, item.close);
    const lower = Math.min(item.open, item.close) - item.low;
    return { ...item, body, range, upper, lower };
  }

  function pattern(index, type, label, direction, bars) {
    return { index, type, label, direction, time: bars[index].time };
  }

  function detectCandlestickPatterns(inputBars = []) {
    const bars = inputBars.map(normalizeBar);
    const found = [];
    for (let index = 0; index < bars.length; index += 1) {
      const current = candleParts(bars[index]);
      const previous = index > 0 ? candleParts(bars[index - 1]) : null;
      const bodyRatio = current.body / current.range;
      if (bodyRatio <= 0.1) found.push(pattern(index, 'doji', '十字星', 'neutral', bars));
      if (current.lower >= Math.max(current.body * 2, current.range * 0.45) && current.upper <= current.range * 0.25) {
        found.push(pattern(index, 'hammer', '锤头线', 'bullish', bars));
      }
      if (current.upper >= Math.max(current.body * 2, current.range * 0.45) && current.lower <= current.range * 0.25) {
        found.push(pattern(index, 'shooting-star', '流星线', 'bearish', bars));
      }
      if (previous) {
        const previousBearish = previous.close < previous.open;
        const previousBullish = previous.close > previous.open;
        const currentBullish = current.close > current.open;
        const currentBearish = current.close < current.open;
        if (previousBearish && currentBullish && current.open <= previous.close && current.close >= previous.open) {
          found.push(pattern(index, 'bullish-engulfing', '看涨吞没', 'bullish', bars));
        }
        if (previousBullish && currentBearish && current.open >= previous.close && current.close <= previous.open) {
          found.push(pattern(index, 'bearish-engulfing', '看跌吞没', 'bearish', bars));
        }
        if (index >= 2) {
          const twoBack = candleParts(bars[index - 2]);
          if (twoBack.close < twoBack.open && previous.body <= previous.range * 0.35 && currentBullish && current.close > (twoBack.open + twoBack.close) / 2) {
            found.push(pattern(index, 'morning-star', '早晨之星', 'bullish', bars));
          }
          if (twoBack.close > twoBack.open && previous.body <= previous.range * 0.35 && currentBearish && current.close < (twoBack.open + twoBack.close) / 2) {
            found.push(pattern(index, 'evening-star', '黄昏之星', 'bearish', bars));
          }
        }
      }
      if (index >= 2) {
        const first = candleParts(bars[index - 2]);
        const second = candleParts(bars[index - 1]);
        if ([first, second, current].every(item => item.close > item.open) && first.close < second.close && second.close < current.close) {
          found.push(pattern(index, 'three-white-soldiers', '三白兵', 'bullish', bars));
        }
        if ([first, second, current].every(item => item.close < item.open) && first.close > second.close && second.close > current.close) {
          found.push(pattern(index, 'three-black-crows', '三只乌鸦', 'bearish', bars));
        }
      }
    }
    return found;
  }

  function movingAverage(inputBars, period) {
    const bars = inputBars.map(normalizeBar);
    const size = Math.max(1, Math.floor(period));
    let sum = 0;
    return bars.map((bar, index) => {
      sum += bar.close;
      if (index >= size) sum -= bars[index - size].close;
      return index + 1 < size ? null : sum / size;
    });
  }

  function bollingerBands(inputBars, period = 20, multiplier = 2) {
    const bars = inputBars.map(normalizeBar);
    const size = Math.max(1, Math.floor(period));
    return bars.map((bar, index) => {
      if (index + 1 < size) return { middle: null, upper: null, lower: null };
      const values = bars.slice(index - size + 1, index + 1).map(item => item.close);
      const middle = values.reduce((sum, value) => sum + value, 0) / size;
      const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / size;
      const deviation = Math.sqrt(variance);
      return { middle, upper: middle + multiplier * deviation, lower: middle - multiplier * deviation };
    });
  }

  function detectStructures(inputBars = []) {
    const bars = inputBars.map(normalizeBar);
    const structures = [];
    for (let index = 1; index < bars.length - 1; index += 1) {
      if (bars[index].high > bars[index - 1].high && bars[index].high >= bars[index + 1].high) {
        structures.push({ index, type: 'swing-high', label: '摆动高点', direction: 'bearish', time: bars[index].time });
      }
      if (bars[index].low < bars[index - 1].low && bars[index].low <= bars[index + 1].low) {
        structures.push({ index, type: 'swing-low', label: '摆动低点', direction: 'bullish', time: bars[index].time });
      }
    }
    return structures;
  }

  function buildChartOverlays({ bars = [], signals = [], config = {} } = {}) {
    const normalized = bars.map(normalizeBar);
    const options = normalizeOverlayConfig(config);
    const lines = [];
    if (options.indicators.ma) {
      for (const period of [5, 10, 20]) lines.push({ type: 'ma', period, values: movingAverage(normalized, period) });
    }
    if (options.indicators.boll) lines.push({ type: 'boll', period: 20, values: bollingerBands(normalized) });
    return {
      config: options,
      signals: options.signals ? signals.filter(item => Number.isInteger(item.index) && item.index >= 0 && item.index < normalized.length).slice(-options.maxLabels) : [],
      patterns: options.patterns ? detectCandlestickPatterns(normalized).slice(-options.maxLabels) : [],
      structures: options.structures ? detectStructures(normalized).slice(-options.maxLabels) : [],
      volume: options.volume ? normalized.map(item => item.volume) : [],
      lines,
    };
  }

  function stepReplay(currentIndex, length, action) {
    const count = Math.floor(finite(length));
    if (count <= 0) return -1;
    const current = Math.min(count - 1, Math.max(0, Math.floor(finite(currentIndex))));
    if (action === 'reset') return 0;
    if (action === 'previous') return Math.max(0, current - 1);
    if (action === 'next') return Math.min(count - 1, current + 1);
    return current;
  }

  return { DEFAULT_CONFIG, normalizeOverlayConfig, detectCandlestickPatterns, detectStructures, movingAverage, bollingerBands, buildChartOverlays, stepReplay };
});
