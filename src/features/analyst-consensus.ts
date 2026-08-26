/**
 * Keyless StockAnalysis analyst-consensus radar.
 *
 * StockAnalysis publishes a serialized payload on its public forecast page.
 * This module intentionally does not eval the page: the small scanner below
 * understands only JSON-like object/array literals, strings, numbers and
 * nullish values.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

export type AnalystConsensusSignal =
  | 'strong-buy'
  | 'buy'
  | 'hold'
  | 'sell'
  | 'strong-sell';

export interface AnalystRatingPeriod {
  date: string;
  month: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  score: number;
  consensus: string;
}

export interface AnalystPriceTargets {
  low: number;
  high: number;
  count: number;
  median: number;
  average: number;
  updated: string;
  currency: string;
}

export interface RecentAnalystAction {
  firm: string;
  analyst: string;
  date: string;
  action: string;
  actionZh: string;
  ratingNew: string;
  ratingOld: string;
  targetNow: number | null;
  targetOld: number | null;
  analystRankPct: number | null;
}

export interface AnalystConsensusSnapshot {
  symbol: string;
  name: string;
  nameFull: string;
  currentPrice: number;
  currency: string;
  consensus: string;
  consensusZh: string;
  score: number;
  totalAnalysts: number;
  ratings: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  };
  buyRatioPct: number;
  sellRatioPct: number;
  priceTargets: AnalystPriceTargets;
  impliedUpsidePctFromMedian: number;
  impliedUpsidePctFromAverage: number;
  ratingTrend3mPct: number;
  recentUpgrades: number;
  recentDowngrades: number;
  recentActions: RecentAnalystAction[];
  history: AnalystRatingPeriod[];
  latestUpdated: string;
  dataAgeDays: number;
  signal: AnalystConsensusSignal;
  signalZh: string;
  adviceZh: string;
  confidence: number;
  source: string;
}

export interface AnalystConsensusRadar {
  rows: AnalystConsensusSnapshot[];
  failedSymbols: string[];
  bullishCount: number;
  bearishCount: number;
  averageScore: number;
  medianImpliedUpsidePct: number;
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
  generatedAt: string;
  source: string;
}

const ADVISOR_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MoneyMoney/1.0';
const CACHE_TTL_MS = 8 * 60 * 60_000;

type CacheEntry = { ts: number; value: Promise<AnalystConsensusSnapshot> };
const snapshotCache = new Map<string, CacheEntry>();
const execFileAsync = promisify(execFile);

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSymbol(input: string): string {
  const symbol = String(input || '').trim().toUpperCase().replace(/^US/, '');
  if (!symbol || /[^A-Z0-9.-]/.test(symbol)) throw new Error('请输入有效的美股代码');
  return symbol;
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\(["'\\nrt])/g, '$1');
  }
}

class JsLiteralParser {
  constructor(private readonly text: string, private pos = 0) {}

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos < this.text.length - 1 && !/[,}\]]/.test(this.text[this.pos])) {
      throw new Error('Unexpected trailing serialized value');
    }
    return value;
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    const char = this.text[this.pos];
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '"' || char === "'") return this.parseString();
    return this.parsePrimitive();
  }

  private parseObject(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    this.pos++; // opening brace
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] === '}') {
        this.pos++;
        return result;
      }
      const keyMatch = /^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/
        .exec(this.text.slice(this.pos));
      if (!keyMatch || keyMatch.index !== 0) throw new Error('Invalid serialized object key');
      const key = decodeJsonString(keyMatch[1] ?? keyMatch[2] ?? keyMatch[3] ?? '');
      this.pos += keyMatch[0].length;
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.text[this.pos] === ',') {
        this.pos++;
      } else if (this.text[this.pos] !== '}') {
        throw new Error('Unterminated serialized object');
      }
    }
  }

  private parseArray(): unknown[] {
    const result: unknown[] = [];
    this.pos++; // opening bracket
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] === ']') {
        this.pos++;
        return result;
      }
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.text[this.pos] === ',') {
        this.pos++;
      } else if (this.text[this.pos] !== ']') {
        throw new Error('Unterminated serialized array');
      }
    }
  }

  private parseString(): string {
    const quote = this.text[this.pos];
    let escaped = false;
    for (let i = this.pos + 1; i < this.text.length; i++) {
      const char = this.text[i];
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        const raw = this.text.slice(this.pos, i + 1);
        this.pos = i + 1;
        return quote === '"'
          ? decodeJsonString(raw.slice(1, -1))
          : decodeJsonString(raw.slice(1, -1).replace(/'/g, '\\"'));
      }
    }
    throw new Error('Unterminated serialized string');
  }

  private parsePrimitive(): string | number | boolean | null {
    const rest = this.text.slice(this.pos);
    const voidMatch = /^void\s+0/.exec(rest);
    if (voidMatch) {
      this.pos += voidMatch[0].length;
      return null;
    }
    const wordMatch = /^(?:null|true|false|undefined|NaN|Infinity)/.exec(rest);
    if (wordMatch) {
      this.pos += wordMatch[0].length;
      switch (wordMatch[0]) {
        case 'null':
        case 'undefined':
        case 'NaN':
          return null;
        case 'true':
          return true;
        default:
          return false;
      }
    }
    const numberMatch = /^[-+]?(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(rest);
    if (numberMatch) {
      this.pos += numberMatch[0].length;
      const value = Number(numberMatch[0]);
      return Number.isFinite(value) ? value : null;
    }
    throw new Error(`Unsupported serialized value near ${rest.slice(0, 30)}`);
  }
}

function extractSerialized(html: string, key: string, expected: '{' | '['): unknown {
  const keyIndex = html.indexOf(key);
  if (keyIndex < 0) throw new Error(`${key.replace(/[:[{]$/, '')} 数据不存在`);
  // The search keys intentionally include the opening delimiter, so include it
  // in the first search position instead of skipping past it.
  const openerIndex = html.indexOf(expected, keyIndex + key.length - 1);
  if (openerIndex < 0) throw new Error('数据格式异常');

  let depth = 0;
  let quoted: string | null = null;
  let escaped = false;
  for (let i = openerIndex; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quoted) quoted = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quoted = char;
      continue;
    }
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        const fragment = html.slice(openerIndex, i + 1);
        return new JsLiteralParser(fragment).parse();
      }
    }
  }
  throw new Error('数据片段不完整');
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function num(value: unknown, fallback = NaN): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value: unknown): number {
  return Math.max(0, Math.round(num(value, 0)));
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function extractCompany(rawHtml: string, symbol: string): { name: string; nameFull: string } {
  const marker = `ticker:"${symbol}"`;
  const index = rawHtml.indexOf(marker);
  const scope = index >= 0 ? rawHtml.slice(index, index + 700) : rawHtml;
  const nameMatch = scope.match(/name:"((?:\\.|[^"\\])*)"/);
  const fullNameMatch = scope.match(/nameFull:"((?:\\.|[^"\\])*)"/);
  const titleMatch = rawHtml.match(/<title>([^<]+)\s*\(/i);
  return {
    name: nameMatch ? decodeJsonString(nameMatch[1]) : (titleMatch?.[1]?.trim() || symbol),
    nameFull: fullNameMatch
      ? decodeJsonString(fullNameMatch[1])
      : (nameMatch ? decodeJsonString(nameMatch[1]) : symbol),
  };
}

async function fetchTencentQuote(symbol: string): Promise<{ price: number; officialName: string }> {
  const { stdout } = await execFileAsync(
    'curl.exe',
    [
      '--fail', '--silent', '--show-error', '--max-time', '12',
      '-A', USER_AGENT,
      `https://qt.gtimg.cn/q=us${encodeURIComponent(symbol)}`,
    ],
    { timeout: 16_000, maxBuffer: 128 * 1024, encoding: 'utf8' },
  );
  const parts = stdout.split('~');
  const price = num(parts[3]);
  if (!(price > 0)) throw new Error('现价暂时不可用');
  return { price, officialName: String(parts[46] || '').trim() };
}

function pageFallbackPrice(rawHtml: string): number {
  const quoteIndex = rawHtml.indexOf('quote:{');
  const scope = quoteIndex >= 0 ? rawHtml.slice(quoteIndex, quoteIndex + 1200) : '';
  return num(scope.match(/[,{]p:(-?\d+(?:\.\d+)?)/)?.[1]);
}

function mapRecentAction(row: Record<string, any>): RecentAnalystAction | null {
  const firm = text(row.firm);
  if (!firm) return null;
  const action = text(row.action_rt);
  const actionLower = action.toLowerCase();
  const actionZh = actionLower.includes('upgrade')
    ? '上调'
    : actionLower.includes('downgrade')
      ? '下调'
      : actionLower.includes('initiat')
        ? '首次覆盖'
        : '维持';
  const targetNow = row.pt_now == null ? null : num(row.pt_now);
  const targetOld = row.pt_old == null ? null : num(row.pt_old);
  return {
    firm,
    analyst: text(row.analyst),
    date: text(row.date),
    action,
    actionZh,
    ratingNew: text(row.rating_new),
    ratingOld: text(row.rating_old),
    targetNow: Number.isFinite(targetNow) ? targetNow : null,
    targetOld: Number.isFinite(targetOld) ? targetOld : null,
    analystRankPct: Number.isFinite(num(asRecord(row.scores).score)) ? num(asRecord(row.scores).score) : null,
  };
}

function normalizeHistory(rows: any[]): AnalystRatingPeriod[] {
  return rows.map(row => {
    const record = asRecord(row);
    return {
      date: text(record.date),
      month: text(record.month),
      strongBuy: int(record.strongBuy),
      buy: int(record.buy),
      hold: int(record.hold),
      sell: int(record.sell),
      strongSell: int(record.strongSell),
      total: int(record.total),
      score: round(num(record.score)),
      consensus: text(record.consensus),
    };
  }).filter(row => row.total > 0 && row.date);
}

function periodMonth(date: Date): string {
  return `${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(date.getUTCFullYear()).slice(-2)}`;
}

function buildCurrentPeriod(current: Record<string, any>, history: AnalystRatingPeriod[]): AnalystRatingPeriod {
  const period: AnalystRatingPeriod = {
    date: text(current.date) || new Date().toISOString().slice(0, 10),
    month: text(current.month) || periodMonth(new Date()),
    strongBuy: int(current.strongBuy),
    buy: int(current.buy),
    hold: int(current.hold),
    sell: int(current.sell),
    strongSell: int(current.strongSell),
    total: int(current.count),
    score: round(num(current.score)),
    consensus: text(current.consensus),
  };
  if (period.total > 0) return period;
  return history[history.length - 1];
}

function classify(
  input: Pick<AnalystConsensusSnapshot, 'score' | 'totalAnalysts' | 'impliedUpsidePctFromMedian' | 'dataAgeDays'>,
): Pick<AnalystConsensusSnapshot, 'signal' | 'signalZh' | 'adviceZh' | 'confidence' | 'consensusZh'> {
  const { score, impliedUpsidePctFromMedian, dataAgeDays, totalAnalysts } = input;
  let signal: AnalystConsensusSignal = 'hold';
  let signalZh = '卖方观点中性';
  let adviceZh = '分析师整体偏观望。这类共识适合作为背景证据，入场仍应等价格结构、成交量和风险位确认。';

  if (score >= 4.5) {
    signal = 'strong-buy';
    signalZh = '分析师强烈看多';
    adviceZh = '覆盖分析师明显偏向买入，中期叙事偏正面；但共识拥挤时不要追高，优先等回调或突破回踩确认。';
  } else if (score >= 3.75) {
    signal = 'buy';
    signalZh = '分析师温和看多';
    adviceZh = '买入评级占优，可把它当作基本面背景加分；若技术面同步走强，顺势信号更可信。';
  } else if (score <= 2.5) {
    signal = 'strong-sell';
    signalZh = '分析师强烈看空';
    adviceZh = '卖出/强卖评级占优，反弹质量要求更高。若价格仍强势，说明市场与卖方分歧较大，仓位必须更保守。';
  } else if (score <= 3.2) {
    signal = 'sell';
    signalZh = '分析师偏空';
    adviceZh = '卖方评级和目标价偏谨慎，下跌时避免急于抄底；做多需要更强的反转与资金流确认。';
  }

  if (signal === 'hold' && Math.abs(impliedUpsidePctFromMedian) >= 20) {
    signalZh += '，但目标价分歧较大';
    adviceZh += '平均目标价距离现价较远，说明估值预期分歧明显，降低单一共识的权重。';
  } else if (signal === 'buy' && impliedUpsidePctFromMedian < 0) {
    adviceZh += '注意：中位目标价低于现价，部分机构可能认为短期已涨多。';
  } else if ((signal === 'sell' || signal === 'strong-sell') && impliedUpsidePctFromMedian > 15) {
    adviceZh += '注意：中位目标价反而高于现价，可能是评级滞后或市场预期已经改变。';
  }

  const coverageBonus = clamp(Math.sqrt(totalAnalysts) * 4, 0, 26);
  const recencyPenalty = clamp(dataAgeDays * 0.25, 0, 18);
  return {
    signal,
    signalZh,
    adviceZh,
    consensusZh: signalZh,
    confidence: Math.round(clamp(64 + coverageBonus - recencyPenalty, 42, 92)),
  };
}

async function requestSnapshot(symbolInput: string): Promise<AnalystConsensusSnapshot> {
  const symbol = normalizeSymbol(symbolInput);
  const url = `https://stockanalysis.com/stocks/${encodeURIComponent(symbol.toLowerCase())}/forecast/`;
  const { stdout: rawHtml } = await execFileAsync(
    'curl.exe',
    [
      '--fail', '--silent', '--show-error', '--max-time', '18',
      '-A', USER_AGENT,
      '-H', 'Accept: text/html,application/xhtml+xml',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', 'Referer: https://stockanalysis.com/',
      url,
    ],
    { timeout: 22_000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
  );
  const currentRatings = asRecord(extractSerialized(rawHtml, 'currentRatings:{', '{'));
  const recommendations = normalizeHistory(asArray(extractSerialized(rawHtml, 'recommendations:[', '[')));
  const targetsRecord = asRecord(extractSerialized(rawHtml, 'targets:{', '{'));
  // Some page variants omit the recent-action list; consensus and targets are
  // the required core, so this section degrades to empty rather than failing.
  const recentRows = rawHtml.includes('}],ratings:[')
    ? asArray(extractSerialized(rawHtml, '}],ratings:[', '['))
      .map(row => mapRecentAction(asRecord(row)))
      .filter((row): row is RecentAnalystAction => row !== null)
      .slice(0, 8)
    : [];

  const period = buildCurrentPeriod(currentRatings, recommendations);
  if (!period || period.total <= 0) throw new Error('暂无分析师共识覆盖');
  if (!['SPY', 'QQQ'].includes(symbol) && recentRows.length === 0 && recommendations.length === 0) {
    throw new Error('暂无分析师共识覆盖');
  }

  const priceTargets: AnalystPriceTargets = {
    low: num(targetsRecord.low),
    high: num(targetsRecord.high),
    count: int(targetsRecord.count),
    median: num(targetsRecord.median),
    average: num(targetsRecord.average),
    updated: text(targetsRecord.updated),
    currency: text(targetsRecord.currency) || 'USD',
  };
  if (!Number.isFinite(priceTargets.median)) throw new Error('暂无分析师目标价');

  const company = extractCompany(rawHtml, symbol);
  let quote: { price: number; officialName: string };
  try {
    quote = await fetchTencentQuote(symbol);
  } catch {
    const price = pageFallbackPrice(rawHtml);
    if (!(price > 0)) throw new Error('现价暂时不可用');
    quote = { price, officialName: company.nameFull };
  }

  const weightedScore = (
    period.strongBuy * 5 + period.buy * 4 + period.hold * 3 + period.sell * 2 + period.strongSell
  ) / period.total;
  // StockAnalysis uses a 1-5 score on monthly history and sometimes a 1-10
  // score on the current snapshot. Normalize both before classification.
  const rawCurrentScore = Number.isFinite(period.score) ? period.score : round(weightedScore);
  const score = round(rawCurrentScore > 5 ? rawCurrentScore / 2 : rawCurrentScore);
  const buyRatioPct = (period.strongBuy + period.buy) / period.total * 100;
  const sellRatioPct = (period.sell + period.strongSell) / period.total * 100;
  const oldPeriod = recommendations.length >= 4
    ? recommendations[Math.max(0, recommendations.length - 4)]
    : undefined;
  const oldBuyRatio = oldPeriod && oldPeriod.total > 0
    ? (oldPeriod.strongBuy + oldPeriod.buy) / oldPeriod.total * 100
    : buyRatioPct;
  const recentUpgrades = recentRows.filter(row => row.actionZh === '上调').length;
  const recentDowngrades = recentRows.filter(row => row.actionZh === '下调').length;
  const latestUpdated = [period.date, priceTargets.updated].filter(Boolean).sort().at(-1) || '';
  const updateDate = new Date(`${latestUpdated}T00:00:00Z`);
  const dataAgeDays = Number.isNaN(updateDate.getTime())
    ? 999
    : clamp(Math.round((Date.now() - updateDate.getTime()) / 86_400_000), 0, 3650);

  const partial: Omit<AnalystConsensusSnapshot,
    'signal' | 'signalZh' | 'adviceZh' | 'confidence' | 'consensusZh'> = {
    symbol,
    name: company.name,
    nameFull: quote.officialName || company.nameFull,
    currentPrice: round(quote.price),
    currency: priceTargets.currency,
    consensus: period.consensus,
    score,
    totalAnalysts: period.total,
    ratings: {
      strongBuy: period.strongBuy,
      buy: period.buy,
      hold: period.hold,
      sell: period.sell,
      strongSell: period.strongSell,
    },
    buyRatioPct: round(buyRatioPct, 1),
    sellRatioPct: round(sellRatioPct, 1),
    priceTargets,
    impliedUpsidePctFromMedian: round((priceTargets.median / quote.price - 1) * 100),
    impliedUpsidePctFromAverage: round((priceTargets.average / quote.price - 1) * 100),
    ratingTrend3mPct: round(buyRatioPct - oldBuyRatio, 1),
    recentUpgrades,
    recentDowngrades,
    recentActions: recentRows,
    history: [...recommendations, period].slice(-13),
    latestUpdated,
    dataAgeDays,
    source: 'StockAnalysis public analyst consensus',
  };

  return { ...partial, ...classify(partial) };
}

export async function getAnalystConsensusSnapshot(symbolInput: string): Promise<AnalystConsensusSnapshot> {
  const symbol = normalizeSymbol(symbolInput);
  const cached = snapshotCache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;
  const value = requestSnapshot(symbol).catch(error => {
    snapshotCache.delete(symbol);
    throw error;
  });
  snapshotCache.set(symbol, { ts: Date.now(), value });
  return value;
}

export async function getAnalystConsensusRadar(): Promise<AnalystConsensusRadar> {
  const settled: PromiseSettledResult<AnalystConsensusSnapshot>[] = [];
  for (const symbol of ADVISOR_SYMBOLS) {
    try {
      settled.push({ status: 'fulfilled', value: await getAnalystConsensusSnapshot(symbol) });
    } catch (error) {
      settled.push({ status: 'rejected', reason: error });
    }
  }

  const rows = settled.filter((item): item is PromiseFulfilledResult<AnalystConsensusSnapshot> =>
    item.status === 'fulfilled').map(item => item.value);
  if (!rows.length) throw new Error('美股分析师共识雷达暂时不可用');

  const failedSymbols = ADVISOR_SYMBOLS.filter(symbol => !rows.some(row => row.symbol === symbol));
  const bullishCount = rows.filter(row => row.signal === 'strong-buy' || row.signal === 'buy').length;
  const bearishCount = rows.filter(row => row.signal === 'sell' || row.signal === 'strong-sell').length;
  const averageScore = round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length);
  const sortedUpsides = rows.map(row => row.impliedUpsidePctFromMedian).sort((a, b) => a - b);
  const medianImpliedUpsidePct = round(sortedUpsides[Math.floor((rows.length - 1) / 2)]);
  const score = rows.reduce((sum, row) => sum + (
    row.signal === 'strong-buy' ? 1
      : row.signal === 'buy' ? 0.55
        : row.signal === 'sell' ? -0.55
          : row.signal === 'strong-sell' ? -1
            : 0
  ), 0);
  const regimeBoost = round(clamp(score, -2, 2));
  const focus = rows
    .filter(row => row.signal !== 'hold')
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(row => `${row.symbol} ${row.consensus}（${row.score.toFixed(1)}）`)
    .join('、');
  const summaryZh = `已跟踪 ${rows.length} 只美股，平均共识评分 ${averageScore}/5，中位目标价隐含空间 ${medianImpliedUpsidePct}%；${focus || '整体卖方观点中性'}。`;
  const advisorBiasZh = regimeBoost > 0.4
    ? '卖方共识偏正面，对中期多头是背景加分，但目标价滞后时不能替代交易触发。'
    : regimeBoost < -0.4
      ? '卖方共识偏谨慎，反弹更依赖盈利、资金流和技术面共同确认。'
      : '卖方共识没有给出一致环境方向，更适合逐标的核对。';

  return {
    rows,
    failedSymbols,
    bullishCount,
    bearishCount,
    averageScore,
    medianImpliedUpsidePct,
    summaryZh,
    advisorBiasZh,
    regimeBoost,
    generatedAt: new Date().toISOString(),
    source: 'StockAnalysis public analyst consensus',
  };
}
