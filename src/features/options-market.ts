/**
 * Free options market data from Deribit's public API.
 * No API key and no trading permission is required.
 */

export interface OptionRow {
  instrumentName: string;
  strike: number;
  optionType: 'call' | 'put';
  markPrice: number | null;
  premiumUsd: number | null;
  impliedVolPct: number | null;
  bidPrice: number;
  askPrice: number;
  spreadPct: number | null;
  volume: number | null;
  volumeUsd: number | null;
  openInterest: number | null;
  quoteTime?: string;
  delta?: number;
  gammaExposureUsd?: number | null;
  quoteQuality?: OptionQuoteQuality;
}

export interface OptionQuoteQuality {
  status: 'quoted' | 'low-liquidity' | 'wide-spread' | 'metrics-incomplete' | 'unquoted';
  label: string;
  referenceAsk: number | null;
  referenceBid: number | null;
}

export function assessOptionQuoteQuality(row: Pick<OptionRow, 'bidPrice' | 'askPrice' | 'spreadPct' | 'volume' | 'openInterest'>): OptionQuoteQuality {
  const bid = Number(row.bidPrice);
  const ask = Number(row.askPrice);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
    return { status: 'unquoted', label: '无双边报价', referenceAsk: null, referenceBid: null };
  }
  const spread = Number(row.spreadPct);
  if (Number.isFinite(spread) && spread > 25) {
    return { status: 'wide-spread', label: '价差过宽', referenceAsk: ask, referenceBid: bid };
  }
  if (row.volume == null || row.openInterest == null) {
    return { status: 'metrics-incomplete', label: '流动性字段缺失', referenceAsk: ask, referenceBid: bid };
  }
  if ((Number.isFinite(spread) && spread > 10) || (row.volume <= 0 && row.openInterest <= 0)) {
    return { status: 'low-liquidity', label: '流动性证据不足', referenceAsk: ask, referenceBid: bid };
  }
  return { status: 'quoted', label: '双边报价可见', referenceAsk: ask, referenceBid: bid };
}

export interface OptionMetricCoverage {
  available: number;
  total: number;
  status: 'complete' | 'partial' | 'unavailable';
}

export interface OptionExpiryDataQuality {
  openInterest: OptionMetricCoverage;
  volume: OptionMetricCoverage;
  impliedVolatility: OptionMetricCoverage;
  gammaExposure: OptionMetricCoverage;
}

export interface OptionPayoffLeg {
  row: OptionRow & { expiryMs?: number };
  action: 'buy' | 'sell';
  contracts: number;
}

export interface OptionPayoffAnalysis {
  quoteAudit: {quoteSkewMs:number;maxAgeMs:number;spreadCrossingVsMidUsd:number;executable:false;reason:string;legs:Array<{instrument:string;quoteTime:string;ageMs:number;bid:number;ask:number;referencePrice:number;contracts:number;multiplier:number}>};
  netPremiumUsd: number;
  maxLossUsd: number | null;
  maxGainUsd: number | null;
  unboundedLoss: boolean;
  unboundedGain: boolean;
  payoffAtSpotUsd: number;
  breakEvenPrices: number[];
  curve: Array<{ underlyingPrice: number; pnlUsd: number }>;
  assumptions: string;
  executionEnabled: false;
}

function optionUnderlyingSymbol(instrumentName: string): string | null {
  const name = String(instrumentName || '').trim().toUpperCase().replace(/\s+/g, '');
  const occ = /^([A-Z0-9]{1,6})\d{6}[CP]\d{8}$/.exec(name);
  if (occ) return occ[1];
  const separated = /^([A-Z][A-Z0-9.]{0,9})-(?:\d{6}|\d{8})-\d+(?:\.\d+)?-[CP]$/.exec(name);
  return separated?.[1] || null;
}

