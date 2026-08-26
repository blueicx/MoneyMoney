import type { AssistantPaperTrade } from './assistant-journal';
import type { AssistantAction, AssistantCautionFlag } from './trade-assistant';
import type { PredictionMarket } from './prediction-radar';
import type { PaperPortfolio } from './paper-trading';

export interface RiskOverviewReportInput {
  journal?: {
    openTrades?: Array<Pick<AssistantPaperTrade, 'venue' | 'confidencePct' | 'title' | 'symbol'>>;
  };
  regime: {
    labelZh: string;
  };
  context?: {
    crossAssetRisk?: {
      riskScore: number;
    };
    cautionFlags?: AssistantCautionFlag[];
  };
  cryptoActions?: AssistantAction[];
  stockActions?: AssistantAction[];
  macroActions?: AssistantAction[];
  sectorActions?: AssistantAction[];
  predictionPicks?: AssistantAction[];
  optionActions?: AssistantAction[];
}

export interface RiskRadarWatch {
  id: string;
  marketId: string;
  platform: string;
  watchToken: string;
  titleZh: string;
  title: string;
  url?: string;
  categoryZh?: string;
  marketPct: number;
  modelPct: number;
  edgePct: number;
  confidencePct: number;
  dueLabelZh: string;
  reasonZh: string;
}

export interface RiskActionSignal {
  id: string;
  venueZh: string;
  title: string;
  directionZh: string;
  confidencePct: number;
  riskPct: number;
  horizon: string;
}

export interface RiskCautionCard {
  id: string;
  severityZh: string;
  titleZh: string;
  adviceZh: string;
}

export interface RiskThemeCluster {
  themeZh: string;
  count: number;
  exposureUsd: number;
  venuesZh: string[];
  samples: string[];
  adviceZh: string;
}

export interface RiskGroup {
  name: string;
  openCount: number;
  exposureUsd: number;
  avgConfidencePct: number;
}

export interface PortfolioRiskOverview {
  updatedAt: string;
  openCount: number;
  simulatedExposureUsd: number;
  paperEquityUsd: number;
  paperCashUsd: number;
  concentrationPct: number;
  largestGroup: string;
  winRatePct: number;
  var95Usd: number;
  profitFactor: number;
  regimeZh: string;
  marketRiskScore: number | null;
  highRiskFlags: number;
  riskLevelZh: '稳健' | '观察' | '偏高' | '危险';
  groups: RiskGroup[];
  recommendationsZh: string[];
  radarReady: boolean;
  radarCount: number;
  divergenceWatchCount: number;
  expiringSoonCount: number;
  highConvictionCount: number;
  bullishSignals: number;
  bearishSignals: number;
  signalBalanceZh: string;
  radarWatchlist: RiskRadarWatch[];
  actionSignals: RiskActionSignal[];
  cautions: RiskCautionCard[];
  themeClusters: RiskThemeCluster[];
  themeWarningZh: string | null;
  commandSummaryZh: string;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function dueLabel(endDate: string | undefined): string {
  if (!endDate) return '截止未公布';
  const time = new Date(endDate).getTime();
  if (!Number.isFinite(time)) return '截止未公布';
  const days = Math.ceil((time - Date.now()) / 86_400_000);
  if (days < 0) return '临近结算';
  if (days === 0) return '今日截止';
  if (days <= 7) return `${days} 天内`;
  return `${days} 天`;
}

function venueLabel(venue: AssistantAction['venue']): string {
  return venue === 'Binance' ? '币安' : venue === 'Stocks' ? '股票'
    : venue === 'Options' ? '期权' : venue === 'Macro' ? '宏观' : '预测市场';
}

function classifyRiskTheme(text: string): string | null {
  const value = text.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/btc|bitcoin|比特币/, '比特币'],
    [/eth|ethereum|以太坊/, '以太坊'],
    [/bnb|binance coin/, 'BNB'],
    [/sol|solana/, 'Solana'],
    [/xrp|ripple/, 'XRP'],
    [/doge/, 'Dogecoin'],
    [/\bai\b|artificial intelligence|gpt|claude|gemini|人工智能/, '人工智能'],
    [/\bfed\b|federal reserve|rate cut|rate decision|interest rate|降息|加息|美联储|利率/, '利率决议'],
    [/cpi|inflation|pce|通胀|通货膨胀/, '通胀'],
    [/recession|衰退/, '经济衰退'],
    [/election|选举|大选/, '选举'],
    [/war|ceasefire|invasion|战争|停火|冲突/, '地缘冲突'],
    [/temperature|rain|snow|hurricane|weather|温度|降雨|降雪|飓风|天气/, '天气'],
    [/gold|黄金/, '黄金'],
    [/oil|原油|brent|wti/, '原油'],
    [/nfl|nba|mlb|nhl|premier league|champions league|soccer|football|basketball|baseball|hockey|足球|篮球|棒球|冰球/, '体育赛事'],
  ];
  for (const [pattern, theme] of rules) {
    if (pattern.test(value)) return theme;
  }
  return null;
}

