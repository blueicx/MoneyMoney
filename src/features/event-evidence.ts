import { classifyEventResult, compareEventValues, type EventResultDirection } from './event-alerts';

export interface EventEvidence {
  id?: string;
  kind?: 'event' | 'news';
  date?: string;
  scope: string;
  instrumentId?: string | null;
  title: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: string | null;
  url: string | null;
  direction: EventResultDirection | 'unavailable';
}

export function buildEventEvidence(input: {
  scope: string;
  instrumentId?: string | null;
  title: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source?: string | null;
  url?: string | null;
}): EventEvidence {
  let direction: EventEvidence['direction'] = 'unavailable';

  if (input.actual != null) {
    const comparison = input.forecast != null
      ? compareEventValues(String(input.actual), String(input.forecast))
      : input.previous != null
        ? compareEventValues(String(input.actual), String(input.previous))
        : 'unknown';
    if (comparison !== 'unknown') direction = classifyEventResult(input.title, comparison);
  }

  return {
    scope: String(input.scope || '').trim(),
    instrumentId: input.instrumentId || null,
    title: String(input.title || '').trim(),
    actual: input.actual == null ? null : String(input.actual),
    forecast: input.forecast == null ? null : String(input.forecast),
    previous: input.previous == null ? null : String(input.previous),
    source: input.source ? String(input.source).trim() : null,
    url: input.url ? String(input.url).trim() : null,
    direction,
  };
}

export function matchesEventScope(item: { scope: string; instrumentId?: string | null }, scope: string, instrumentId?: string): boolean {
  if (item.scope !== scope) return false;
  if (instrumentId && item.instrumentId !== instrumentId) return false;
  return true;
}

export function filterTimelineItems<T extends { scope: string; instrumentId?: string | null }>(items: T[], scope: string, instrumentId?: string): T[] {
  return items.filter(item => matchesEventScope(item, scope, instrumentId));
}
