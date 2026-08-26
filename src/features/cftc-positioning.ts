/**
 * CFTC Commitments of Traders radar for CME crypto futures.
 *
 * Uses the official keyless weekly futures-only report. Positioning is a
 * crowdedness/context input, not a standalone buy or sell trigger.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface CotCategory {
  long: number;
  short: number;
  spreads: number;
  longChange: number;
  shortChange: number;
  spreadsChange: number;
  longPctOi: number;
  shortPctOi: number;
  traders: number;
}

export interface CotAsset {
  symbol: 'BTC' | 'ETH';
  nameZh: string;
  contractName: string;
  reportDate: string;
  contractUnit: string;
  openInterest: number;
  openInterestChange: number;
  noncommercial: CotCategory;
  commercial: Omit<CotCategory, 'spreads' | 'spreadsChange'>;
  netNoncommercial: number;
  netNoncommercialChange: number;
  netPctOfOpenInterest: number;
  longShortRatio: number;
  crowding: 'long-crowded' | 'short-crowded' | 'balanced';
  signalZh: string;
  adviceZh: string;
  confidence: number;
}

export interface CotRadarResult {
  updatedAt: string;
  source: 'CFTC Commitments of Traders';
  reportDelayZh: string;
  assets: CotAsset[];
  summaryZh: string;
  advisorBiasZh: string;
  regimeBoost: number;
}

const REPORT_URL = 'https://www.cftc.gov/dea/futures/deacmesf.htm';
const USER_AGENT = 'MoneyMoney/1.0 (keyless official research)';
const CACHE_TTL_MS = 6 * 60 * 60_000;
let cache: { ts: number; value: CotRadarResult } | null = null;
let inFlight: Promise<CotRadarResult> | null = null;

function number(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function fetchReport(): Promise<string> {
  // CFTC's edge challenges Node's TLS fingerprint, while the system curl
  // client is allowed through. Windows 10+ ships curl.exe.
  const { stdout } = await execFileAsync(
    'curl.exe',
    ['--fail', '--silent', '--show-error', '--max-time', '20', '-A', USER_AGENT, REPORT_URL],
    { timeout: 25_000, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8' },
  );
  const html = stdout;
  if (!html.includes('FUTURES ONLY POSITIONS AS OF')) throw new Error('Unexpected CFTC report');
  return html;
}

function sectionByCode(html: string, code: string): string {
  const codeIndex = html.indexOf(`Code-${code}`);
  if (codeIndex < 0) throw new Error(`CFTC contract ${code} not found`);
  const start = html.lastIndexOf('\n', codeIndex) + 1;
  const nextCode = html.indexOf('Code-', codeIndex + 1);
  const end = nextCode < 0 ? html.length : html.lastIndexOf('\n', nextCode) + 1;
  return html.slice(start, end);
}

function numericLine(section: string, label: string, expected: number): number[] {
  const marker = section.indexOf(label);
  if (marker < 0) throw new Error(`CFTC field missing: ${label}`);
  const lineEnd = section.indexOf('\n', marker);
  const tail = lineEnd < 0 ? '' : section.slice(lineEnd);
  const match = tail.match(/(-?\d[\d,]*(?:\.\d+)?(?:\s+-?\d[\d,]*(?:\.\d+)?)*)/);
  if (!match) throw new Error(`CFTC numbers missing: ${label}`);
  const values = match[1].split(/\s+/).map(number);
  if (values.length < expected) throw new Error(`CFTC field incomplete: ${label}`);
  return values.slice(0, expected);
}

function parseCategory(
  section: string,
  hasSpreads: boolean,
  traders: boolean,
): CotCategory {
  const commitments = numericLine(section, 'COMMITMENTS', 9);
  const changes = numericLine(section, 'CHANGES FROM', 9);
  const percentages = numericLine(section, 'PERCENT OF OPEN INTEREST', 9);
  const traderLine = traders ? numericLine(section, 'NUMBER OF TRADERS', 7) : [];

  return {
    long: commitments[0],
    short: commitments[1],
    spreads: hasSpreads ? commitments[2] : 0,
    longChange: changes[0],
    shortChange: changes[1],
    spreadsChange: hasSpreads ? changes[2] : 0,
    longPctOi: percentages[0],
    shortPctOi: percentages[1],
    traders: traders ? (traderLine[0] || 0) : 0,
  };
}

function parseCommercial(section: string): Omit<CotCategory, 'spreads' | 'spreadsChange'> {
  const all = parseCategory(section, true, true);
  const commitments = numericLine(section, 'COMMITMENTS', 9);
  const changes = numericLine(section, 'CHANGES FROM', 9);
  const percentages = numericLine(section, 'PERCENT OF OPEN INTEREST', 9);
  const traderLine = numericLine(section, 'NUMBER OF TRADERS', 7);
  return {
    long: commitments[3],
    short: commitments[4],
    longChange: changes[3],
    shortChange: changes[4],
    longPctOi: percentages[3],
    shortPctOi: percentages[4],
    traders: traderLine[3] || 0,
  };
}

function buildAdvice(asset: Omit<CotAsset, 'signalZh' | 'adviceZh' | 'confidence' | 'crowding'>): {
  crowding: CotAsset['crowding'];
  signalZh: string;
  adviceZh: string;
  confidence: number;
} {
  const netPct = asset.netPctOfOpenInterest;
  const change = asset.netNoncommercialChange;
  const magnitude = Math.abs(netPct);
  const confidence = Math.min(82, Math.round(35 + Math.min(25, magnitude * 0.7) + Math.min(12, Math.abs(change) / Math.max(1, asset.openInterest) * 500)));

  if (netPct >= 20 && change < 0) {
    return {
      crowding: 'long-crowded',
      signalZh: '机构多头拥挤且边际减弱',
      adviceZh: '大型投机仓仍偏多，但本周净多减少；顺势单收紧止损，避免在情绪高点加重仓位。',
      confidence,
    };
  }
  if (netPct >= 20) {
    return {
      crowding: 'long-crowded',
      signalZh: '机构多头仓位偏拥挤',
      adviceZh: '偏多背景可作加分，但拥挤仓更容易放大回调；优先分批参与，不追单根大阳线。',
      confidence,
    };
  }
  if (netPct <= -20 && change > 0) {
    return {
      crowding: 'short-crowded',
      signalZh: '机构空头拥挤但开始回补',
      adviceZh: '空头回补可能放大反弹；不盲目抄底，等价格止跌和量能确认后再行动。',
      confidence,
    };
  }
  if (netPct <= -20) {
    return {
      crowding: 'short-crowded',
      signalZh: '机构空头仓位偏拥挤',
      adviceZh: '大型投机仓偏空是防守信号；空头单可保留利润保护，多头只做小仓试探。',
      confidence,
    };
  }
  return {
    crowding: 'balanced',
    signalZh: '机构多空相对平衡',
    adviceZh: 'CME 持仓没有明显一边倒；把资金费率、现货趋势和事件风险放在前面判断。',
    confidence,
  };
}

function parseAsset(
  html: string,
  code: string,
  symbol: CotAsset['symbol'],
  nameZh: string,
): CotAsset {
  const section = sectionByCode(html, code);
  const noncommercial = parseCategory(section, true, true);
  const commercial = parseCommercial(section);
  const openInterest = number(section.match(/OPEN INTEREST:\s*([\d,]+)/)?.[1]);
  const oiChange = numericLine(section, 'CHANGES FROM', 9);
  const openInterestChange = number(section.match(/CHANGE IN OPEN INTEREST:\s*(-?[\d,]+)/)?.[1]);
  const contractUnit = section.match(/\n([^\n]+)\s+OPEN INTEREST:/)?.[1]?.trim() || '';
  const reportDate = section.match(/AS OF\s*(\d{2}\/\d{2}\/\d{2})/)?.[1] || '';
  const isoDate = (() => {
    const parts = reportDate.split('/').map(Number);
    if (parts.length !== 3) return '';
    const year = 2000 + parts[2];
    const date = new Date(Date.UTC(year, parts[0] - 1, parts[1]));
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  })();
  const contractName = section.split('\n')[0].split('Code-')[0].trim();
  const net = noncommercial.long - noncommercial.short;
  const netChange = noncommercial.longChange - noncommercial.shortChange;

  const base: Omit<CotAsset, 'signalZh' | 'adviceZh' | 'confidence' | 'crowding'> = {
    symbol,
    nameZh,
    contractName,
    reportDate: isoDate,
    contractUnit,
    openInterest,
    openInterestChange,
    noncommercial,
    commercial,
    netNoncommercial: net,
    netNoncommercialChange: netChange,
    netPctOfOpenInterest: openInterest ? round(net / openInterest * 100, 2) : 0,
    longShortRatio: noncommercial.short ? round(noncommercial.long / noncommercial.short, 2) : 0,
  };
  return { ...base, ...buildAdvice(base) };
}

function buildSummary(assets: CotAsset[]): Pick<CotRadarResult, 'summaryZh' | 'advisorBiasZh' | 'regimeBoost'> {
  const crowded = assets.filter(item => item.crowding !== 'balanced');
  const longCrowded = crowded.filter(item => item.crowding === 'long-crowded');
  const shortCrowded = crowded.filter(item => item.crowding === 'short-crowded');

  let summaryZh = 'CME 机构多空持仓相对平衡，没有明显拥挤方向。';
  let advisorBiasZh = 'CFTC 持仓中性：不额外放大风险，也不作为单独买卖信号。';
  let regimeBoost = 0;
  if (longCrowded.length && !shortCrowded.length) {
    summaryZh = `${longCrowded.map(item => item.nameZh).join('、')} 机构多头偏拥挤，追高要更谨慎。`;
    advisorBiasZh = 'CFTC 多头拥挤：降低加密新仓规模，优先等回调或更强确认。';
    regimeBoost = -2;
  } else if (shortCrowded.length && !longCrowded.length) {
    summaryZh = `${shortCrowded.map(item => item.nameZh).join('、')} 机构空头偏拥挤，注意反弹与防守节奏。`;
    advisorBiasZh = 'CFTC 空头拥挤：不要恐慌追空，空头单设置利润保护，多头只小仓试探。';
    regimeBoost = 2;
  } else if (longCrowded.length && shortCrowded.length) {
    summaryZh = 'BTC 与 ETH 持仓分歧明显，整体拥挤度信号减弱。';
    advisorBiasZh = 'CFTC 分歧信号：按各自技术面和资金费率处理，不用单一持仓方向外推。';
  }

  return { summaryZh, advisorBiasZh, regimeBoost: round(regimeBoost, 1) };
}

export async function getCotRadar(): Promise<CotRadarResult> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const html = await fetchReport();
    const assets: CotAsset[] = [
      parseAsset(html, '133741', 'BTC', '比特币'),
      parseAsset(html, '146021', 'ETH', '以太坊'),
    ];
    const value: CotRadarResult = {
      updatedAt: new Date().toISOString(),
      source: 'CFTC Commitments of Traders',
      reportDelayZh: '官方报告每周更新，通常有数天延迟；适合看中期拥挤度。',
      assets,
      ...buildSummary(assets),
    };
    cache = { ts: Date.now(), value };
    return value;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
