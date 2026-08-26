import type { PredictionMarket } from './prediction-radar';
import type { ForecastLabReport } from './forecast-lab';

export interface ResearchBriefingPaper {
  equity: number;
  cashBalance: number;
  openPositionsValue: number;
  totalPnl: number;
  winRate: number;
  openCount: number;
  closedCount: number;
  maxDrawdownPct: number;
}

export interface ResearchBriefingMetrics {
  var95Usd: number;
  profitFactor: number;
}

export interface ResearchBriefingFocus {
  id: string;
  platform: string;
  titleZh: string;
  title: string;
  url?: string;
  categoryZh?: string;
  marketPct: number;
  modelPct: number;
  edgePct: number;
  confidencePct: number;
  liquidityUsd: number;
  volume24hUsd: number;
  endDate?: string;
  dueLabelZh: string;
  reasonZh: string;
}

export interface DailyResearchBriefing {
  dateKey: string;
  dateLabelZh: string;
  generatedAt: string;
  headlineZh: string;
  radarReady: boolean;
  focusMarkets: ResearchBriefingFocus[];
  risk: {
    levelZh: '稳健' | '观察' | '偏高' | '未开始';
    headlineZh: string;
    adviceZh: string;
    metrics: ResearchBriefingPaper & { var95Usd: number; profitFactor: number };
  };
  forecastLab: {
    evaluatedSamples: number;
    modelBrier: number;
    marketBrier: number;
    modelEdgePct: number;
    verdictZh: string;
    bestGroupZh: string;
  };
  checklistZh: string[];
  noteZh: string;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shanghaiDateParts(date = new Date()): { key: string; label: string } {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'long',
  }).format(date);
  const [year, month, day] = key.split('-');
  return { key, label: `${year}年${Number(month)}月${Number(day)}日 · ${weekday}` };
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

/**
 * Build a fast, local-only morning brief from snapshots that the app already
 * keeps warm. It intentionally avoids network calls so the home page remains
 * responsive even when external prediction APIs are slow.
 */