export function buildPortfolioRiskOverview(
  report: RiskOverviewReportInput,
  paper: PaperPortfolio & { equity: number; openPositionsValue: number },
  riskMetrics: { var95Usd: number; profitFactor: number; winRate: number },
  radar?: { ready: boolean; markets?: Array<Partial<PredictionMarket> & Pick<PredictionMarket, 'id'>> },
): PortfolioRiskOverview {
  const groups = new Map<string, RiskGroup>();
  const openExposures = [
    ...(report.journal?.openTrades || []).map(trade => ({
      venue: trade.venue,
      title: trade.title,
      symbol: trade.symbol,
      exposureUsd: 100,
    })),
    ...paper.positions.filter(item => item.status === 'OPEN').map(position => ({
      venue: 'Predict.fun' as const,
      title: position.marketTitle,
      symbol: '',
      exposureUsd: position.quantity * position.entryPrice,
    })),
  ];
  const add = (name: string, exposure: number, confidencePct: number): void => {
    const key = name || '其他';
    const current = groups.get(key) || { name: key, openCount: 0, exposureUsd: 0, avgConfidencePct: 0 };
    current.avgConfidencePct = ((current.avgConfidencePct * current.openCount) + confidencePct)
      / (current.openCount + 1);
    current.openCount += 1;
    current.exposureUsd += exposure;
    groups.set(key, current);
  };

  for (const exposure of openExposures) {
    add(exposure.venue, exposure.exposureUsd, 60);
  }

  const rows = [...groups.values()].sort((a, b) => b.exposureUsd - a.exposureUsd);
  const total = rows.reduce((sum, row) => sum + row.exposureUsd, 0);
  const largest = rows[0];
  const concentration = total ? largest.exposureUsd / total * 100 : 0;
  const marketRisk = report.context?.crossAssetRisk?.riskScore ?? null;
  const cautions = (report.context?.cautionFlags || []).map(item => ({
    id: item.id,
    severityZh: item.severityZh || (item.severity === 'high' ? '高' : item.severity === 'medium' ? '中' : '观察'),
    titleZh: item.titleZh,
    adviceZh: item.adviceZh,
  }));
  const highFlags = cautions.filter(item => item.severityZh === '高').length;

  const actionSources = [
    ...(report.cryptoActions || []),
    ...(report.stockActions || []),
    ...(report.macroActions || []),
    ...(report.sectorActions || []),
    ...(report.predictionPicks || []),
    ...(report.optionActions || []),
  ].filter(item => item.action !== 'WAIT');
  const actionSignals: RiskActionSignal[] = actionSources
    .sort((a, b) => b.confidencePct - a.confidencePct)
    .slice(0, 6)
    .map(item => ({
      id: `${item.venue}:${item.id}`,
      venueZh: venueLabel(item.venue),
      title: item.title,
      directionZh: item.action === 'BUY' ? '看多/买入' : item.action === 'SELL' ? '看空/回避' : '等待',
      confidencePct: Math.round(item.confidencePct),
      riskPct: Number(item.suggestedRiskPct || 0),
      horizon: item.horizon,
    }));
  const bullishSignals = actionSources.filter(item => item.action === 'BUY').length;
  const bearishSignals = actionSources.filter(item => item.action === 'SELL').length;
  const signalBalanceZh = !actionSources.length ? '暂无明确信号'
    : bullishSignals > bearishSignals * 2 ? '信号明显偏多'
      : bearishSignals > bullishSignals * 2 ? '信号明显偏空'
        : '多空相对均衡';

  const now = new Date();
  const radarMarkets = radar?.markets || [];
  const radarRows = radarMarkets.map(market => {
    const marketPct = clamp((market.yesPrice || 0) * 100);
    const modelPct = clamp((market.modelProbability ?? (market.yesPrice || 0)) * 100);
    const edgePct = Math.abs(modelPct - marketPct);
    const endDays = market.endDate ? Math.ceil((new Date(market.endDate).getTime() - now.getTime()) / 86_400_000) : 99;
    const deadlineFactor = endDays < 0 || endDays > 45 ? 0 : endDays <= 7 ? 1.25 : endDays <= 21 ? 1 : 0.72;
    const liquidityFactor = (market.liquidity || 0) >= 10_000 ? 1 : (market.liquidity || 0) >= 2_000 ? 0.78 : 0.35;
    const volumeFactor = (market.volume24h || 0) >= 5_000 ? 1 : (market.volume24h || 0) >= 500 ? 0.82 : 0.42;
    const score = edgePct * 2.4
      + Number(market.activityScore || 0) * 7
      + clamp(Number(market.probabilityConfidence || 0)) * 0.16
      + (Number(market.internalEdge || 0) > 0.005 ? 6 : 0);
    return {
      market,
      marketPct,
      modelPct,
      edgePct,
      endDays,
      score: score * deadlineFactor * liquidityFactor * volumeFactor,
    };
  }).filter(row => row.edgePct >= 8 && row.score > 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const radarWatchlist: RiskRadarWatch[] = radarRows.map(row => {
    const reasons: string[] = [`系统与市场相差 ${round(row.edgePct)} 个点`];
    if ((row.market.probabilityConfidence || 0) >= 70) reasons.push(`系统信心 ${Math.round(row.market.probabilityConfidence || 0)}%`);
    if (row.endDays <= 7) reasons.push('临近截止，先核对结算规则');
    if (row.edgePct >= 20) reasons.push('分歧偏大，注意定义差异');
    return {
      id: `${row.market.platform || 'Radar'}:${row.market.id}`,
      marketId: row.market.id,
      platform: row.market.platform || '未知平台',
      watchToken: (() => {
        let hash = 5381;
        const key = `${row.market.platform || 'Radar'}::${row.market.id}`;
        for (let index = 0; index < key.length; index++) {
          hash = ((hash * 33) ^ key.charCodeAt(index)) >>> 0;
        }
        return hash.toString(36);
      })(),
      titleZh: row.market.titleZh || row.market.title || '未命名研究对象',
      title: row.market.title || '',
      url: row.market.url,
      categoryZh: row.market.categoryZh,
      marketPct: Math.round(row.marketPct),
      modelPct: Math.round(row.modelPct),
      edgePct: round(row.edgePct),
      confidencePct: Math.round(row.market.probabilityConfidence || 0),
      dueLabelZh: dueLabel(row.market.endDate),
      reasonZh: reasons.join(' · '),
    };
  });
  const expiringSoonCount = radarMarkets.filter(market => {
    if (!market.endDate) return false;
    const time = new Date(market.endDate).getTime() - now.getTime();
    return time > 0 && time <= 7 * 86_400_000;
  }).length;
  const radarReady = !!radar?.ready;
  const themeMap = new Map<string, RiskThemeCluster>();
  for (const exposure of openExposures) {
    const theme = classifyRiskTheme(`${exposure.symbol} ${exposure.title}`);
    if (!theme) continue;
    const current = themeMap.get(theme) || {
      themeZh: theme,
      count: 0,
      exposureUsd: 0,
      venuesZh: [],
      samples: [],
      adviceZh: '',
    };
    current.count += 1;
    current.exposureUsd += exposure.exposureUsd;
    const venueZh = venueLabel(exposure.venue);
    if (!current.venuesZh.includes(venueZh)) current.venuesZh.push(venueZh);
    const sample = exposure.title || exposure.symbol || '未命名研究对象';
    if (current.samples.length < 3 && !current.samples.includes(sample)) current.samples.push(sample);
    themeMap.set(theme, current);
  }
  const themeClusters = [...themeMap.values()]
    .filter(item => item.count >= 2)
    .sort((a, b) => b.count - a.count || b.exposureUsd - a.exposureUsd)
    .slice(0, 6)
    .map(item => ({
      ...item,
      exposureUsd: round(item.exposureUsd, 2),
      adviceZh: item.count >= 3
        ? '重复暴露偏高：先区分这些事件是否真的同涨同跌，再决定是否继续加仓。'
        : '已有主题重叠：新增仓前先确认它带来的是新风险，还是同一个风险的另一层。',
    }));
  const biggestTheme = themeClusters[0];
  const level: PortfolioRiskOverview['riskLevelZh'] =
    highFlags >= 2 || concentration >= 75 || (marketRisk != null && marketRisk < 28) ? '危险'
      : highFlags === 1 || concentration >= 55 || (marketRisk != null && marketRisk < 42) ? '偏高'
        : concentration >= 35 ? '观察' : '稳健';

  const advice: string[] = [];
  if (!total) advice.push('当前没有跟踪中的模拟持仓，可先让助手积累纸面记录。');
  if (concentration >= 55 && largest) advice.push(`仓位集中在${largest.name}（${round(concentration)}%），新信号优先选择低相关资产。`);
  if (highFlags) advice.push(`有 ${highFlags} 条高风险提醒；先处理止损和临近结算持仓，再考虑新机会。`);
  if (marketRisk != null && marketRisk < 42) advice.push('跨资产风险评分偏防守，建议降低单笔风险或提高等待门槛。');
  if (riskMetrics.var95Usd < 0) advice.push(`历史模拟盘 95% VaR 为 $${round(Math.abs(riskMetrics.var95Usd), 2)}，避免用单笔大仓去修复回撤。`);
  if (!radarReady) advice.push('预测雷达快照还没就绪；先等首次扫描完成，再评估高分歧对象。');
  else if (expiringSoonCount) advice.push(`${expiringSoonCount} 个预测研究对象会在 7 天内截止，优先检查是否需要提前退出模拟仓。`);
  if (bullishSignals && bearishSignals && signalBalanceZh === '多空相对均衡') advice.push('助手信号多空并存，避免把相反方向都当成“确定性机会”。');
  if (biggestTheme) advice.push(`「${biggestTheme.themeZh}」出现 ${biggestTheme.count} 个重叠研究对象；表面分散，实际可能是同一主题集中。`);
  if (advice.length === 1) advice.push('当前集中度、市场风险和历史回撤都在可控范围内，可按原风险规则继续跟踪。');

  const summaryParts: string[] = [`${level}等级下共跟踪 ${rows.reduce((sum, row) => sum + row.openCount, 0)} 个研究仓位`];
  if (cautions.length) summaryParts.push(`${cautions.length} 条环境提醒`);
  if (radarWatchlist.length) summaryParts.push(`${radarWatchlist.length} 个高分歧关注对象`);
  if (themeClusters.length) summaryParts.push(`${themeClusters.length} 组主题重叠`);
  if (expiringSoonCount) summaryParts.push(`${expiringSoonCount} 个临近截止`);
  summaryParts.push(signalBalanceZh);

  return {
    updatedAt: new Date().toISOString(),
    openCount: rows.reduce((sum, row) => sum + row.openCount, 0),
    simulatedExposureUsd: round(total, 2),
    paperEquityUsd: round(paper.equity, 2),
    paperCashUsd: round(paper.cashBalance, 2),
    concentrationPct: round(concentration),
    largestGroup: largest?.name || '—',
    winRatePct: round(riskMetrics.winRate * 100),
    var95Usd: round(riskMetrics.var95Usd, 2),
    profitFactor: round(riskMetrics.profitFactor, 2),
    regimeZh: report.regime.labelZh,
    marketRiskScore: marketRisk == null ? null : Math.round(marketRisk),
    highRiskFlags: highFlags,
    riskLevelZh: level,
    groups: rows.map(row => ({
      ...row,
      exposureUsd: round(row.exposureUsd, 2),
      avgConfidencePct: round(row.avgConfidencePct),
    })),
    recommendationsZh: advice,
    radarReady,
    radarCount: radarMarkets.length,
    divergenceWatchCount: radarWatchlist.length,
    expiringSoonCount,
    highConvictionCount: actionSignals.filter(item => item.confidencePct >= 68).length,
    bullishSignals,
    bearishSignals,
    signalBalanceZh,
    radarWatchlist,
    actionSignals,
    cautions,
    themeClusters,
    themeWarningZh: biggestTheme
      ? `「${biggestTheme.themeZh}」重叠 ${biggestTheme.count} 个研究对象，敞口约 $${biggestTheme.exposureUsd}。`
      : null,
    commandSummaryZh: summaryParts.join(' · ') + '。',
  };
}
