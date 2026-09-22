import crypto from 'node:crypto';
import { assertMarketContext, MARKET_IDS, type MarketId } from './research-contracts';

export interface EventEntity {
  id: string;
  market: MarketId;
  instrument: string;
  kind: 'event' | 'news';
  title: string;
  normalizedTitle: string;
  occurredAt: string;
  publishedAt: string | null;
  retrievedAt: string;
  asOf: string;
  source: { name: string | null; url: string | null };
}

export interface EventCluster {
  id: string;
  market: MarketId;
  instrument: string;
  title: string;
  normalizedTitle: string;
  firstAt: string;
  lastAt: string;
  evidenceCount: number;
  evidenceIds: string[];
  sources: Array<{ name: string | null; url: string | null }>;
  kinds: Array<'event' | 'news'>;
}

interface TimelineRow {
  kind?: unknown;
  at?: unknown;
  occurredAt?: unknown;
  publishedAt?: unknown;
  retrievedAt?: unknown;
  asOf?: unknown;
  title?: unknown;
  source?: unknown;
  url?: unknown;
}

function text(value: unknown): string { return String(value ?? '').trim(); }

export function normalizeEventTitle(value: unknown): string {
  return text(value)
    .toLocaleLowerCase()
    .replace(/[“”"'‘’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function entityHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function isoOrNull(value: unknown): string | null {
  const parsed = new Date(text(value));
  return text(value) && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function buildEventEntities(rows: TimelineRow[], context: { market: MarketId; instrument: string; retrievedAt?: string; asOf?: string }): EventEntity[] {
  assertMarketContext({ market: context.market, workspace: 'event-intelligence', instrument: context.instrument });
  if (!Array.isArray(rows)) return [];
  const defaultRetrievedAt = isoOrNull(context.retrievedAt) || new Date().toISOString();
  const defaultAsOf = isoOrNull(context.asOf) || defaultRetrievedAt;
  return rows.map((row): EventEntity | null => {
    const title = text(row.title);
    const parsedAt = new Date(text(row.occurredAt || row.at));
    if (!title || !Number.isFinite(parsedAt.getTime())) return null;
    const occurredAt = parsedAt.toISOString();
    const publishedAt = isoOrNull(row.publishedAt);
    const retrievedAt = isoOrNull(row.retrievedAt) || defaultRetrievedAt;
    const asOf = isoOrNull(row.asOf) || defaultAsOf;
    const kind = row.kind === 'event' ? 'event' : 'news';
    const normalizedTitle = normalizeEventTitle(title);
    if (!normalizedTitle) return null;
    const sourceName = text(row.source) || null;
    const url = safeUrl(row.url);
    const id = `event_${entityHash({ market: context.market, instrument: context.instrument, kind, title, occurredAt, publishedAt, sourceName, url })}`;
    return { id, market: context.market, instrument: context.instrument, kind, title, normalizedTitle, occurredAt, publishedAt, retrievedAt, asOf, source: { name: sourceName, url } };
  }).filter((row): row is EventEntity => row !== null);
}

export function clusterEventEntities(entities: EventEntity[]): EventCluster[] {
  const groups = new Map<string, EventEntity[]>();
  for (const entity of entities) {
    if (!MARKET_IDS.includes(entity.market)) throw new Error('Invalid event market');
    assertMarketContext({ market: entity.market, workspace: 'event-intelligence', instrument: entity.instrument });
    const day = entity.occurredAt.slice(0, 10);
    const key = `${entity.market}|${entity.instrument}|${entity.normalizedTitle}|${day}`;
    const group = groups.get(key) || [];
    group.push(entity);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const sorted = [...group].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const first = sorted[0];
    const sources = [...new Map(sorted.map(item => [`${item.source.name || ''}|${item.source.url || ''}`, item.source])).values()];
    return {
      id: `cluster_${entityHash({ market: first.market, instrument: first.instrument, normalizedTitle: first.normalizedTitle, day: first.occurredAt.slice(0, 10) })}`,
      market: first.market,
      instrument: first.instrument,
      title: first.title,
      normalizedTitle: first.normalizedTitle,
      firstAt: sorted[0].occurredAt,
      lastAt: sorted[sorted.length - 1].occurredAt,
      evidenceCount: sorted.length,
      evidenceIds: sorted.map(item => item.id),
      sources,
      kinds: [...new Set(sorted.map(item => item.kind))],
    };
  }).sort((left, right) => right.lastAt.localeCompare(left.lastAt));
}