export function buildDailyResearchBriefing(input: {
  markets: PredictionMarket[];
  radarReady: boolean;
  paper: ResearchBriefingPaper;
  metrics: ResearchBriefingMetrics;
  forecastLab: ForecastLabReport;
}): DailyResearchBriefing {
  const now = new Date();
  const date = shanghaiDateParts(now);
  const focus = input.markets
    .map(market => {
      const marketPct = clamp((market.yesPrice || 0) * 100, 0, 100);
      const modelPct = clamp((market.modelProbability ?? (market.yesPrice || 0)) * 100, 0, 100);
      const edgePct = Math.abs(modelPct - marketPct);
      const endDays = market.endDate ? Math.ceil((new Date(market.endDate).getTime() - now.getTime()) / 86_400_000) : 99;
      const deadlineFactor = endDays < 0 || endDays > 45 ? 0 : endDays <= 7 ? 1.25 : endDays <= 21 ? 1 : 0.72;
      const liquidityFactor = market.liquidity >= 10_000 ? 1 : market.liquidity >= 2_000 ? 0.78 : 0.35;
      const volumeFactor = market.volume24h >= 5_000 ? 1 : market.volume24h >= 500 ? 0.82 : 0.42;
      const score = edgePct * 2.4
        + Number(market.activityScore || 0) * 7
        + clamp(Number(market.probabilityConfidence || 0), 0, 100) * 0.16
        + (market.internalEdge > 0.005 ? 6 : 0);
      return {
        market,
        marketPct,
        modelPct,
        edgePct,
        score: score * deadlineFactor * liquidityFactor * volumeFactor,
      };
    })
    .filter(row => row.edgePct > 0.4 && row.score > 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(row => {
      const item = row.market;
      const reasons: string[] = [`系统与市场相差 ${round(row.edgePct, 1)} 个点`];
      if ((item.probabilityConfidence || 0) >= 70) reasons.push(`系统信心 ${Math.round(item.probabilityConfidence)}%`);
      if (item.volume24h >= 5_000) reasons.push(`24H 成交 ${item.volume24h >= 100_000 ? '$' + round(item.volume24h / 100_000, 1) + '万' : '$' + Math.round(item.volume24h)}`);
      if (row.edgePct >= 18) reasons.push('差距偏大，先人工核对事件定义');
      if (item.spread != null && item.spread > 0.05) reasons.push('价差较宽');
      return {
        id: `${item.platform}:${item.id}`,
        platform: item.platform,
        titleZh: item.titleZh || item.title,
        title: item.title,
        url: item.url,
        categoryZh: item.categoryZh,
        marketPct: Math.round(row.marketPct),
        modelPct: Math.round(row.modelPct),
        edgePct: round(row.edgePct, 1),
        confidencePct: Math.round(item.probabilityConfidence || 0),
        liquidityUsd: round(item.liquidity || 0, 0),
        volume24hUsd: round(item.volume24h || 0, 0),
        endDate: item.endDate,
        dueLabelZh: dueLabel(item.endDate),
        reasonZh: reasons.join(' · '),
      };
    });

  const drawdown = Number(input.paper.maxDrawdownPct || 0);
  const riskLevel: DailyResearchBriefing['risk']['levelZh'] =
    input.paper.closedCount === 0 && input.paper.openCount === 0 ? '未开始'
      : drawdown >= 18 || input.metrics.var95Usd <= -input.paper.equity * 0.08 ? '偏高'
        : drawdown >= 9 || input.paper.totalPnl < 0 ? '观察' : '稳健';
  const riskAdvice = riskLevel === '未开始'
    ? '先用模拟盘和小额研究记录积累样本，不要急着放大仓位。'
    : riskLevel === '偏高'
      ? '回撤或尾部风险偏高，新机会只做观察，优先降低已有敞口。'
      : riskLevel === '观察'
        ? '风险可控但需要留意回撤，单仓保持小额，避免同一主题重复押注。'
        : '当前风险状态稳健，可按既有规则继续跟踪，但不要放松结算规则核对。';

  const labGroups = [...(input.forecastLab.groups || [])]
    .filter(group => group.samples >= 5)
    .sort((a, b) => a.modelBrier - b.modelBrier);
  const bestGroup = labGroups[0];
  const focusText = focus.length
    ? `今日有 ${focus.length} 个值得先看的研究对象，重点是${focus[0].titleZh}。`
    : input.radarReady
      ? '当前快照中没有足够突出的分歧机会，更适合观察和积累校准样本。'
      : '预测雷达还在准备首次快照；本简报稍后刷新会自动补上重点。';

  return {
    dateKey: date.key,
    dateLabelZh: date.label,
    generatedAt: now.toISOString(),
    headlineZh: focusText,
    radarReady: input.radarReady,
    focusMarkets: focus,
    risk: {
      levelZh: riskLevel,
      headlineZh: `模拟净值 $${round(input.paper.equity)} · 总盈亏 ${input.paper.totalPnl >= 0 ? '+' : ''}$${round(input.paper.totalPnl)} · 最大回撤 ${round(drawdown, 1)}%`,
      adviceZh: riskAdvice,
      metrics: {
        ...input.paper,
        equity: round(input.paper.equity),
        cashBalance: round(input.paper.cashBalance),
        openPositionsValue: round(input.paper.openPositionsValue),
        totalPnl: round(input.paper.totalPnl),
        winRate: round(input.paper.winRate * 100, 1),
        maxDrawdownPct: round(drawdown, 1),
        var95Usd: round(input.metrics.var95Usd),
        profitFactor: round(input.metrics.profitFactor),
      },
    },
    forecastLab: {
      evaluatedSamples: input.forecastLab.evaluatedSamples || 0,
      modelBrier: round(input.forecastLab.model?.brier || 0, 3),
      marketBrier: round(input.forecastLab.market?.brier || 0, 3),
      modelEdgePct: round(input.forecastLab.modelEdgePct || 0, 1),
      verdictZh: input.forecastLab.verdictZh || '样本还不足，继续让策略实验室记录快照。',
      bestGroupZh: bestGroup
        ? `当前表现较好的方向是「${bestGroup.name}」，模型 Brier ${round(bestGroup.modelBrier, 3)}。`
        : '分组样本还不够，暂不评选优势方向。',
    },
    checklistZh: [
      '核对事件定义、结算来源和截止时区',
      '确认流动性、买卖价差是否容得下研究仓位',
      '用凯利分数和单仓上限约束金额',
      focus.some(item => item.edgePct >= 18)
        ? '高分歧标的先查延迟、规则陷阱和跨平台含义'
        : '记录入场理由，方便到期后复盘',
    ],
    noteZh: '这是自动整理的研究起点，不是投资建议；所有机会仍需人工核对后决定。',
  };
}