/** Estimate expiration payoff from verified two-sided quotes; this never places orders. */
export function calculateOptionPayoff(input: { spot: number; multiplier: number; legs: OptionPayoffLeg[]; nowMs?: number; underlyingSymbol?: string }): OptionPayoffAnalysis {
  const { spot, multiplier, legs } = input;
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  if (!Number.isFinite(spot) || spot <= 0) throw new Error('标的现价必须为正数');
  if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 100_000) throw new Error('合约乘数必须为 1–100000 的整数');
  if (!Array.isArray(legs) || legs.length < 2 || legs.length > 4) throw new Error('多腿试算需要 2–4 条期权腿');
  if (legs.some(leg => !['buy', 'sell'].includes(leg.action) || !Number.isInteger(leg.contracts) || leg.contracts < 1 || leg.contracts > 100)) throw new Error('腿方向或合约数量无效');
  if (legs.some(leg => !['quoted', 'metrics-incomplete'].includes(leg.row.quoteQuality?.status || '') || !Number.isFinite(leg.row.bidPrice) || !Number.isFinite(leg.row.askPrice) || leg.row.bidPrice <= 0 || leg.row.askPrice < leg.row.bidPrice)) throw new Error('多腿试算只接受双边有效报价');
  const expiries = new Set(legs.map(leg => leg.row.expiryMs).filter((value): value is number => Number.isFinite(value)));
  if (expiries.size !== 1 || legs.some(leg => !Number.isFinite(leg.row.expiryMs))) throw new Error('多腿试算必须使用同一到期日');
  if (legs.some(leg => leg.row.expiryMs! <= nowMs)) throw new Error('所选期权到期日已过，不能进行当前报价的到期试算');
  for (const leg of legs) {
    const quoteTime = Date.parse(String(leg.row.quoteTime || ''));
    if (!Number.isFinite(quoteTime)) throw new Error(`合约 ${leg.row.instrumentName || '(空)'} 缺少有效报价抓取时间`);
    if (quoteTime > nowMs + 60_000) throw new Error(`合约 ${leg.row.instrumentName || '(空)'} 报价时间来自未来`);
    if (nowMs - quoteTime > 5 * 60_000) throw new Error(`合约 ${leg.row.instrumentName || '(空)'} 报价时间超过 5 分钟，请刷新期权链`);
    if (!String(leg.row.instrumentName || '').trim() || !Number.isFinite(leg.row.strike) || leg.row.strike <= 0 || !['call', 'put'].includes(leg.row.optionType)) {
      throw new Error('期权合约身份、行权价或看涨/看跌类型无效');
    }
  }
  const underlyings = legs.map(leg => optionUnderlyingSymbol(leg.row.instrumentName));
  if (underlyings.some(symbol => !symbol)) throw new Error('无法从期权合约身份核验底层标的');
  if (new Set(underlyings).size !== 1) throw new Error('多腿试算必须使用同一底层标的');
  const requestedUnderlying = input.underlyingSymbol == null ? null : String(input.underlyingSymbol).trim().toUpperCase();
  if (requestedUnderlying && underlyings[0] !== requestedUnderlying) throw new Error('期权合约底层标的与请求标的不一致');

  const scale = (leg: OptionPayoffLeg) => leg.contracts * multiplier;
  const premiumPerUnit = (leg: OptionPayoffLeg) => leg.action === 'buy' ? -leg.row.askPrice : leg.row.bidPrice;
  const intrinsic = (leg: OptionPayoffLeg, price: number) => leg.row.optionType === 'call'
    ? Math.max(0, price - leg.row.strike) : Math.max(0, leg.row.strike - price);
  const pnlAt = (price: number) => legs.reduce((sum, leg) => {
    const direction = leg.action === 'buy' ? 1 : -1;
    return sum + (direction * intrinsic(leg, price) + premiumPerUnit(leg)) * scale(leg);
  }, 0);
  const strikes = [...new Set(legs.map(leg => leg.row.strike))].sort((a, b) => a - b);
  const knots = [...new Set([0, ...strikes, spot])].sort((a, b) => a - b);
  const values = knots.map(price => ({ underlyingPrice: price, pnlUsd: pnlAt(price) }));
  const upperCallSlope = legs.filter(leg => leg.row.optionType === 'call')
    .reduce((sum, leg) => sum + (leg.action === 'buy' ? 1 : -1) * scale(leg), 0);
  const unboundedGain = upperCallSlope > 0;
  const unboundedLoss = upperCallSlope < 0;
  const pnlValues = values.map(point => point.pnlUsd);
  const minPnl = Math.min(...pnlValues), maxPnl = Math.max(...pnlValues);
  const roots: number[] = [];
  for (let i = 0; i < values.length - 1; i++) {
    const left = values[i], right = values[i + 1];
    if (left.pnlUsd === 0) roots.push(left.underlyingPrice);
    if (left.pnlUsd * right.pnlUsd < 0) {
      roots.push(left.underlyingPrice + (right.underlyingPrice - left.underlyingPrice) * (-left.pnlUsd) / (right.pnlUsd - left.pnlUsd));
    }
  }
  if (values.at(-1)?.pnlUsd === 0) roots.push(values.at(-1)!.underlyingPrice);
  const last = values.at(-1)!;
  if (upperCallSlope !== 0) {
    const root = last.underlyingPrice - last.pnlUsd / upperCallSlope;
    if (root > last.underlyingPrice) roots.push(root);
  }
  const samplePrices = [...new Set([spot * 0.5, spot * 0.8, spot, spot * 1.2, spot * 1.5, ...strikes].filter(price => Number.isFinite(price) && price >= 0))].sort((a, b) => a - b);
  const curve = samplePrices.map(underlyingPrice => ({ underlyingPrice: Number(underlyingPrice.toFixed(4)), pnlUsd: Number(pnlAt(underlyingPrice).toFixed(2)) }));
  const netPremiumUsd = legs.reduce((sum, leg) => sum - premiumPerUnit(leg) * scale(leg), 0);
  const times=legs.map(leg=>Date.parse(leg.row.quoteTime!));
  const quoteAudit={quoteSkewMs:Math.max(...times)-Math.min(...times),maxAgeMs:Math.max(0,...times.map(time=>nowMs-time)),
    spreadCrossingVsMidUsd:legs.reduce((sum,leg)=>sum+(leg.row.askPrice-leg.row.bidPrice)/2*scale(leg),0),executable:false as const,
    reason:'逐腿参考报价不保证同步或同时成交；价差成本为相对中价的双边跨价估算，不含退出、手续费或额外滑点。缺少组合订单簿与可成交数量证据，不声明可执行报价。',
    legs:legs.map(leg=>({instrument:leg.row.instrumentName,quoteTime:leg.row.quoteTime!,ageMs:Math.max(0,nowMs-Date.parse(leg.row.quoteTime!)),bid:leg.row.bidPrice,ask:leg.row.askPrice,referencePrice:leg.action==='buy'?leg.row.askPrice:leg.row.bidPrice,contracts:leg.contracts,multiplier}))};
  return {
    quoteAudit,
    netPremiumUsd: Number(netPremiumUsd.toFixed(2)),
    maxLossUsd: unboundedLoss ? null : Number(Math.max(0, -minPnl).toFixed(2)),
    maxGainUsd: unboundedGain ? null : Number(Math.max(0, maxPnl).toFixed(2)),
    unboundedLoss,
    unboundedGain,
    payoffAtSpotUsd: Number(pnlAt(spot).toFixed(2)),
    breakEvenPrices: [...new Set(roots.map(value => Number(value.toFixed(4))))].sort((a, b) => a - b),
    curve,
    assumptions: `仅为到期损益估算：买入按卖价、卖出按买价；合约乘数 ${multiplier} 由用户确认。未计手续费、滑点、提前行权、指派、特殊交割与保证金规则；不构成成交或投资建议。`,
    executionEnabled: false,
  };
}

export interface OptionScenarioParameters {
  spotShockPct:number; elapsedDays:number; ivShiftPctPoints:number;
  ratePct:number; dividendYieldPct:number; feePerContractUsd:number;
}

