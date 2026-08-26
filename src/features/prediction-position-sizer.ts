export interface PredictionPositionInput {
  yesPrice: number;
  noPrice?: number;
  modelProbability: number;
  confidence?: number;
  liquidity?: number;
  volume24h?: number;
  spread?: number;
  bankroll: number;
  kellyFraction?: number;
  maxPositionPct?: number;
  minEdgePct?: number;
}

export interface PredictionPositionResult {
  side: 'YES' | 'NO' | 'NONE';
  sidePrice: number;
  sideProbability: number;
  edgePct: number;
  fullKellyPct: number;
  suggestedAmountUsd: number;
  maxLossUsd: number;
  expectedProfitUsd: number;
  winPayoutUsd: number;
  shares: number;
  riskPct: number;
  verdictZh: string;
  warningsZh: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function probability(value: unknown, fallback = 0.5): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Size a binary prediction-market position from the radar's pre-event model
 * probability. The result is research guidance, not an order recommendation:
 * low confidence, thin liquidity, and wide spreads all reduce the stake.
 */
export function calculatePredictionPosition(input: PredictionPositionInput): PredictionPositionResult {
  const yesPrice = probability(input.yesPrice);
  const noPrice = input.noPrice == null ? 1 - yesPrice : probability(input.noPrice);
  const modelProbability = probability(input.modelProbability);
  const confidence = clamp(nonNegativeNumber(input.confidence, 50), 0, 100);
  const bankroll = positiveNumber(input.bankroll, 0);
  const kellyFraction = clamp(positiveNumber(input.kellyFraction, 0.25), 0.01, 1);
  const maxPositionPct = clamp(positiveNumber(input.maxPositionPct, 10), 0.1, 100);
  const minEdgePct = clamp(positiveNumber(input.minEdgePct, 4), 0, 40);
  const liquidity = nonNegativeNumber(input.liquidity, 0);
  const volume24h = nonNegativeNumber(input.volume24h, 0);
  const spread = nonNegativeNumber(input.spread, 0);

  const yesEdgePct = (modelProbability - yesPrice) * 100;
  const noEdgePct = ((1 - modelProbability) - noPrice) * 100;
  const side: PredictionPositionResult['side'] =
    Math.max(yesEdgePct, noEdgePct) < minEdgePct || bankroll <= 0 ? 'NONE'
      : yesEdgePct >= noEdgePct ? 'YES' : 'NO';

  const sidePrice = side === 'YES' ? yesPrice : side === 'NO' ? noPrice : Math.min(yesPrice, noPrice);
  const sideProbability = side === 'YES' ? modelProbability
    : side === 'NO' ? 1 - modelProbability
      : Math.min(modelProbability, 1 - modelProbability);
  const edgePct = side === 'YES' ? yesEdgePct : side === 'NO' ? noEdgePct : 0;

  const warningsZh: string[] = [];
  if (side !== 'NONE') {
    if (confidence < 60) warningsZh.push(`系统信心偏低（${Math.round(confidence)}%），仓位已更保守。`);
    if (liquidity < 5_000) warningsZh.push(`流动性偏低（$${round(liquidity, 0)}），进出场成本可能变高。`);
    if (spread > 0.05) warningsZh.push(`买卖价差偏宽（${(spread * 100).toFixed(1)}%），实际成交可能吃掉优势。`);
    if (volume24h < 1_000) warningsZh.push(`24H 成交偏低（$${round(volume24h, 0)}），价格信号可靠性较弱。`);
    if (edgePct >= 18) warningsZh.push('模型优势异常大，可能是数据延迟或模型误读，先人工核对事件定义。');
    if (sidePrice > 0.95) warningsZh.push('赔率已经非常拥挤，小概率反转也会造成较大回撤。');
  }

  // For a $1-settled binary contract, full Kelly is (p - cost) / (1 - cost).
  const fullKelly = side === 'NONE' || sidePrice >= 1 ? 0 : (sideProbability - sidePrice) / (1 - sidePrice);
  const confidenceFactor = side === 'NONE' ? 0 : clamp(0.35 + confidence / 125, 0.35, 1);
  const riskPenalty = (liquidity < 5_000 ? 0.65 : 1) * (spread > 0.05 ? 0.7 : 1)
    * (volume24h < 1_000 ? 0.8 : 1);
  const adjustedKellyPct = Math.max(0, fullKelly) * kellyFraction * confidenceFactor * riskPenalty;
  let amount = bankroll * Math.min(adjustedKellyPct, maxPositionPct / 100);
  amount = Math.max(0, Math.floor(amount * 100) / 100);

  let verdictZh: string;
  if (bankroll <= 0) verdictZh = '请先输入可用研究资金。';
  else if (side === 'NONE') verdictZh = `系统与市场价差距小于 ${minEdgePct}%，暂不建议建立方向仓位。`;
  else if (amount <= 0) verdictZh = '凯利结果为负或过小，当前更适合观察。';
  else if (fullKelly <= 0) verdictZh = '没有正期望优势，只做研究跟踪，不建议下单。';
  else verdictZh = `${side === 'YES' ? '偏 YES' : '偏 NO'}，建议小额研究仓；事件定义和截止规则仍需人工核对。`;

  const shares = sidePrice > 0 ? amount / sidePrice : 0;
  return {
    side,
    sidePrice: round(sidePrice, 4),
    sideProbability: round(sideProbability, 4),
    edgePct: round(edgePct, 2),
    fullKellyPct: round(Math.max(0, fullKelly) * 100, 2),
    suggestedAmountUsd: round(amount, 2),
    maxLossUsd: round(amount, 2),
    expectedProfitUsd: round(amount * (sideProbability / sidePrice - 1), 2),
    winPayoutUsd: round(shares, 2),
    shares: round(shares, 2),
    riskPct: round(bankroll > 0 ? amount / bankroll * 100 : 0, 2),
    verdictZh,
    warningsZh,
  };
}
