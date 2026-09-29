import { MARKET_IDS, type MarketId } from './research-contracts';

export type MarketChangeKind = 'price-change' | 'event' | 'news' | '13f-change' | 'signal' | 'source-outage' | 'source-recovery' | 'source-failure';

export interface MarketChangeRecord {
  id: string;
  dedupeKey?: string;
  market: MarketId;
  instrument?: string;
  kind: MarketChangeKind;
  title: string;
  summary?: string;
  source?: string;
  sourceUrl?: string;
  occurredAt?: string;
  publishedAt?: string;
  observedAt: string;
  evidenceRefs?: string[];
  dataStatus?: string;
  private?: boolean;
  [key: string]: unknown;
}

function validDate(value: unknown): number | null {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch { return undefined; }
}

function safeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap(item => {
    if (typeof item !== 'string') return [];
    const raw = item.trim();
    const url = safeUrl(raw);
    if (url) return [url];
    return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(raw) ? [raw] : [];
  }))].slice(0, 10);
}

function marketIdentityIsPlausible(market: MarketId, instrument: string): boolean {
  const value = instrument.trim();
  if (!value) return false;
  if (market === 'stocks') return /^stock:(us|hk|sh|sz|bj):[^:]+$/i.test(value) || /^us[A-Z][A-Z0-9.-]*$/i.test(value);
  if (market === 'options') return /^(option|usoption):/i.test(value);
  if (market === 'crypto') return /^(crypto|binance):/i.test(value);
  return /^(prediction|predict|market):/i.test(value);
}

export function buildMarketChangeDigest(input: {
  records: MarketChangeRecord[];
  watchlist: string[];
  since: string;
  limit?: number;
}): MarketChangeRecord[] {
  const since = validDate(input.since);
  if (since == null) throw new Error('摘要起始时间无效');
  const watched = new Set(input.watchlist.map(value => String(value || '').trim()).filter(Boolean));
  const seen = new Set<string>();
  const records = input.records.flatMap(record => {
    if (!record || !MARKET_IDS.includes(record.market) || record.private) return [];
    if (!record.id || !record.title || !validDate(record.observedAt) || validDate(record.observedAt)! < since) return [];
    if (!['price-change', 'event', 'news', '13f-change', 'signal', 'source-outage', 'source-recovery', 'source-failure'].includes(record.kind)) return [];
    const marketWideFault = record.kind === 'source-outage' || record.kind === 'source-recovery';
    if (marketWideFault) {
      if (record.instrument) return [];
    } else if (!record.instrument || !marketIdentityIsPlausible(record.market, record.instrument) || !watched.has(record.instrument)) {
      return [];
    }
    const key = `${record.market}:${record.kind}:${record.dedupeKey || record.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const sourceUrl = safeUrl(record.sourceUrl);
    const evidenceRefs = safeEvidenceRefs(record.evidenceRefs);
    return [{ ...record, ...(sourceUrl ? { sourceUrl } : { sourceUrl: undefined }), evidenceRefs }];
  });
  return records.sort((left, right) => (validDate(right.observedAt) || 0) - (validDate(left.observedAt) || 0))
    .slice(0, Math.max(1, Math.min(100, Math.trunc(input.limit || 40))));
}

export interface EvidencePriceSnapshot {
  id: string;
  market: MarketId;
  instrument?: string;
  source: string | { id?: string; name?: string; url?: string | null };
  fetchedAt: string;
  fields?: Record<string, unknown>;
  price?: number;
  dataStatus?: string;
}

function snapshotPrice(snapshot: EvidencePriceSnapshot): number | null {
  const candidate = snapshot.price ?? snapshot.fields?.price ?? snapshot.fields?.lastPrice ?? snapshot.fields?.close;
  const value = Number(candidate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sourceIdentity(source: EvidencePriceSnapshot['source']): string {
  return typeof source === 'string' ? source.trim() : String(source.id || source.name || '').trim();
}

export function calculateEvidencePriceChanges(
  snapshots: EvidencePriceSnapshot[],
  input: { since: string; watchlist: string[]; minimumChangePct?: number },
): MarketChangeRecord[] {
  const since = validDate(input.since);
  if (since == null) throw new Error('摘要起始时间无效');
  const watched = new Set(input.watchlist.map(value => String(value || '').trim()).filter(Boolean));
  const groups = new Map<string, EvidencePriceSnapshot[]>();
  for (const item of snapshots) {
    if (!item || !MARKET_IDS.includes(item.market) || !item.instrument || !watched.has(item.instrument)) continue;
    if (!marketIdentityIsPlausible(item.market, item.instrument)) continue;
    if (item.dataStatus === 'failed' || item.dataStatus === 'unavailable' || item.dataStatus === 'unsupported' || item.dataStatus === 'empty') continue;
    const source = sourceIdentity(item.source);
    const captured = validDate(item.fetchedAt);
    if (!source || captured == null) continue;
    const key = `${item.market}\u0000${item.instrument}\u0000${source}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const records: MarketChangeRecord[] = [];
  for (const rows of groups.values()) {
    const ordered = rows.slice().sort((left, right) => (validDate(left.fetchedAt) || 0) - (validDate(right.fetchedAt) || 0));
    const current = ordered.filter(item => (validDate(item.fetchedAt) || 0) >= since).at(-1);
    const previous = ordered.filter(item => (validDate(item.fetchedAt) || 0) < since).at(-1);
    if (!current || !previous || current.id === previous.id) continue;
    const before = snapshotPrice(previous);
    const after = snapshotPrice(current);
    if (before == null || after == null) continue;
    const changePct = (after - before) / before * 100;
    if (Math.abs(changePct) < (input.minimumChangePct ?? 0.1)) continue;
    const source = sourceIdentity(current.source);
    const sign = changePct > 0 ? '+' : '';
    records.push({
      id: `price:${current.market}:${current.instrument}:${current.id}`,
      dedupeKey: `price:${current.market}:${current.instrument}:${source}:${current.fetchedAt}`,
      market: current.market,
      instrument: current.instrument,
      kind: 'price-change',
      title: '行情变化',
      summary: `${before} → ${after} (${sign}${changePct.toFixed(2)}%)`,
      source,
      observedAt: current.fetchedAt,
      evidenceRefs: [previous.id, current.id],
      previousValue: before,
      currentValue: after,
      changePct: Number(changePct.toFixed(4)),
    });
  }
  return records;
}
