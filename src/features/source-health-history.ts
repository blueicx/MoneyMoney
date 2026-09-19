import type { SourceHealthReport } from './source-health';

export interface SourceHealthTransition {
  id: string;
  market: string;
  sourceId: string;
  sourceName: string;
  kind: 'outage' | 'recovery' | 'degraded';
  from: string;
  to: string;
  at: string;
  detail: string;
  affectedCapabilities: string[];
}

function status(item: SourceHealthReport['items'][number] | undefined): string {
  if (!item) return 'unknown';
  return item.ok ? 'live' : String(item.status || 'unavailable');
}

export function buildSourceHealthTransitions(market: string, previous: SourceHealthReport | null | undefined, current: SourceHealthReport): SourceHealthTransition[] {
  if (!previous) return [];
  const before = new Map(previous.items.map(item => [item.id, item]));
  return current.items.flatMap(item => {
    const old = before.get(item.id);
    if (!old || status(old) === status(item)) return [];
    const kind: SourceHealthTransition['kind'] = item.ok ? 'recovery' : old.ok ? 'outage' : 'degraded';
    return [{
      id: `${market}:${item.id}:${current.updatedAt}:${kind}`,
      market,
      sourceId: item.id,
      sourceName: item.name,
      kind,
      from: status(old),
      to: status(item),
      at: current.updatedAt,
      detail: item.ok ? `${item.name} 已恢复：${item.detail}` : `${item.name} 故障：${item.detail}`,
      affectedCapabilities: [...(item.capabilities || [])],
    }];
  });
}