/** European BSM approximation only; not American exercise or an executable quote. */
export function calculateOptionScenario(input: Parameters<typeof calculateOptionPayoff>[0] & {scenario:OptionScenarioParameters}) {
  const payoff=calculateOptionPayoff(input),p=input.scenario,nowMs=input.nowMs ?? Date.now();
  if(!p || Object.values(p).length<6 || [p.spotShockPct,p.elapsedDays,p.ivShiftPctPoints,p.ratePct,p.dividendYieldPct,p.feePerContractUsd].some(value=>typeof value!=='number'||!Number.isFinite(value)))throw Error('情景利率、股息率、费用及三变量必须明确输入有限数值假设');
  if(Math.abs(p.spotShockPct)>20||Math.abs(p.ivShiftPctPoints)>25||p.elapsedDays<0||p.ratePct<-10||p.ratePct>30||p.dividendYieldPct<0||p.dividendYieldPct>30||p.feePerContractUsd<0||p.feePerContractUsd>1000)throw Error('情景超出支持范围：价格±20%、IV±25个百分点，利率-10–30%、股息0–30%、费用0–1000');
  const remainingDays=(input.legs[0].row.expiryMs!-nowMs)/86400000;
  if(p.elapsedDays>remainingDays)throw Error('经过天数不得超过合约到期时间');
  if(input.legs.some(leg=>typeof leg.row.impliedVolPct!=='number'||!Number.isFinite(leg.row.impliedVolPct)||leg.row.impliedVolPct<=0||leg.row.impliedVolPct+p.ivShiftPctPoints<=0||leg.row.impliedVolPct+p.ivShiftPctPoints>400))throw Error('合约来源IV缺失、无效或冲击后超出0–400%，不能推算');
  const cdf=(x:number)=>{const t=1/(1+.2316419*Math.abs(x)),density=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI),tail=density*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?1-tail:tail;};
  const price=input.spot*(1+p.spotShockPct/100),years=Math.max(0,(remainingDays-p.elapsedDays)/365.25),r=p.ratePct/100,q=p.dividendYieldPct/100;
  const value=(spot:number,strike:number,sigma:number,time:number,type:'call'|'put')=>{
    if(time===0)return {price:Math.max(0,type==='call'?spot-strike:strike-spot),greeks:null};
    const root=Math.sqrt(time),d1=(Math.log(spot/strike)+(r-q+sigma*sigma/2)*time)/(sigma*root),d2=d1-sigma*root,df=Math.exp(-r*time),div=Math.exp(-q*time),phi=Math.exp(-d1*d1/2)/Math.sqrt(2*Math.PI),call=type==='call';
    const premium=call?spot*div*cdf(d1)-strike*df*cdf(d2):strike*df*cdf(-d2)-spot*div*cdf(-d1);
    const theta=-spot*div*phi*sigma/(2*root)+(call?-r*strike*df*cdf(d2)+q*spot*div*cdf(d1):r*strike*df*cdf(-d2)-q*spot*div*cdf(-d1));
    return {price:Math.max(0,premium),greeks:{delta:div*(call?cdf(d1):cdf(d1)-1),gamma:div*phi/(spot*sigma*root),vegaPerPctPoint:spot*div*phi*root/100,thetaPerDay:theta/365.25}};
  };
  const legs=input.legs.map(leg=>{
    const sigma=(leg.row.impliedVolPct!+p.ivShiftPctPoints)/100,model=value(price,leg.row.strike,sigma,years,leg.row.optionType),scale=leg.contracts*input.multiplier*(leg.action==='buy'?1:-1);
    return {instrumentName:leg.row.instrumentName,action:leg.action,contracts:leg.contracts,sourceIvPct:leg.row.impliedVolPct!,scenarioIvPct:sigma*100,entryPrice:leg.action==='buy'?leg.row.askPrice:leg.row.bidPrice,modelPrice:Number(model.price.toFixed(8)),modelValueUsd:model.price*scale,modelGreeks:model.greeks,scale};
  });
  const entryFeesUsd=input.legs.reduce((sum,leg)=>sum+leg.contracts*p.feePerContractUsd,0),modelValueUsd=legs.reduce((sum,leg)=>sum+leg.modelValueUsd,0);
  const greeks=years===0?null:legs.reduce((sum,leg)=>{for(const name of ['delta','gamma','vegaPerPctPoint','thetaPerDay'] as const)sum[name]+=leg.modelGreeks![name]*leg.scale;return sum;},{delta:0,gamma:0,vegaPerPctPoint:0,thetaPerDay:0});
  if(!Number.isFinite(modelValueUsd)||greeks&&Object.values(greeks).some(value=>!Number.isFinite(value)))throw Error('模型数值不可用，未发布情景结果');
  return {model:'European Black-Scholes-Merton approximation v1',parameters:{...p},underlyingPrice:price,remainingDays:remainingDays-p.elapsedDays,entryPremiumUsd:payoff.netPremiumUsd,entryFeesUsd,modelValueUsd:Number(modelValueUsd.toFixed(2)),pnlUsd:Number((modelValueUsd-payoff.netPremiumUsd-entryFeesUsd).toFixed(2)),greeks,legs:legs.map(({scale,...leg})=>leg),executionEnabled:false,
    assumptions:'欧式BSM近似、常数利率/连续股息率/IV；三变量为用户压力假设，不是预测或可成交价。美式提前行权、离散除息、指派、特殊交割和退出滑点不在模型内；到期仅计算内在价值，不执行结算。Greeks为模型敏感度，不冒充来源Greeks。'};
}

export interface OptionExpiry {
  expiryMs: number;
  label: string;
  daysToExpiry: number;
  rows: OptionRow[];
  callOpenInterest: number | null;
  putOpenInterest: number | null;
  callVolume: number | null;
  putVolume: number | null;
  putCallOIRatio: number | null;
  putCallVolumeRatio: number | null;
  maxPainStrike: number | null;
  netGammaExposureUsd?: number | null;
  callWallStrike?: number | null;
  putWallStrike?: number | null;
  strategyIdeas: OptionStrategyIdea[];
  strategyIdeasStatus: { status: 'available' | 'unavailable'; reason: string | null };
  dataQuality: OptionExpiryDataQuality;
}

export interface OptionIvTermPoint {
  expiryMs: number;
  label: string;
  daysToExpiry: number;
  atmStrike: number;
  moneynessPct: number;
  callIvPct: number;
  putIvPct: number;
  atmIvPct: number;
  putMinusCallPp: number;
  pairedContracts: 2;
}

