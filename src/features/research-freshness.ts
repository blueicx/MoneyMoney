type Market = 'stocks' | 'options' | 'crypto' | 'prediction';

export interface ResearchFreshnessInput {
  market: Market;
  instrument?: string;
  timeframe?: string;
  createdAt: string;
  dataSnapshotHash?: string;
  strategyId?: string;
  strategyVersion?: string;
  currentStrategyVersion?: string;
  revisions?: Array<{ market: string; instrument: string; timeframe?: string; dataset?: string; publishedAt: string; contentHash: string }>;
  corporateActions?: Array<{ market: string; instrument: string; effectiveAt: string; kind: string }>;
}

function stockSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/^STOCK:(US|NASDAQ|NYSE):/, '').replace(/^US(?=[A-Z])/, '');
}

export function assessResearchFreshness(input: ResearchFreshnessInput) {
  const createdAt = Date.parse(input.createdAt);
  if (!Number.isFinite(createdAt)) throw new Error('Research freshness requires a valid createdAt');
  if (input.dataSnapshotHash && !/^[a-f0-9]{64}$/i.test(input.dataSnapshotHash)) throw new Error('Research snapshot hash must be SHA-256 hex');
  const findings: Array<{ kind: 'data-revision' | 'corporate-action' | 'strategy-version'; at: string; detail: string; hash?: string }> = [];
  const instrument = String(input.instrument || '').trim();
  const matchesInstrument = (candidate: string) => input.market === 'stocks'
    ? stockSymbol(candidate) === stockSymbol(instrument)
    : candidate.trim().toUpperCase() === instrument.toUpperCase();

  for (const revision of input.revisions || []) {
    const publishedAt = Date.parse(revision.publishedAt);
    if (revision.market !== input.market || !instrument || !matchesInstrument(revision.instrument)) continue;
    if (input.timeframe && revision.timeframe && revision.timeframe !== input.timeframe) continue;
    if (!Number.isFinite(publishedAt) || publishedAt <= createdAt) continue;
    findings.push({ kind: 'data-revision', at: new Date(publishedAt).toISOString(), detail: `${revision.dataset || '数据'}在研究创建后发布了新版本`, hash: revision.contentHash });
  }
  if (input.market === 'stocks' && instrument) {
    for (const action of input.corporateActions || []) {
      const effectiveAt = Date.parse(action.effectiveAt);
      if (action.market !== 'stocks' || !matchesInstrument(action.instrument) || !Number.isFinite(effectiveAt) || effectiveAt <= createdAt) continue;
      findings.push({ kind: 'corporate-action', at: new Date(effectiveAt).toISOString(), detail: `研究创建后生效的公司行动：${action.kind}` });
    }
  }
  if (input.strategyVersion && input.currentStrategyVersion && input.strategyVersion !== input.currentStrategyVersion) {
    findings.push({ kind: 'strategy-version', at: new Date().toISOString(), detail: `策略版本已从 ${input.strategyVersion} 更新为 ${input.currentStrategyVersion}` });
  }
  const status = findings.length ? 'stale' : input.dataSnapshotHash ? 'current' : 'unknown';
  const reason = status === 'stale'
    ? '发现研究创建后发布的数据、公司行动或策略版本变化；建议人工检查并复跑。'
    : status === 'current'
      ? '已固定数据快照，未发现创建后匹配的修订或策略版本变化。'
      : '实验未固定数据快照，无法证明其输入数据仍与当前版本一致。';
  return { status, reason, findings };
}
