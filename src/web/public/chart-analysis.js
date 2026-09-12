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
    strategies: { maCross: true, rsiReversal: false, bollinger: false, volumeBreakout: false },
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
      strategies: { ...DEFAULT_CONFIG.strategies, ...(input.strategies || {}) },
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

  function relativeStrengthIndex(inputBars, period = 14) {
    const bars = inputBars.map(normalizeBar);
    const size = Math.max(2, Math.floor(period));
    const values = bars.map(() => null);
    if (bars.length <= size) return values;
    let gains = 0;
    let losses = 0;
    for (let index = 1; index <= size; index += 1) {
      const change = bars[index].close - bars[index - 1].close;
      if (change >= 0) gains += change;
      else losses -= change;
    }
    const toRsi = () => {
      if (losses === 0) return gains === 0 ? 50 : 100;
      return 100 - (100 / (1 + gains / losses));
    };
    values[size] = toRsi();
    for (let index = size + 1; index < bars.length; index += 1) {
      const change = bars[index].close - bars[index - 1].close;
      const gain = Math.max(0, change);
      const loss = Math.max(0, -change);
      gains = ((gains * (size - 1)) + gain) / size;
      losses = ((losses * (size - 1)) + loss) / size;
      values[index] = toRsi();
    }
    return values;
  }

  function detectStrategySignals(inputBars = [], enabled = {}) {
    const bars = inputBars.map(normalizeBar);
    const options = {
      maCross: enabled.maCross !== false,
      rsiReversal: enabled.rsiReversal === true,
      bollinger: enabled.bollinger === true,
      volumeBreakout: enabled.volumeBreakout === true,
    };
    const found = [];
    const add = (index, side, strategy, label, reason) => {
      const bar = bars[index];
      if (!bar) return;
      found.push({ index, side, strategy, label, reason, price: bar.close, time: bar.time });
    };

    if (options.maCross) {
      const fast = movingAverage(bars, 5);
      const slow = movingAverage(bars, 20);
      for (let index = 1; index < bars.length; index += 1) {
        if ([fast[index], slow[index], fast[index - 1], slow[index - 1]].some(value => value == null)) continue;
        if (fast[index] >= slow[index] && fast[index - 1] < slow[index - 1]) add(index, 'buy', 'maCross', '均线金叉', 'MA5 上穿 MA20');
        if (fast[index] <= slow[index] && fast[index - 1] > slow[index - 1]) add(index, 'sell', 'maCross', '均线死叉', 'MA5 下穿 MA20');
      }
    }

    if (options.rsiReversal) {
      const rsi = relativeStrengthIndex(bars);
      for (let index = 1; index < bars.length; index += 1) {
        if (rsi[index] == null || rsi[index - 1] == null) continue;
        if (rsi[index - 1] <= 30 && rsi[index] > 30) add(index, 'buy', 'rsiReversal', 'RSI反转买入', `RSI ${rsi[index].toFixed(1)} 收复30`);
        if (rsi[index - 1] >= 70 && rsi[index] < 70) add(index, 'sell', 'rsiReversal', 'RSI反转卖出', `RSI ${rsi[index].toFixed(1)} 跌破70`);
      }
    }

    if (options.bollinger) {
      const bands = bollingerBands(bars);
      for (let index = 1; index < bars.length; index += 1) {
        const previous = bands[index - 1], current = bands[index];
        if (!previous || !current || previous.lower == null || current.lower == null) continue;
        if (bars[index - 1].close <= previous.lower && bars[index].close > current.lower) add(index, 'buy', 'bollinger', '布林下轨反转', '价格重新站回布林下轨');
        if (bars[index - 1].close >= previous.upper && bars[index].close < current.upper) add(index, 'sell', 'bollinger', '布林上轨反转', '价格重新跌回布林上轨');
      }
    }

    if (options.volumeBreakout) {
      const period = 20;
      for (let index = period; index < bars.length; index += 1) {
        const average = bars.slice(index - period, index).reduce((sum, bar) => sum + bar.volume, 0) / period;
        if (!average || bars[index].volume < average * 1.5) continue;
        const change = bars[index].close - bars[index - 1].close;
        if (change > 0) add(index, 'buy', 'volumeBreakout', '放量突破买入', `成交量是20日均量的 ${(bars[index].volume / average).toFixed(1)} 倍`);
        if (change < 0) add(index, 'sell', 'volumeBreakout', '放量突破卖出', `成交量是20日均量的 ${(bars[index].volume / average).toFixed(1)} 倍`);
      }
    }
    return found.sort((left, right) => left.index - right.index || left.strategy.localeCompare(right.strategy));
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

  return { DEFAULT_CONFIG, normalizeOverlayConfig, detectCandlestickPatterns, detectStructures, detectStrategySignals, movingAverage, bollingerBands, buildChartOverlays, stepReplay };
});