export interface OptionIvTermStructure {
  status: 'available' | 'partial' | 'unavailable';
  source: string;
  fetchedAt: string;
  spot: number;
  maxMoneynessPct: number;
  coveredExpiries: number;
  totalExpiries: number;
  coveragePct: number;
  points: OptionIvTermPoint[];
  missingExpiries: Array<{ expiryMs: number; label: string; daysToExpiry: number; reason: string }>;
  reason: string | null;
}

/**
 * Build a current, source-bound IV term structure from matched ATM option pairs.
 * It deliberately does not interpolate, combine expiries, or infer historical IV.
 */
export function buildOptionIvTermStructure(
  expiries: OptionExpiry[],
  spot: number,
  source: string,
  fetchedAt: string,
  maxMoneynessPct = 3,
): OptionIvTermStructure {
  if (!Number.isFinite(spot) || spot <= 0) throw new Error('期权期限结构需要有效的标的现价');
  if (!Number.isFinite(maxMoneynessPct) || maxMoneynessPct <= 0 || maxMoneynessPct > 10) {
    throw new Error('近 ATM 距离阈值必须在 0–10% 之间');
  }

  const points: OptionIvTermPoint[] = [];
  const missingExpiries: OptionIvTermStructure['missingExpiries'] = [];
  for (const expiry of expiries) {
    const byStrike = new Map<number, { call?: OptionRow; put?: OptionRow }>();
    for (const row of expiry.rows) {
      if (!Number.isFinite(row.strike) || row.strike <= 0) continue;
      const pair = byStrike.get(row.strike) || {};
      pair[row.optionType] = row;
      byStrike.set(row.strike, pair);
    }
    const sameStrikePairs = [...byStrike.entries()]
      .filter(([, pair]) => pair.call && pair.put)
      .map(([strike, pair]) => ({ strike, call: pair.call!, put: pair.put!, moneynessPct: Math.abs(strike - spot) / spot * 100 }));
    const nearAtmPairs = sameStrikePairs
      .filter(pair => pair.moneynessPct <= maxMoneynessPct)
      .sort((a, b) => a.moneynessPct - b.moneynessPct || a.strike - b.strike);
    const validPair = nearAtmPairs.find(pair => [pair.call, pair.put].every(row =>
      Number.isFinite(row.impliedVolPct) && row.impliedVolPct! > 0 &&
      Number.isFinite(row.bidPrice) && row.bidPrice > 0 &&
      Number.isFinite(row.askPrice) && row.askPrice >= row.bidPrice &&
      ['quoted', 'metrics-incomplete'].includes(row.quoteQuality?.status || '')
    ));

    if (!validPair) {
      const reason = nearAtmPairs.length
        ? '近 ATM 合约缺少有效 IV 或双边报价'
        : sameStrikePairs.length
          ? `最近同档配对行权价距离现价超过 ${maxMoneynessPct}%`
          : '没有同一到期日、同一行权价的看涨/看跌合约对';
      missingExpiries.push({ expiryMs: expiry.expiryMs, label: expiry.label, daysToExpiry: expiry.daysToExpiry, reason });
      continue;
    }

    const callIvPct = validPair.call.impliedVolPct!;
    const putIvPct = validPair.put.impliedVolPct!;
    points.push({
      expiryMs: expiry.expiryMs,
      label: expiry.label,
      daysToExpiry: expiry.daysToExpiry,
      atmStrike: validPair.strike,
      moneynessPct: Number(validPair.moneynessPct.toFixed(2)),
      callIvPct,
      putIvPct,
      atmIvPct: (callIvPct + putIvPct) / 2,
      putMinusCallPp: putIvPct - callIvPct,
      pairedContracts: 2,
    });
  }

  const totalExpiries = expiries.length;
  const coveredExpiries = points.length;
  const status: OptionIvTermStructure['status'] = coveredExpiries === 0
    ? 'unavailable'
    : coveredExpiries === totalExpiries ? 'available' : 'partial';
  const coveragePct = totalExpiries ? coveredExpiries / totalExpiries * 100 : 0;
  const reason = status === 'unavailable'
    ? `暂无可计算的近 ATM IV 配对；需同一到期日、同一行权价、有效双边报价与 IV，且行权价距现价不超过 ${maxMoneynessPct}%`
    : status === 'partial' ? `${coveredExpiries}/${totalExpiries} 个到期日有有效配对；其余到期日未纳入曲线` : null;

  return { status, source, fetchedAt, spot, maxMoneynessPct, coveredExpiries, totalExpiries,
    coveragePct: Number(coveragePct.toFixed(1)), points, missingExpiries, reason };
}

export interface OptionStrategyIdea {
  id: string;
  nameZh: string;
  outlookZh: string;
  riskZh: string;
  score: number;
  strikes?: {
    shortPut?: number;
    longPut?: number;
    shortCall?: number;
    longCall?: number;
  };
  legsZh: string[];
  reasonsZh: string[];
  riskNotesZh: string[];
}

export interface OptionsSnapshot {
  source: string;
  market: 'crypto' | 'us_equity';
  asset: string;
  fetchedAt: string;
  spot: number;
  totalCallOpenInterest: number | null;
  totalPutOpenInterest: number | null;
  totalPutCallOIRatio: number | null;
  quote?: {
    change: number;
    changePercent: number;
    volume: number | null;
    iv30Pct?: number;
    bid?: number;
    ask?: number;
  };
  ivTermStructure: OptionIvTermStructure;
  expiries: OptionExpiry[];
}

interface CacheEntry {
  ts: number;
  value: OptionsSnapshot;
}

const snapshotCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const equityCache = new Map<string, CacheEntry>();
const EQUITY_CACHE_TTL_MS = 5 * 60_000;
const CONTRACT_MULTIPLIER = 100;

function num(value: any, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNum(value: any): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function completeSum<T>(rows: T[], read: (row: T) => number | null | undefined): number | null {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) {
    const value = read(row);
    if (value == null || !Number.isFinite(value)) return null;
    sum += value;
  }
  return sum;
}

function metricCoverage(rows: OptionRow[], read: (row: OptionRow) => number | null | undefined): OptionMetricCoverage {
  const available = rows.filter(row => {
    const value = read(row);
    return value != null && Number.isFinite(value);
  }).length;
  return {
    available,
    total: rows.length,
    status: available === 0 ? 'unavailable' : available === rows.length ? 'complete' : 'partial',
  };
}

