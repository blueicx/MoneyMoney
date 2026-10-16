(function attachChartAnalysis(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./chart-strategies.js') : root?.MoneyChartStrategies);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MoneyChartAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis, function createChartAnalysis(strategyLibrary) {
  const DEFAULT_CONFIG = {
    signals: true,
    patterns: false,
    structures: false,
    volume: true,
    indicators: { ma: true, boll: false, macd: false },
    strategies: { maCross: true, rsiReversal: false, bollinger: false, volumeBreakout: false, ...Object.fromEntries((strategyLibrary?.STRATEGY_CATALOG||[]).map(row=>[row.id,false])) },
    patternTypes: {},
    maxLabels: 80,
  };

  const CANDLE_PATTERN_CATALOG = Object.freeze([
    ['doji', '十字星'], ['hammer', '锤头线'], ['hanging-man', '上吊线'], ['shooting-star', '流星线'],
    ['long-shadow', '长影线'], ['bullish-engulfing', '看涨吞没'], ['bearish-engulfing', '看跌吞没'],
    ['piercing', '刺透'], ['dark-cloud', '乌云盖顶'], ['bullish-harami', '看涨孕线'], ['bearish-harami', '看跌孕线'],
    ['morning-star', '早晨之星'], ['evening-star', '黄昏之星'], ['three-white-soldiers', '三白兵'],
    ['three-black-crows', '三只乌鸦'], ['spinning-top', '纺锤线'], ['marubozu', '光头光脚线'],
    ['tweezer-top', '镊子顶'], ['tweezer-bottom', '镊子底'], ['three-inside-up', '三内上涨'],
    ['three-inside-down', '三内下跌'],
  ]);

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
    const patternTypes = Object.fromEntries(CANDLE_PATTERN_CATALOG.map(([type]) => [type, true]));
    return {
      ...DEFAULT_CONFIG,
      ...input,
      indicators: { ...DEFAULT_CONFIG.indicators, ...indicators },
      strategies: { ...DEFAULT_CONFIG.strategies, ...(input.strategies || {}) },
      patternTypes: { ...patternTypes, ...(input.patternTypes || {}) },
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

  function pattern(index, type, label, direction, bars, confidence, condition, meaning) {
    const bar = normalizeBar(bars[index]);
    return {
      index, type, label, direction, time: bars[index].time,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      price: bar.close, status: 'confirmed',
      confidence, condition, meaning, disclaimer: '形态仅供参考，不作为买卖建议。'
    };
  }

  function chartDataStatusLabel(envelope = {}) {
    const status = String(envelope.dataStatus || '').toLowerCase();
    const labels = {
      live: '最新可用行情（实时性未声明）', delayed: '延迟行情', historical: '历史时点数据',
      cached: '缓存数据', stale: '过期缓存', degraded: '降级数据', partial: '部分数据',
      empty: '暂无数据', unsupported: '当前市场不支持', unavailable: '来源不可用', failed: '请求失败',
    };
    return labels[status] || '数据状态未知';
  }

  function detectCandlestickPatterns(inputBars = []) {
    const bars = inputBars.map(normalizeBar);
    const found = [];
    for (let index = 0; index < bars.length; index += 1) {
      const current = candleParts(bars[index]);
      const previous = index > 0 ? candleParts(bars[index - 1]) : null;
      const bodyRatio = current.body / current.range;
      if (bodyRatio <= 0.1) found.push(pattern(index, 'doji', '十字星', 'neutral', bars, 'Medium', '实体极小', '市场多空力量均衡，可能面临方向选择或趋势反转'));

      if (current.lower >= Math.max(current.body * 2, current.range * 0.45) && current.upper <= current.range * 0.25) {
        if (previous && previous.close > previous.open) {
          found.push(pattern(index, 'hanging-man', '上吊线', 'bearish', bars, 'Medium', '上升趋势中下影线极长', '高位买盘力量减弱，可能暗示上升趋势即将结束'));
        } else {
          found.push(pattern(index, 'hammer', '锤头线', 'bullish', bars, 'Medium', '下影线极长且实体靠上', '低位买盘支撑强劲，可能暗示下跌趋势见底反转'));
        }
      }

      if (current.upper >= Math.max(current.body * 2, current.range * 0.45) && current.lower <= current.range * 0.25) {
        found.push(pattern(index, 'shooting-star', '流星线', 'bearish', bars, 'Medium', '上影线极长且实体靠下', '高位遭遇强抛压，多头受挫，可能预示短线回调或趋势反转'));
      }

      if (current.upper >= current.range * 0.6 || current.lower >= current.range * 0.6) {
        found.push(pattern(index, 'long-shadow', '长影线', 'neutral', bars, 'Low', '单边影线超过全长60%', '遇到较强阻力或支撑，当前单边趋势动能可能衰竭'));
      }

      if (previous) {
        const previousBearish = previous.close < previous.open;
        const previousBullish = previous.close > previous.open;
        const currentBullish = current.close > current.open;
        const currentBearish = current.close < current.open;

        if (previousBearish && currentBullish && current.open <= previous.close && current.close >= previous.open) {
          found.push(pattern(index, 'bullish-engulfing', '看涨吞没', 'bullish', bars, 'High', '阳线完全包围前阴线实体', '多头力量爆发并完全压倒空头，强烈的见底看涨信号'));
        }
        if (previousBullish && currentBearish && current.open >= previous.close && current.close <= previous.open) {
          found.push(pattern(index, 'bearish-engulfing', '看跌吞没', 'bearish', bars, 'High', '阴线完全包围前阳线实体', '空头力量爆发并完全压倒多头，强烈的见顶看跌信号'));
        }

        if (previousBearish && currentBullish && current.open < previous.close && current.close > (previous.open + previous.close)/2) {
          found.push(pattern(index, 'piercing', '刺透', 'bullish', bars, 'Medium', '阳线深入前阴线实体过半', '多头开始反击，跌势受阻，有较强的反转意味'));
        }
        if (previousBullish && currentBearish && current.open > previous.close && current.close < (previous.open + previous.close)/2) {
          found.push(pattern(index, 'dark-cloud', '乌云盖顶', 'bearish', bars, 'Medium', '阴线深入前阳线实体过半', '空头开始反击，涨势受阻，有较强的反转意味'));
        }

        if (previousBearish && currentBullish && current.open > previous.close && current.close < previous.open) {
          found.push(pattern(index, 'bullish-harami', '孕线', 'bullish', bars, 'Medium', '前大实体完全包含当前小实体', '下跌动能减弱，市场进入犹豫期，可能正在构筑底部'));
        }
        if (previousBullish && currentBearish && current.open < previous.close && current.close > previous.open) {
          found.push(pattern(index, 'bearish-harami', '孕线', 'bearish', bars, 'Medium', '前大实体完全包含当前小实体', '上涨动能减弱，市场进入犹豫期，可能正在构筑顶部'));
        }

        if (index >= 2) {
          const twoBack = candleParts(bars[index - 2]);
          if (twoBack.close < twoBack.open && previous.body <= previous.range * 0.35 && currentBullish && current.close > (twoBack.open + twoBack.close) / 2) {
            found.push(pattern(index, 'morning-star', '早晨之星', 'bullish', bars, 'High', '阴线-十字/小实体-阳线', '经过犹豫期后多头掌握主动，经典且可靠的底部反转信号'));
          }
          if (twoBack.close > twoBack.open && previous.body <= previous.range * 0.35 && currentBearish && current.close < (twoBack.open + twoBack.close) / 2) {
            found.push(pattern(index, 'evening-star', '黄昏之星', 'bearish', bars, 'High', '阳线-十字/小实体-阴线', '经过犹豫期后空头掌握主动，经典且可靠的顶部反转信号'));
          }
        }
      }
      if (index >= 2) {
        const first = candleParts(bars[index - 2]);
        const second = candleParts(bars[index - 1]);
        if ([first, second, current].every(item => item.close > item.open) && first.close < second.close && second.close < current.close) {
          found.push(pattern(index, 'three-white-soldiers', '三白兵', 'bullish', bars, 'High', '连续三根阳线且收盘价递增', '多头持续发力，通常标志着强劲的上升趋势已经确立'));
        }
        if ([first, second, current].every(item => item.close < item.open) && first.close > second.close && second.close > current.close) {
          found.push(pattern(index, 'three-black-crows', '三只乌鸦', 'bearish', bars, 'High', '连续三根阴线且收盘价递减', '空头持续发力，通常标志着强劲的下降趋势已经确立'));
        }
      }

      if (current.body / current.range <= 0.35 && current.upper / current.range >= 0.2 && current.lower / current.range >= 0.2) {
        found.push(pattern(index, 'spinning-top', '纺锤线', 'neutral', bars, 'Low', '实体较小且上下影线均明显', '多空双方暂时僵持，单独出现时需要等待后续K线确认方向'));
      }
      if (current.body / current.range >= 0.8 && current.upper / current.range <= 0.05 && current.lower / current.range <= 0.05) {
        const direction = current.close >= current.open ? 'bullish' : 'bearish';
        found.push(pattern(index, 'marubozu', direction === 'bullish' ? '光头光脚阳线' : '光头光脚阴线', direction, bars, 'Medium', '实体占比至少80%且上下影线很短', direction === 'bullish' ? '买方从开盘到收盘持续占优，趋势动能较强' : '卖方从开盘到收盘持续占优，趋势动能较强'));
      }
      if (previous && Math.abs(current.high - previous.high) <= Math.max(current.range, previous.range) * 0.08 && current.close < current.open && previous.close > previous.open) {
        found.push(pattern(index, 'tweezer-top', '镊子顶', 'bearish', bars, 'Medium', '相邻K线高点近似相等且方向反转', '同一价位遇阻，顶部反转风险上升，需结合趋势和后续确认'));
      }
      if (previous && Math.abs(current.low - previous.low) <= Math.max(current.range, previous.range) * 0.08 && current.close > current.open && previous.close < previous.open) {
        found.push(pattern(index, 'tweezer-bottom', '镊子底', 'bullish', bars, 'Medium', '相邻K线低点近似相等且方向反转', '同一价位获得支撑，底部反转概率增加，需结合趋势和后续确认'));
      }
      if (index >= 2) {
        const first = candleParts(bars[index - 2]);
        const second = candleParts(bars[index - 1]);
        if (first.close < first.open && second.close > second.open && second.close < first.open && current.close > current.open && current.close > first.open) {
          found.push(pattern(index, 'three-inside-up', '三内上涨', 'bullish', bars, 'High', '阴线-被包含的小阳线-向上确认阳线', '下跌趋势中的反转确认，说明买方已突破前一根阴线开盘价'));
        }
        if (first.close > first.open && second.close < second.open && second.close > first.open && current.close < current.open && current.close < first.open) {
          found.push(pattern(index, 'three-inside-down', '三内下跌', 'bearish', bars, 'High', '阳线-被包含的小阴线-向下确认阴线', '上涨趋势中的反转确认，说明卖方已跌破前一根阳线开盘价'));
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

  function calculateMACD(inputBars = [], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const bars = inputBars.map(normalizeBar);
    const fast = Math.max(1, Math.floor(fastPeriod));
    const slow = Math.max(fast + 1, Math.floor(slowPeriod));
    const signalSize = Math.max(1, Math.floor(signalPeriod));
    if (bars.length < slow + signalSize - 1) {
      return { available: false, reason: 'Insufficient historical data for MACD', macdLine: [], signalLine: [], histogram: [] };
    }
    const ema = (values, period) => {
      const output = Array(values.length).fill(null);
      const multiplier = 2 / (period + 1);
      let previous = null;
      values.forEach((value, index) => {
        if (index + 1 < period) return;
        if (previous === null) {
          previous = values.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item, 0) / period;
        } else {
          previous = (value - previous) * multiplier + previous;
        }
        output[index] = previous;
      });
      return output;
    };
    const closes = bars.map(item => item.close);
    const fastLine = ema(closes, fast);
    const slowLine = ema(closes, slow);
    const macdLine = slowLine.map((value, index) => value === null ? null : fastLine[index] - value);
    const signalLine = ema(macdLine.filter(value => value !== null), signalSize);
    const alignedSignal = Array(macdLine.length).fill(null);
    let signalIndex = 0;
    macdLine.forEach((value, index) => {
      if (value !== null) alignedSignal[index] = signalLine[signalIndex++];
    });
    const histogram = macdLine.map((value, index) => value === null || alignedSignal[index] === null ? null : value - alignedSignal[index]);
    return { available: true, fastPeriod: fast, slowPeriod: slow, signalPeriod: signalSize, macdLine, signalLine: alignedSignal, histogram };
  }

  function detectStructures(inputBars = []) {
    const bars = inputBars.map(normalizeBar);
    const structures = [];
    for (let index = 1; index < bars.length - 1; index += 1) {
      if (bars[index].high > bars[index - 1].high && bars[index].high >= bars[index + 1].high) {
        structures.push({ index, type: 'swing-high', label: '摆动高点', direction: 'bearish', time: bars[index].time, price: bars[index].high, status: 'confirmed',
          confidence: 'Medium', condition: '当前高点高于相邻K线高点', meaning: '短线遇阻或卖方开始占优，需等待后续K线确认',
          disclaimer: '结构标记仅供研究参考，不构成交易指令。' });
      }
      if (bars[index].low < bars[index - 1].low && bars[index].low <= bars[index + 1].low) {
        structures.push({ index, type: 'swing-low', label: '摆动低点', direction: 'bullish', time: bars[index].time, price: bars[index].low, status: 'confirmed',
          confidence: 'Medium', condition: '当前低点低于相邻K线低点', meaning: '短线获得支撑或买方开始占优，需等待后续K线确认',
          disclaimer: '结构标记仅供研究参考，不构成交易指令。' });
      }
    }
    return structures;
  }

  function detectChanStructures(inputBars = []) {
    const bars = inputBars.map(normalizeBar);
    const fractals = [];
    for (let index = 1; index < bars.length - 1; index += 1) {
      const previous = bars[index - 1], current = bars[index], next = bars[index + 1];
      if (current.high >= previous.high && current.high > next.high) fractals.push({ index, kind: 'top', price: current.high, time: current.time, confirmed: true, status: 'confirmed' });
      if (current.low <= previous.low && current.low < next.low) fractals.push({ index, kind: 'bottom', price: current.low, time: current.time, confirmed: true, status: 'confirmed' });
    }
    const alternating = [];
    fractals.forEach(item => {
      const last = alternating[alternating.length - 1];
      if (last && last.kind === item.kind) {
        const moreExtreme = item.kind === 'top' ? item.price > last.price : item.price < last.price;
        if (moreExtreme) alternating[alternating.length - 1] = item;
      } else if (!last || item.index > last.index) alternating.push(item);
    });
    const strokes = alternating.slice(1).map((item, index) => {
      const start = alternating[index];
      return { startIndex: start.index, endIndex: item.index, startPrice: start.price, endPrice: item.price, price: item.price, direction: item.price >= start.price ? 'up' : 'down', confirmed: item.confirmed, status: item.confirmed ? 'confirmed' : 'preparing' };
    });
    const segments = [];
    for (let index = 2; index < strokes.length; index += 2) {
      const first = strokes[index - 2], last = strokes[index];
      segments.push({ startIndex: first.startIndex, endIndex: last.endIndex, price: last.endPrice, direction: last.endPrice >= first.startPrice ? 'up' : 'down', strokeCount: 3, confirmed: first.confirmed && last.confirmed, status: first.confirmed && last.confirmed ? 'confirmed' : 'preparing' });
    }
    const hubs = [];
    for (let index = 2; index < strokes.length; index += 1) {
      const window = strokes.slice(index - 2, index + 1);
      const high = Math.min(...window.map(item => Math.max(item.startPrice, item.endPrice)));
      const low = Math.max(...window.map(item => Math.min(item.startPrice, item.endPrice)));
      if (low <= high) hubs.push({ startIndex: window[0].startIndex, endIndex: window[2].endIndex, low, high, price: (low + high) / 2, confirmed: window.every(item => item.confirmed), status: window.every(item => item.confirmed) ? 'confirmed' : 'preparing' });
    }
    const tradePoints = [];
    segments.forEach((segment, index) => {
      const next = segments[index + 1];
      if (!next || next.direction === segment.direction) return;
      const side = segment.direction === 'down' ? 'buy' : 'sell';
      tradePoints.push({
        index: next.startIndex,
        price: bars[next.startIndex]?.close,
        type: side === 'buy' ? 1 : -1,
        side,
        status: next.confirmed ? 'confirmed' : 'preparing',
        confidence: next.confirmed ? 'medium' : 'low',
        time: bars[next.startIndex]?.time,
        meaning: side === 'buy' ? '下行结构结束后出现潜在买点，等待后续确认' : '上行结构结束后出现潜在卖点，等待后续确认',
        disclaimer: '缠论结构仅供研究参考，不构成交易指令。'
      });
    });
    
    const trends = [];
    if (hubs.length >= 2) {
      for (let i = 0; i < hubs.length - 1; i++) {
        const direction = hubs[i+1].high > hubs[i].high ? 'up' : 'down';
        trends.push({ startIndex: hubs[i].startIndex, endIndex: hubs[i+1].endIndex, price: hubs[i + 1].price, direction, status: hubs[i + 1].status });
      }
    }
    const macd = calculateMACD(bars);
    const divergence = [];
    const smallToLarge = [];
    return { fractals, strokes, segments, hubs, tradePoints, trends, macd, divergence, smallToLarge };

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

  function detectLegacyStrategySignals(inputBars = [], enabled = {}) {
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

  function evaluateChartStrategies(inputBars = [], enabled = {}, context = {}) {
    const output=strategyLibrary?.evaluateStrategies(inputBars,enabled,context)||{signals:[],statuses:{}};
    return {signals:[...detectLegacyStrategySignals(inputBars,enabled),...output.signals].sort((a,b)=>a.index-b.index||a.strategy.localeCompare(b.strategy)),statuses:output.statuses};
  }
  function detectStrategySignals(inputBars = [], enabled = {}, context = {}) {
    return evaluateChartStrategies(inputBars,enabled,context).signals;
  }

  function buildStrategyChartPoints({
    bars = [], signals = [], market, instrument, timeframe, strategyVersion = 'chart-strategy-v1',
    source = '', sourceTime = null, live = false, sourceFresh = true, currentBarClosed, costBps = null, asOf = null, evidenceRefs = [],
  } = {}) {
    const expectedPrefix = market === 'stocks' ? 'stock:' : market === 'crypto' ? 'crypto:' : '';
    const normalized = Array.isArray(bars) ? bars.map(normalizeBar) : [];
    if (!expectedPrefix || typeof instrument !== 'string' || !instrument.startsWith(expectedPrefix) || !String(timeframe || '').trim() || !normalized.length) return [];
    const lastIndex = normalized.length - 1;
    const sourceTimestamp = sourceTime == null ? null : (Number.isFinite(Number(sourceTime)) ? Number(sourceTime) : Date.parse(String(sourceTime)));
    const validSourceTime = Number.isFinite(sourceTimestamp) ? new Date(sourceTimestamp).toISOString() : null;
    return (Array.isArray(signals) ? signals : []).flatMap(signal => {
      const index = Number(signal?.index);
      if (!Number.isInteger(index) || index < 0 || index > lastIndex || !['buy', 'sell'].includes(signal?.side) || !signal?.strategy) return [];
      const bar = normalized[index];
      const isLatest = index === lastIndex;
      const explicitlyClosed = isLatest && (currentBarClosed === true || bars[index]?.closed === true);
      // Historical candles are confirmed. In live mode the current candle remains provisional
      // until the feed explicitly closes it or a later candle proves it has ended.
      if (live && isLatest && !sourceFresh && !explicitlyClosed) return [];
      const status = live && isLatest && !explicitlyClosed ? 'forming' : 'confirmed';
      const price = Number(signal.price ?? bar.close);
      if (!Number.isFinite(price) || price <= 0) return [];
      return [{
        ...signal,
        id: ['chart-signal-v1',market,instrument,timeframe,signal.strategyVersion||strategyVersion,signal.strategy,signal.side,bar.time].map(value=>encodeURIComponent(String(value))).join('|'),
        index,
        market,
        instrument,
        timeframe: String(timeframe),
        strategyVersion: String(signal.strategyVersion || strategyVersion),
        side: signal.side,
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        triggerPrice: price,
        price,
        reason: String(signal.reason || ''),
        source: String(source || ''),
        sourceTime: validSourceTime,
        status,
        evidenceRefs: Array.isArray(signal.evidenceRefs) ? [...signal.evidenceRefs] : [...evidenceRefs],
        triggerEvidence: { market, instrument, source: String(source || ''), sourceTime: validSourceTime, time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
        outcomes: strategyPointOutcomes(bars,index,price,signal.side,{status,live,currentBarClosed,costBps,asOf}),
      }];
    });
  }

  function createStrategyPointTracker(){
    const contexts=new Map(),key=c=>JSON.stringify([c.market,c.instrument,c.timeframe]);
    return {
      history(context){return (contexts.get(key(context))?.events||[]).map(row=>({...row}));},
      observe(input,context){
        const matches=point=>point.market===context.market&&point.instrument===context.instrument&&point.timeframe===context.timeframe;
        const points=(Array.isArray(input)?input:[]).filter(matches),id=key(context),old=contexts.get(id)||{points:new Map(),events:[],sourceTime:-Infinity};
        if(!context.live)return {points:points.map(point=>({...point,evolution:[]})),events:[]};
        const output=()=>({points:points.map(point=>({...point,evolution:old.events.filter(event=>event.id===point.id).map(event=>({...event}))})),events:old.events.map(row=>({...row}))});
        if(!context.live||!context.sourceFresh||!Number.isFinite(context.sourceTime)||!Number.isFinite(context.now)||context.sourceTime>context.now+5000||context.sourceTime<old.sourceTime)return output();
        const present=new Set(points.map(point=>point.id)),enabled=new Set(context.enabledStrategies||[]),times=new Set(context.barTimes||[]);
        const add=(point,state,reason)=>{old.events.push({id:point.id,state,at:context.now,sourceTime:context.sourceTime,time:point.time,strategy:point.strategy,price:point.triggerPrice,reason});};
        for(const point of points){
          const previous=old.points.get(point.id);
          if(!previous){if(point.status==='forming')add(point,'forming',point.reason||'当前有效来源首次观察到条件满足');}
          else if(previous.status!==point.status)add(point,point.status,point.reason||'本次完整数据重算后确认状态改变');
          else if(point.status==='forming'&&context.sourceTime>old.sourceTime&&previous.reason!==point.reason)add(point,'updated',point.reason||'形成中条件变化');
          old.points.set(point.id,{...point});
        }
        for(const [pointId,previous] of old.points){
          if(previous.status!=='forming'||present.has(pointId)||!enabled.has(previous.strategy)||!times.has(previous.time))continue;
          add(previous,'withdrawn','本次新鲜来源完整重算后条件不再满足；不是撤单，也不改变已确认历史');old.points.set(pointId,{...previous,status:'withdrawn'});
        }
        old.sourceTime=context.sourceTime;old.events=old.events.slice(-200);
        while(old.points.size>500)old.points.delete(old.points.keys().next().value);
        contexts.delete(id);contexts.set(id,old);while(contexts.size>8)contexts.delete(contexts.keys().next().value);
        return output();
      },
    };
  }
  function filterStrategyChartPoints(points,filters={}) {
    const rows=Array.isArray(points)?points:[];
    return rows.filter(point=>(!filters.strategy||point.strategy===filters.strategy)&&(!filters.side||point.side===filters.side)&&(!filters.status||point.status===filters.status));
  }
  function strategyPointOutcomes(bars,index,price,side,{status='confirmed',live=false,currentBarClosed=false,costBps=null,asOf=null}={}) {
    const cut=asOf==null?Infinity:Number(asOf),sign=side==='sell'?-1:1;
    return [1,3,5,20].map(horizon=>{
      const result={horizon,status:'pending',reason:'观察期限未成熟',observedBars:0,returnPct:null,netReturnPct:null,mfePct:null,maePct:null,costBps};
      if(status!=='confirmed')return {...result,status:'unconfirmed',reason:'形成中点位不评估后续表现'};
      if(!Number.isFinite(price)||price<=0||!Array.isArray(bars)||!Number.isInteger(index)||index<0||!bars[index])return {...result,status:'unavailable',reason:'触发证据无效'};
      const forward=[];let previous=Number(bars[index].time);
      for(let i=index+1;i<=index+horizon;i++){
        const bar=bars[i];if(!bar)break;
        const time=Number(bar.time),values=[bar.open,bar.high,bar.low,bar.close].map(Number);
        if(bar.gap||!Number.isFinite(time)||time<=previous||values.some(value=>!Number.isFinite(value)||value<=0)||Number(bar.high)<Math.max(Number(bar.open),Number(bar.close))||Number(bar.low)>Math.min(Number(bar.open),Number(bar.close)))return {...result,status:'unavailable',reason:'观察区间存在缺口、重复时间或无效 OHLC'};
        // A candle's timestamp is its open, not proof of its close at an asOf cutoff.
        const knownClosed=bar.closedAt!=null?Number(bar.closedAt):cut===Infinity?time:Number(bars[i+1]?.time);
        if(!Number.isFinite(cut)&&cut!==Infinity || !Number.isFinite(knownClosed) || knownClosed>cut || time>cut || bar.closed===false || (live&&i===bars.length-1&&!currentBarClosed&&bar.closed!==true))break;
        forward.push(bar);previous=time;
      }
      result.observedBars=forward.length;if(forward.length!==horizon)return result;
      const pct=value=>sign*(Number(value)-price)/price*100;
      const returnPct=pct(forward.at(-1).close),cost=costBps!=null&&Number.isFinite(Number(costBps))&&Number(costBps)>=0?Number(costBps):null;
      return {...result,status:'matured',reason:cost===null?'成本假设未提供，仅展示毛表现':null,returnPct,netReturnPct:cost===null?null:returnPct-cost/100,costBps:cost,
        mfePct:Math.max(0,...forward.map(bar=>pct(sign===1?bar.high:bar.low))),maePct:Math.min(0,...forward.map(bar=>pct(sign===1?bar.low:bar.high)))};
    });
  }

  function mapIndexedItemsToViewport(items = [], startIndex = 0, visibleCount = 0) {
    const start = Math.max(0, Math.floor(finite(startIndex)));
    const count = Math.max(0, Math.floor(finite(visibleCount)));
    const end = start + count;
    if (!Array.isArray(items) || count === 0) return [];
    return items.flatMap(item => {
      const index = Number(item?.index);
      if (!Number.isInteger(index) || index < start || index >= end) return [];
      return [{ ...item, sourceIndex: Number.isInteger(Number(item.sourceIndex)) ? Number(item.sourceIndex) : index, index: index - start }];
    });
  }

  function clusterChartPointsByPixel(points = [], { radius = 14 } = {}) {
    const threshold = Number.isFinite(Number(radius)) ? Math.max(0, Number(radius)) : 14;
    const valid = (Array.isArray(points) ? points : []).filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
    const parent = valid.map((_, index) => index);
    const find = index => {
      let root = index;
      while (parent[root] !== root) root = parent[root];
      while (parent[index] !== index) { const next = parent[index]; parent[index] = root; index = next; }
      return root;
    };
    const join = (left, right) => {
      const leftRoot = find(left), rightRoot = find(right);
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    };
    const cellSize = threshold || 1;
    const buckets = new Map();
    const coordinateRepresentatives = new Map();
    for (let index = 0; index < valid.length; index += 1) {
      const x = Number(valid[index].x), y = Number(valid[index].y);
      const coordinateKey = `${x}\u0000${y}`;
      const representative = coordinateRepresentatives.get(coordinateKey);
      if (representative !== undefined) {
        join(index, representative);
        continue;
      }
      coordinateRepresentatives.set(coordinateKey, index);
      if (threshold === 0) continue;
      const cellX = Math.floor(x / cellSize), cellY = Math.floor(y / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        const nearby = buckets.get(`${cellX + dx},${cellY + dy}`) || [];
        for (const other of nearby) {
          const deltaX = x - Number(valid[other].x), deltaY = y - Number(valid[other].y);
          if (Math.hypot(deltaX, deltaY) <= threshold) join(index, other);
        }
      }
      const cellKey = `${cellX},${cellY}`;
      const bucket = buckets.get(cellKey) || [];
      bucket.push(index);
      buckets.set(cellKey, bucket);
    }
    const grouped = new Map();
    valid.forEach((point, index) => {
      const root = find(index);
      const group = grouped.get(root) || [];
      group.push(point);
      grouped.set(root, group);
    });
    return [...grouped.values()].map(items => ({
      x: items.reduce((sum, item) => sum + Number(item.x), 0) / items.length,
      y: items.reduce((sum, item) => sum + Number(item.y), 0) / items.length,
      items,
    }));
  }

  function buildChartOverlays({ bars = [], signals = [], config = {} } = {}) {
    const normalized = bars.map(normalizeBar);
    const options = normalizeOverlayConfig(config);
    
    if (normalized.length < 3) {
      return { emptyReason: 'Insufficient historical data', config: options, signals: [], patterns: [], structures: [], chan: { fractals: [], strokes: [], segments: [], hubs: [], tradePoints: [], trends: [], macd: [], divergence: [], smallToLarge: [] }, volume: [], lines: [] };
    }

    const lines = [];
    if (options.indicators.ma) {
      for (const period of [5, 10, 20]) {
        const values = movingAverage(normalized, period);
        lines.push({ type: 'ma', period, values, latestValue: values.slice().reverse().find(value => value != null) ?? null });
      }
    }
    if (options.indicators.boll) lines.push({ type: 'boll', period: 20, values: bollingerBands(normalized) });
    if (options.indicators.macd) lines.push({ type: 'macd', period: { fast: 12, slow: 26, signal: 9 }, values: calculateMACD(normalized) });
    const signalsOutput = options.signals ? signals.filter(item => Number.isInteger(item.index) && item.index >= 0 && item.index < normalized.length).slice(-options.maxLabels) : [];
    const patternsOutput = options.patterns
      ? detectCandlestickPatterns(normalized).filter(item => options.patternTypes[item.type] !== false).slice(-options.maxLabels)
      : [];
    const structuresOutput = options.structures ? detectStructures(normalized).slice(-options.maxLabels) : [];
    const chanOutput = options.structures ? detectChanStructures(normalized) : { fractals: [], strokes: [], segments: [], hubs: [], tradePoints: [], trends: [], macd: { available: false, reason: 'Layer disabled', macdLine: [], signalLine: [], histogram: [] }, divergence: [], smallToLarge: [] };
    const annotations = [
      ...signalsOutput.map(item => ({ ...item, kind: 'strategy', meaning: item.reason || '策略条件已触发', disclaimer: '策略信号仅供研究参考，不构成交易指令。' })),
      ...patternsOutput.map(item => ({ ...item, kind: 'pattern' })),
      ...structuresOutput.map(item => ({ ...item, kind: 'structure' })),
      ...chanOutput.tradePoints.map(item => ({ ...item, kind: 'chan' })),
    ].sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).slice(-options.maxLabels);
    return {
      config: options,
      signals: signalsOutput,
      patterns: patternsOutput,
      structures: structuresOutput,
      chan: chanOutput,
      annotations,
      explanations: annotations,
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

  function layoutMarkerLabels(markers = [], bounds = {}, options = {}) {
    const left = Number(bounds.left), right = Number(bounds.right);
    const top = Number(bounds.top), bottom = Number(bounds.bottom);
    if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
      return (Array.isArray(markers) ? markers : []).map(marker => ({ ...marker, labelVisible: false }));
    }
    const height = Math.max(1, finite(options.height, 14));
    const gap = Math.max(0, finite(options.gap, 3));
    const maxLanes = Math.max(1, Math.floor(finite(options.maxLanes, 24)));
    const step = height + gap;
    const minY = top + height / 2;
    const maxY = bottom - height / 2;
    const occupied = [];
    const result = [];

    for (const marker of Array.isArray(markers) ? markers : []) {
      const requestedWidth = Math.max(1, finite(marker?.width, 1));
      const width = Math.min(requestedWidth, right - left);
      const minX = left + width / 2;
      const maxX = right - width / 2;
      const x = Math.max(minX, Math.min(maxX, finite(marker?.x, (left + right) / 2)));
      const desiredY = Math.max(minY, Math.min(maxY, finite(marker?.y, (top + bottom) / 2)));
      const offsets = [0];
      for (let lane = 1; lane < maxLanes; lane++) offsets.push(-lane * step, lane * step);
      let placed = null;

      for (const offset of offsets) {
        const y = desiredY + offset;
        if (y < minY || y > maxY) continue;
        const box = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
        const collision = occupied.some(other =>
          box.left < other.right + gap && box.right > other.left - gap
          && box.top < other.bottom + gap && box.bottom > other.top - gap);
        if (!collision) { placed = { x, y, ...box }; break; }
      }

      if (placed) occupied.push(placed);
      result.push({ ...marker, x, y: placed?.y ?? desiredY, width, height, labelVisible: Boolean(placed) });
    }
    return result;
  }

  
  function protectReplayContext(context) {
    const data = Array.isArray(context?.data) ? context.data : [];
    if (!data.length) return { safe: false, reason: 'Insufficient data' };
    if (!context.market || !context.instrument) return { safe: false, reason: 'Missing market context' };
    return { safe: true, market: context.market, instrument: context.instrument, timeframe: context.timeframe, length: data.length };
  }

  const SUPPORTED_DRAWINGS = new Set(['horizontal', 'trendline', 'rectangle', 'text']);

  function createDrawingManager(type) {
    let sequence = 0;
    let items = [];
    const clone = value => JSON.parse(JSON.stringify(value));
    return {
      create(properties = {}) {
        if (!SUPPORTED_DRAWINGS.has(type)) throw new Error(`Unsupported drawing type: ${type}`);
        const item = { id: `${type}_${++sequence}`, type, ...clone(properties) };
        items = [...items, item];
        return clone(item);
      },
      update(id, patch = {}) {
        const index = items.findIndex(item => item.id === id);
        if (index < 0) return null;
        const next = { ...items[index], ...clone(patch), id, type };
        items = items.map((item, itemIndex) => itemIndex === index ? next : item);
        return clone(next);
      },
      remove(id) {
        const exists = items.some(item => item.id === id);
        items = items.filter(item => item.id !== id);
        return exists;
      },
      delete(id) { return this.remove(id); },
      list() { return clone(items); },
      serialize() { return JSON.stringify({ version: 1, type, items }); },
      restore(serialized) {
        const payload = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
        if (!payload || payload.type !== type || !Array.isArray(payload.items)) throw new Error('Invalid drawing payload');
        items = payload.items.filter(item => item && item.type === type && typeof item.id === 'string').map(clone);
        sequence = items.reduce((max, item) => Math.max(max, Number(item.id.split('_').pop()) || 0), 0);
        return this.list();
      },
    };
  }

  function createDrawingTool(type) {
    const manager = createDrawingManager(type);
    return {
      type,
      supported: SUPPORTED_DRAWINGS.has(type),
      action: 'draw',
      create: manager.create.bind(manager),
      update: manager.update.bind(manager),
      remove: manager.remove.bind(manager),
      delete: manager.delete.bind(manager),
      list: manager.list.bind(manager),
      serialize: manager.serialize.bind(manager),
      restore: manager.restore.bind(manager),
    };
  }

  return { DEFAULT_CONFIG, STRATEGY_CATALOG:strategyLibrary?.STRATEGY_CATALOG||[], evaluateChartStrategies, CANDLE_PATTERN_CATALOG, normalizeOverlayConfig, chartDataStatusLabel, detectCandlestickPatterns, detectStructures, detectChanStructures, detectStrategySignals, buildStrategyChartPoints, createStrategyPointTracker, filterStrategyChartPoints, strategyPointOutcomes, mapIndexedItemsToViewport, clusterChartPointsByPixel, movingAverage, bollingerBands, calculateMACD, buildChartOverlays, stepReplay, layoutMarkerLabels, protectReplayContext, createDrawingTool };
});
