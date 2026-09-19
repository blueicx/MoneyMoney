import type { MarketId } from './research-contracts';

const LABELS: Record<MarketId, string> = { stocks: '股票', options: '期权', crypto: '虚拟币', prediction: '预测市场' };

export function buildDecisionMobileSummary(input: {
  market: MarketId;
  evidence: Array<{ dataStatus?: string }>;
  openDecisions: number;
  signalQuality: { total: number; hitRate: number; warnings?: string[] };
  outages: number;
  deepLink?: string | null;
}): string {
  const live = input.evidence.filter(item => item.dataStatus === 'live').length;
  const cached = input.evidence.filter(item => ['cached', 'stale'].includes(String(item.dataStatus))).length;
  const warning = input.signalQuality.warnings?.[0] || '暂无质量警告';
  return [
    `<b>◇ ${LABELS[input.market]}可信决策</b>`,
    `证据：实时 ${live} · 缓存 ${cached} · 来源故障 ${input.outages}`,
    `决策：${input.openDecisions} 条待复盘`,
    `信号：${input.signalQuality.total} 个样本 · 命中率 ${(Number(input.signalQuality.hitRate || 0) * 100).toFixed(1)}%`,
    `提示：${warning}`,
    input.deepLink ? `工作台：${input.deepLink}` : '工作台：尚未配置安全公网地址',
  ].join('\n');
}