async function fetchResult(url: string): Promise<any> {
  const response = await fetch(url, {
     headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Deribit HTTP ${response.status}`);
  const payload: any = await response.json();
  if (payload?.error_code) throw new Error(payload.message || `Deribit error ${payload.error_code}`);
  return payload.result;
}

function expiryLabel(expiryMs: number): string {
  return new Date(expiryMs).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  });
}

function calculateMaxPain(rows: OptionRow[]): number | null {
  if (!rows.length || rows.some(row => row.openInterest == null)) return null;
  const strikes = [...new Set(rows.map(row => row.strike))].sort((a, b) => a - b);
  if (!strikes.length) return null;

  let bestStrike = strikes[0];
  let bestPain = Number.MAX_SAFE_INTEGER;
  for (const settlement of strikes) {
    let pain = 0;
    for (const row of rows) {
      const intrinsic = row.optionType === 'call'
        ? Math.max(0, settlement - row.strike)
        : Math.max(0, row.strike - settlement);
      pain += intrinsic * row.openInterest!;
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settlement;
    }
  }
  return bestStrike;
}

function gammaAt(rows: OptionRow[], strike: number | null): number {
  return strike == null ? 0 : Math.abs(rows.find(row => row.strike === strike)?.gammaExposureUsd ?? 0);
}

function nearestStrike(rows: OptionRow[], optionType: 'call' | 'put', spot: number): number | null {
  const candidates = rows.filter(row => row.optionType === optionType);
  if (!candidates.length) return null;
  return candidates.reduce((best, row) =>
    Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best, candidates[0].strike);
}

function strikeNear(
  rows: OptionRow[],
  optionType: 'call' | 'put',
  spot: number,
  distancePct: number,
): number | null {
  const target = optionType === 'call' ? spot * (1 + distancePct) : spot * (1 - distancePct);
  const candidates = rows.filter(row => row.optionType === optionType);
  if (!candidates.length) return null;
  return candidates.reduce((best, row) =>
    Math.abs(row.strike - target) < Math.abs(best - target) ? row.strike : best, candidates[0].strike);
}

function strikeBeyond(
  rows: OptionRow[],
  optionType: 'call' | 'put',
  anchor: number,
): number | null {
  const candidates = rows.filter(row => optionType === 'put' ? row.strike < anchor : row.strike > anchor);
  if (!candidates.length) return null;
  const target = optionType === 'put' ? anchor * 0.96 : anchor * 1.04;
  return candidates.reduce((best, row) =>
    Math.abs(row.strike - target) < Math.abs(best - target) ? row.strike : best, candidates[0].strike);
}

function strategyIdeasAvailability(rows: OptionRow[], spot: number): OptionExpiry['strategyIdeasStatus'] {
  const calls = rows.filter(row => row.optionType === 'call');
  const puts = rows.filter(row => row.optionType === 'put');
  if (!calls.length || !puts.length) return { status: 'unavailable', reason: '缺少 Call 或 Put 合约，无法形成双边策略观察。' };
  if (rows.some(row => row.openInterest == null)) {
    return { status: 'unavailable', reason: 'OI 字段存在缺失；PCR、最大痛点及依赖它们的策略评分已停用。' };
  }
  if (rows.some(row => row.gammaExposureUsd == null)) {
    return { status: 'unavailable', reason: 'Gamma/GEX 字段存在缺失；依赖它的策略评分已停用。' };
  }
  const atmCall = calls.find(row => row.strike === nearestStrike(calls, 'call', spot));
  const atmPut = puts.find(row => row.strike === nearestStrike(puts, 'put', spot));
  if (atmCall?.impliedVolPct == null || atmPut?.impliedVolPct == null) {
    return { status: 'unavailable', reason: 'ATM Call/Put 隐含波动率不完整；依赖 IV 的策略评分已停用。' };
  }
  return { status: 'available', reason: null };
}

function pct(value: number, digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function buildStrategyIdeas(
  rows: OptionRow[],
  spot: number,
  expiryMs: number,
  callWallStrike: number | null | undefined,
  putWallStrike: number | null | undefined,
  netGammaExposureUsd: number | undefined,
): OptionStrategyIdea[] {
  const calls = rows.filter(row => row.optionType === 'call');
  const puts = rows.filter(row => row.optionType === 'put');
  if (strategyIdeasAvailability(rows, spot).status !== 'available') return [];

  const callOI = completeSum(calls, row => row.openInterest)!;
  const putOI = completeSum(puts, row => row.openInterest)!;
  const callVolume = completeSum(calls, row => row.volume);
  const putVolume = completeSum(puts, row => row.volume);
  const pcr = callOI > 0 ? putOI / callOI : null;
  const volumePcr = callVolume != null && putVolume != null && callVolume > 0 ? putVolume / callVolume : null;
  const maxPain = calculateMaxPain(rows)!;
  const maxPainDistancePct = maxPain == null ? 0 : ((maxPain - spot) / spot) * 100;
  const atmCallStrike = nearestStrike(calls, 'call', spot);
  const atmPutStrike = nearestStrike(puts, 'put', spot);
  const atmCall = calls.find(row => row.strike === atmCallStrike);
  const atmPut = puts.find(row => row.strike === atmPutStrike);
  const atmIv = (atmCall!.impliedVolPct! + atmPut!.impliedVolPct!) / 2;
  const positiveGex = (netGammaExposureUsd || 0) > 0;
  const negativeGex = (netGammaExposureUsd || 0) < 0;
  const daysToExpiry = Math.max(0, Math.round((expiryMs - Date.now()) / 86_400_000));
  const score = (value: number) => Math.round(Math.max(8, Math.min(94, value)));

  const shortPut = putWallStrike ?? strikeNear(puts, 'put', spot, 0.04) ?? nearestStrike(puts, 'put', spot);
  const longPut = shortPut == null ? null : strikeBeyond(puts, 'put', shortPut) ?? shortPut;
  const shortCall = callWallStrike ?? strikeNear(calls, 'call', spot, 0.04) ?? nearestStrike(calls, 'call', spot);
  const longCall = shortCall == null ? null : strikeBeyond(calls, 'call', shortCall) ?? shortCall;
  const fmt = (value: number | null | undefined) => value == null ? '--' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const pcrText = pcr == null ? '无' : pcr.toFixed(2);
  const volumePcrText = volumePcr == null ? '来源字段缺失或 Call 成交量为 0' : volumePcr.toFixed(2);
  const commonRisk = [
    `ATM 隐含波动率约 ${atmIv.toFixed(1)}%；期权买方要先跨过时间价值损耗。`,
    `距离到期 ${daysToExpiry} 天，临近到期 Gamma 和流动性变化会更快。`,
  ];

  const condorScore = score(
    44
    + (pcr != null && pcr >= 0.72 && pcr <= 1.38 ? 18 : 0)
    + (Math.abs(maxPainDistancePct) <= 1.6 ? 14 : 0)
    + (positiveGex ? 12 : negativeGex ? -10 : 0)
    + (daysToExpiry >= 7 && daysToExpiry <= 45 ? 5 : 0)
    - (atmIv > 85 ? 7 : 0),
  );

  const bullPutScore = score(
    38
    + (pcr != null && pcr < 1.05 ? 13 : 0)
    + (maxPain != null && maxPain > spot ? 10 : 0)
    + (positiveGex ? 10 : negativeGex ? -12 : 0)
    + (atmIv > 0 && atmIv < 70 ? 6 : 0),
  );

  const bearCallScore = score(
    38
    + (pcr != null && pcr > 1.18 ? 14 : 0)
    + (maxPain != null && maxPain < spot ? 9 : 0)
    + (negativeGex ? 13 : positiveGex ? -8 : 0)
    + (atmIv > 45 ? 5 : 0),
  );

  const protectivePutScore = score(
    33
    + (negativeGex ? 18 : 0)
    + (pcr != null && pcr > 1.15 ? 11 : 0)
    + (maxPain != null && maxPain < spot ? 7 : 0)
    + (atmIv > 0 && atmIv < 65 ? 6 : -4),
  );

  return [
    {
      id: 'iron-condor',
      nameZh: '铁鹰 / 铁兀鹰',
      outlookZh: '区间震荡',
      riskZh: '四腿 · 风险有限',
      score: condorScore,
      strikes: shortPut == null || longPut == null || shortCall == null || longCall == null
        ? undefined
        : { shortPut, longPut, shortCall, longCall },
      legsZh: [
        `卖出约 ${fmt(shortPut)} Put，买入约 ${fmt(longPut)} Put`,
        `卖出约 ${fmt(shortCall)} Call，买入约 ${fmt(longCall)} Call`,
      ],
      reasonsZh: [
        `本到期 PCR ${pcrText}，成交量 PCR ${volumePcrText}。`,
        `最大痛点 ${fmt(maxPain)}，距离现价 ${pct(maxPainDistancePct)}。`,
        netGammaExposureUsd == null
          ? '该来源未提供可靠 GEX，区间判断主要来自 PCR 与最大痛点。'
          : positiveGex
            ? '正 GEX 常伴随 dealer 稳定波动的环境，适合观察区间策略。'
            : '负 GEX 环境波动可能放大，区间策略要降低仓位。',
      ],
      riskNotesZh: commonRisk,
    },
    {
      id: 'bull-put-spread',
      nameZh: '牛市 Put 价差',
      outlookZh: '温和看涨 / 守住支撑',
      riskZh: '两腿 · 风险有限',
      score: bullPutScore,
      strikes: shortPut == null || longPut == null ? undefined : { shortPut, longPut },
      legsZh: [
        `卖出约 ${fmt(shortPut)} Put`,
        `买入更低行权价约 ${fmt(longPut)} Put`,
      ],
      reasonsZh: [
        `Put 持仓比例 ${pcrText}，若低于 1 通常没有明显避险拥挤。`,
        putWallStrike ? `Put Wall 约 ${fmt(putWallStrike)}，可作为支撑观察位。` : '以现价下方 4% 附近作为支撑观察位。',
      ],
      riskNotesZh: [
        '跌破短期支撑或标的快速放量下行时应重新评估。',
        ...commonRisk,
      ],
    },
    {
      id: 'bear-call-spread',
      nameZh: '熊市 Call 价差',
      outlookZh: '温和看空 / 阻力承压',
      riskZh: '两腿 · 风险有限',
      score: bearCallScore,
      strikes: shortCall == null || longCall == null ? undefined : { shortCall, longCall },
      legsZh: [
        `卖出约 ${fmt(shortCall)} Call`,
        `买入更高行权价约 ${fmt(longCall)} Call`,
      ],
      reasonsZh: [
        `Put 持仓比例 ${pcrText}，若偏高说明避险需求增强。`,
        callWallStrike ? `Call Wall 约 ${fmt(callWallStrike)}，可作为阻力观察位。` : '以现价上方 4% 附近作为阻力观察位。',
      ],
      riskNotesZh: [
        '强势突破 Call Wall 时不要逆势加仓。',
        ...commonRisk,
      ],
    },
    {
      id: 'protective-put',
      nameZh: '保护性 Put',
      outlookZh: '持仓保险',
      riskZh: '买入 Put · 最大亏损为权利金',
      score: protectivePutScore,
      strikes: (() => {
        const strike = strikeNear(puts, 'put', spot, 0.05) ?? nearestStrike(puts, 'put', spot);
        return strike == null ? undefined : { longPut: strike };
      })(),
      legsZh: [
        `持有标的时，买入约 ${fmt(strikeNear(puts, 'put', spot, 0.05) ?? nearestStrike(puts, 'put', spot))} Put`,
      ],
      reasonsZh: [
        netGammaExposureUsd == null
          ? '当前缺少 GEX，但 PCR 偏高时可作为持仓保险参考。'
          : negativeGex
            ? '负 GEX 环境下下跌波动可能放大，保护性 Put 更值得关注。'
            : '正 GEX 环境下跌风险相对温和，保险需求较低。',
      ],
      riskNotesZh: [
        '保险成本会拖累收益，适合事件或持仓保护，不适合长期无条件滚动。',
        ...commonRisk,
      ],
    },
  ].sort((a, b) => b.score - a.score);
}

function buildExpiry(expiryMs: number, rows: OptionRow[], spot: number): OptionExpiry {
  const calls = rows.filter(row => row.optionType === 'call');
  const puts = rows.filter(row => row.optionType === 'put');
  const callOI = completeSum(calls, row => row.openInterest);
  const putOI = completeSum(puts, row => row.openInterest);
  const callVolume = completeSum(calls, row => row.volume);
  const putVolume = completeSum(puts, row => row.volume);
  const dataQuality: OptionExpiryDataQuality = {
    openInterest: metricCoverage(rows, row => row.openInterest),
    volume: metricCoverage(rows, row => row.volume),
    impliedVolatility: metricCoverage(rows, row => row.impliedVolPct),
    gammaExposure: metricCoverage(rows, row => row.gammaExposureUsd),
  };
  const hasGamma = dataQuality.gammaExposure.status === 'complete';
  const callWall = hasGamma
    ? calls.reduce<number | null>((best, row) =>
        (row.gammaExposureUsd || 0) > gammaAt(calls, best) ? row.strike : best, null)
    : null;
  const putWall = hasGamma
    ? puts.reduce<number | null>((best, row) =>
        Math.abs(row.gammaExposureUsd || 0) > gammaAt(puts, best) ? row.strike : best, null)
    : null;
  const netGammaExposureUsd = hasGamma
    ? completeSum(rows, row => row.gammaExposureUsd) ?? undefined
    : undefined;
  const strategyIdeasStatus = strategyIdeasAvailability(rows, spot);

  return {
    expiryMs,
    label: expiryLabel(expiryMs),
    daysToExpiry: Math.max(0, Math.round((expiryMs - Date.now()) / 86_400_000)),
    rows: rows.map(row => ({ ...row, quoteQuality: assessOptionQuoteQuality(row) })).sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType)),
    callOpenInterest: callOI,
    putOpenInterest: putOI,
    callVolume,
    putVolume,
    putCallOIRatio: callOI != null && putOI != null && callOI > 0 ? putOI / callOI : null,
    putCallVolumeRatio: callVolume != null && putVolume != null && callVolume > 0 ? putVolume / callVolume : null,
    maxPainStrike: calculateMaxPain(rows),
    netGammaExposureUsd,
    callWallStrike: callWall,
    putWallStrike: putWall,
    strategyIdeas: strategyIdeasStatus.status === 'available' ? buildStrategyIdeas(
      rows,
      spot,
      expiryMs,
      callWall,
      putWall,
      netGammaExposureUsd,
    ) : [],
    strategyIdeasStatus,
    dataQuality,
  };
}

function toOptionRow(item: any, spot: number): OptionRow | null {
  const name = String(item.instrument_name || '');
  const parts = name.split('-');
  const assetPrefix = parts[0] || '';
  if (parts.length !== 4 || !['BTC', 'ETH'].includes(assetPrefix)) return null;
  const rawStrike = num(item.strike, NaN);
  const strike = Number.isFinite(rawStrike) ? rawStrike : num(parts[2]);
  const type = (parts[3] || '').toUpperCase() === 'P' ? 'put' : 'call';
  const markPriceBtc = optionalNum(item.mark_price);
  const bid = optionalNum(item.bid_price) ?? 0;
  const ask = optionalNum(item.ask_price) ?? 0;
  const volume = optionalNum(item.volume);
  const openInterest = optionalNum(item.open_interest);
  const impliedVolPct = optionalNum(item.mark_iv);
  const spreadPct = bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  return {
    instrumentName: name,
    strike,
    optionType: type,
    markPrice: markPriceBtc,
    premiumUsd: markPriceBtc == null ? null : markPriceBtc * spot,
    impliedVolPct,
    bidPrice: bid,
    askPrice: ask,
    spreadPct,
    volume,
    volumeUsd: optionalNum(item.volume_usd) ?? (volume == null || markPriceBtc == null ? null : volume * markPriceBtc * spot),
    openInterest,
  };
}

function buildDeribitExpiries(instruments: any[], summaries: any[], asset: string, spot: number): OptionExpiry[] {
  const instrumentExpiry = new Map<string, number>();
  for (const item of instruments) {
    if (String(item.kind).toLowerCase() === 'option' && item.expiration_timestamp) {
      instrumentExpiry.set(String(item.instrument_name), num(item.expiration_timestamp));
    }
  }

  const grouped = new Map<number, OptionRow[]>();
  for (const item of summaries) {
    const name = String(item.instrument_name || '');
    const expiryMs = instrumentExpiry.get(name);
    if (!expiryMs || String(item.instrument_name || '').split('-')[0] !== asset) continue;
    const row = toOptionRow(item, spot);
    if (!row) continue;
    const list = grouped.get(expiryMs) || [];
    list.push(row);
    grouped.set(expiryMs, list);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([expiryMs, rows]) => buildExpiry(expiryMs, rows, spot));
}

export async function getOptionsSnapshot(rawAsset: string): Promise<OptionsSnapshot> {
  const asset = String(rawAsset || 'BTC').toUpperCase();
  if (!['BTC', 'ETH'].includes(asset)) throw new Error('目前支持 BTC 和 ETH 免费期权数据');
  const cached = snapshotCache.get(asset);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const base = 'https://www.deribit.com/api/v2/public';
  const [index, instruments, summaries] = await Promise.all([
    fetchResult(`${base}/get_index_price?index_name=${asset.toLowerCase()}_usd`),
    fetchResult(`${base}/get_instruments?currency=${asset}&kind=option&expired=false`),
    fetchResult(`${base}/get_book_summary_by_currency?currency=${asset}&kind=option`),
  ]);

  const spot = Number(index?.price) || num(summaries.find((item: any) => item.underlying_price)?.underlying_price);
  if (!spot) throw new Error('无法读取标的指数价格');
  const expiries = buildDeribitExpiries(instruments || [], summaries || [], asset, spot);
  const totalCallOpenInterest = completeSum(expiries, expiry => expiry.callOpenInterest);
  const totalPutOpenInterest = completeSum(expiries, expiry => expiry.putOpenInterest);
  const fetchedAt = new Date().toISOString();
  const value: OptionsSnapshot = {
    source: 'Deribit Public API',
    market: 'crypto',
    asset,
    fetchedAt,
    spot,
    ivTermStructure: buildOptionIvTermStructure(expiries, spot, 'Deribit Public API', fetchedAt),
    totalCallOpenInterest,
    totalPutOpenInterest,
    totalPutCallOIRatio: totalCallOpenInterest != null && totalPutOpenInterest != null && totalCallOpenInterest > 0
      ? totalPutOpenInterest / totalCallOpenInterest : null,
    expiries,
  };
  snapshotCache.set(asset, { ts: Date.now(), value });
  return value;
}

function normalizeEquitySymbol(raw: string): string {
  const symbol = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(symbol)) {
    throw new Error('请输入有效的美股/ETF 代码，例如 AAPL、SPY 或 TSLA');
  }
  return symbol;
}

function parseCboeOptionSymbol(value: string) {
  const match = /^([A-Z0-9]{1,6})(\d{6})([CP])(\d{8})$/.exec(String(value || '').toUpperCase());
  if (!match) return null;
  const [, , expiry, kind, strikeText] = match;
  return {
    expiryMs: Date.UTC(
      2000 + Number(expiry.slice(0, 2)),
      Number(expiry.slice(2, 4)) - 1,
      Number(expiry.slice(4, 6)),
      20,
    ),
    optionType: kind === 'P' ? 'put' as const : 'call' as const,
    strike: Number(strikeText) / 1000,
  };
}

function cboePremium(item: any): number | null {
  const bid = optionalNum(item.bid) ?? 0;
  const ask = optionalNum(item.ask) ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return optionalNum(item.last_trade_price) ?? optionalNum(item.theo) ?? optionalNum(item.prev_day_close);
}

function buildCboeExpiries(options: any[], spot: number): OptionExpiry[] {
  const grouped = new Map<number, OptionRow[]>();
  for (const item of options) {
    const parsed = parseCboeOptionSymbol(String(item.option || ''));
    if (!parsed) continue;
    const openInterest = optionalNum(item.open_interest);
    const volume = optionalNum(item.volume);
    const bid = num(item.bid);
    const ask = num(item.ask);
    const last = optionalNum(item.last_trade_price);
    // CBOE returns many empty strikes for giants such as SPY; keep the chain readable.
    if (!(openInterest ?? 0) && !(volume ?? 0) && !bid && !ask && !(last ?? 0)) continue;

    const mark = cboePremium(item);
    const spreadPct = bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
    const gamma = optionalNum(item.gamma);
    // First-order dollar gamma for a 1% underlying move. Calls are dealer-positive
    // and puts dealer-negative in this common approximation.
    const gammaExposureUsd = gamma == null
      ? null
      : gamma === 0
        ? 0
        : openInterest == null
          ? null
          : gamma * openInterest * CONTRACT_MULTIPLIER * spot * spot * 0.01 * (parsed.optionType === 'call' ? 1 : -1);
    const row: OptionRow = {
      instrumentName: String(item.option),
      strike: parsed.strike,
      optionType: parsed.optionType,
      markPrice: mark,
      premiumUsd: mark,
      impliedVolPct: optionalNum(item.iv) == null ? null : optionalNum(item.iv)! * 100,
      bidPrice: bid,
      askPrice: ask,
      spreadPct,
      volume,
      volumeUsd: volume == null || mark == null ? null : volume * mark * CONTRACT_MULTIPLIER,
      openInterest,
      delta: item.delta == null ? undefined : num(item.delta),
      gammaExposureUsd,
    };
    const rows = grouped.get(parsed.expiryMs) || [];
    rows.push(row);
    grouped.set(parsed.expiryMs, rows);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 12)
    .map(([expiryMs, rows]) => buildExpiry(expiryMs, rows, spot));
}

export async function getEquityOptionsSnapshot(rawSymbol: string): Promise<OptionsSnapshot> {
  const symbol = normalizeEquitySymbol(rawSymbol);
  const cached = equityCache.get(symbol);
  if (cached && Date.now() - cached.ts < EQUITY_CACHE_TTL_MS) return cached.value;

  const response = await fetch(
    `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(response.status === 404 ? `CBOE 暂无 ${symbol} 期权数据` : `CBOE HTTP ${response.status}`);
  }
  const payload: any = await response.json();
  const data = payload?.data;
  if (!data?.current_price || !Array.isArray(data.options)) throw new Error(`CBOE 返回的 ${symbol} 数据不完整`);

  const expiries = buildCboeExpiries(data.options, Number(data.current_price));
  if (!expiries.length) throw new Error(`${symbol} 暂无有持仓或报价的期权链`);
  const totalCallOpenInterest = completeSum(expiries, expiry => expiry.callOpenInterest);
  const totalPutOpenInterest = completeSum(expiries, expiry => expiry.putOpenInterest);
  const fetchedAt = new Date().toISOString();
  const value: OptionsSnapshot = {
    source: 'CBOE Delayed Quotes',
    market: 'us_equity',
    asset: symbol,
    fetchedAt,
    spot: Number(data.current_price),
    ivTermStructure: buildOptionIvTermStructure(expiries, Number(data.current_price), 'CBOE Delayed Quotes', fetchedAt),
    totalCallOpenInterest,
    totalPutOpenInterest,
    totalPutCallOIRatio: totalCallOpenInterest != null && totalPutOpenInterest != null && totalCallOpenInterest > 0
      ? totalPutOpenInterest / totalCallOpenInterest : null,
    quote: {
      change: num(data.price_change),
      changePercent: num(data.price_change_percent),
      volume: optionalNum(data.volume),
      iv30Pct: data.iv30 == null ? undefined : num(data.iv30),
      bid: data.bid == null ? undefined : num(data.bid),
      ask: data.ask == null ? undefined : num(data.ask),
    },
    expiries,
  };
  if (equityCache.size >= 8) {
    const oldestKey = equityCache.keys().next().value;
    if (oldestKey) equityCache.delete(oldestKey);
  }
  equityCache.set(symbol, { ts: Date.now(), value });
  return value;
}
