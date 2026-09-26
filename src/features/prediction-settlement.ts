import crypto from 'node:crypto';

export type SettlementPlatform = 'Kalshi' | 'Polymarket';
export type SettlementStatus = 'open' | 'closed' | 'settled' | 'unknown' | 'unavailable' | 'unsupported';

export interface SettlementEvidence {
  market: 'prediction';
  instrument: string;
  platform: SettlementPlatform;
  marketId: string;
  status: SettlementStatus;
  result: 'YES' | 'NO' | null;
  rulesText: string | null;
  rulesHash: string | null;
  resolutionSourceUrl: string | null;
  closeAt: string | null;
  determinationAt: string | null;
  settlementAt: string | null;
  determinationSourceUrl: string | null;
  resolutionEvidence: {
    conditionId: string | null;
    status: string | null;
    payouts: number[] | null;
    transactionHash: string | null;
    reporter: string | null;
    wasDisputed: boolean | null;
    wasArbitrated: boolean | null;
    resolvedBlock: number | null;
  } | null;
  capturedAt: string;
  sourceUrl: string;
  evidenceHash: string;
  reason: string | null;
}

interface StateDocumentStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, version?: number): void;
}

const STORE_KEY = 'prediction-settlement-evidence';

function sha256(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }

function validIso(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function explicitBinaryResult(payload: Record<string, unknown>): 'YES' | 'NO' | null {
  const raw = [payload.result, payload.resolutionResult, payload.winningOutcome, payload.resolvedOutcome]
    .find(value => typeof value === 'string');
  const normalized = String(raw || '').trim().toUpperCase();
  if (normalized === 'YES') return 'YES';
  if (normalized === 'NO') return 'NO';
  return null;
}

function parseStringArray(value: unknown): string[] | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed.map(item => item.trim()) : null;
}

function parsePayouts(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(item => typeof item === 'number' ? item : typeof item === 'string' && item.trim() ? Number(item) : NaN);
  return parsed.length > 0 && parsed.every(Number.isFinite) ? parsed : null;
}

function polymarketPayoutResult(outcomesValue: unknown, payoutsValue: unknown): 'YES' | 'NO' | null {
  const outcomes = parseStringArray(outcomesValue);
  const payouts = parsePayouts(payoutsValue);
  if (!outcomes || !payouts || outcomes.length !== 2 || payouts.length !== 2) return null;
  const yesIndex = outcomes.findIndex(value => value.toLowerCase() === 'yes');
  const noIndex = outcomes.findIndex(value => value.toLowerCase() === 'no');
  if (yesIndex < 0 || noIndex < 0 || yesIndex === noIndex) return null;
  if (payouts[yesIndex] === 1 && payouts[noIndex] === 0) return 'YES';
  if (payouts[yesIndex] === 0 && payouts[noIndex] === 1) return 'NO';
  return null;
}

function resolutionRow(payload: Record<string, unknown> | undefined, conditionId: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  const rows = Array.isArray(payload.data) ? payload.data.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)) : [];
  const matching = rows.filter(row => typeof row.condition_id === 'string' && String(row.condition_id).toLowerCase() === String(conditionId || '').toLowerCase());
  return matching.length === 1 ? matching[0] : null;
}

export function buildSettlementEndpoint(platform: string, marketId: string): string {
  const id = String(marketId || '').trim();
  if (platform === 'Kalshi') {
    if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/i.test(id)) throw new Error('invalid Kalshi market id');
    return `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(id.toUpperCase())}`;
  }
  if (platform === 'Polymarket') {
    if (!/^\d{1,24}$/.test(id)) throw new Error('invalid Polymarket market id');
    return `https://gamma-api.polymarket.com/markets/${encodeURIComponent(id)}`;
  }
  throw new Error('unsupported prediction settlement venue');
}

export function buildPolymarketResolutionEndpoint(conditionId: string): string {
  const id = String(conditionId || '').trim();
  if (!/^0x[a-f\d]{64}$/i.test(id)) throw new Error('invalid Polymarket condition id');
  const url = new URL('https://data-api.polymarket.com/v2/resolutions');
  url.searchParams.set('condition', id);
  return url.toString();
}

export function settlementPayloadMatches(platform: SettlementPlatform, marketId: string, payload: Record<string, unknown>): boolean {
  if (platform === 'Kalshi') return typeof payload.ticker === 'string' && payload.ticker.toUpperCase() === marketId.trim().toUpperCase();
  return platform === 'Polymarket' && typeof payload.id === 'string' && payload.id === marketId.trim();
}

export function normalizeSettlementEvidence(input: {
  platform: SettlementPlatform;
  marketId: string;
  payload: Record<string, unknown>;
  resolutionPayload?: Record<string, unknown>;
  determinationSourceUrl?: string | null;
  resolutionReason?: string | null;
  capturedAt?: string;
}): SettlementEvidence {
  const marketId = String(input.marketId || '').trim();
  const sourceUrl = buildSettlementEndpoint(input.platform, marketId);
  const payload = input.payload || {};
  const rulesText = [payload.rules_primary, payload.description, payload.rules_secondary]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => String(value).trim())
    .filter((value, index, all) => all.indexOf(value) === index)
    .join('\n\n') || null;
  const rawStatus = String(payload.status || '').toLowerCase();
  const conditionId = typeof payload.conditionId === 'string' ? payload.conditionId : typeof payload.condition_id === 'string' ? payload.condition_id : null;
  const row = input.platform === 'Polymarket' ? resolutionRow(input.resolutionPayload, conditionId) : null;
  const resolutionStatus = String(row?.status || '').trim().toLowerCase() || null;
  const payoutResult = input.platform === 'Polymarket' && row && ['resolved', 'settled'].includes(resolutionStatus || '')
    ? polymarketPayoutResult(payload.outcomes, row.payouts)
    : null;
  const explicitResult = explicitBinaryResult(payload);
  const explicitResolution = input.platform === 'Polymarket' && (payload.resolved === true || ['resolved', 'settled'].includes(rawStatus)) ? explicitResult : null;
  const result = input.platform === 'Kalshi' ? explicitResult : payoutResult || explicitResolution;
  const resolved = input.platform === 'Kalshi'
    ? rawStatus === 'settled'
    : !!((row && ['resolved', 'settled'].includes(resolutionStatus || '') && payoutResult) || explicitResolution);
  const isClosed = payload.closed === true || ['closed', 'settled', 'resolved'].includes(rawStatus) || ['resolved', 'settled'].includes(resolutionStatus || '');
  const status: SettlementStatus = resolved && result ? 'settled' : isClosed ? 'closed' : rawStatus === 'open' || payload.closed === false ? 'open' : 'unknown';
  const closeAt = validIso(payload.close_time, payload.closeTime, payload.endDate, payload.end_date);
  const determinationAt = validIso(row?.resolved_at, payload.determination_time, payload.determinationTime, payload.resolvedAt, payload.resolved_at, payload.resolutionTime);
  const settlementAt = validIso(payload.settlement_ts, payload.settlementTime, payload.settled_at, row?.settlement_at);
  const resolutionSourceUrl = safeHttpUrl(payload.resolutionSource || payload.resolution_source || payload.rules_primary_url || row?.resolution_source);
  const determinationSourceUrl = input.platform === 'Polymarket' && conditionId
    ? safeHttpUrl(input.determinationSourceUrl || buildPolymarketResolutionEndpoint(conditionId))
    : safeHttpUrl(input.determinationSourceUrl);
  const payouts = parsePayouts(row?.payouts);
  const resolutionEvidence = row ? {
    conditionId: typeof row.condition_id === 'string' ? row.condition_id : null,
    status: resolutionStatus,
    payouts,
    transactionHash: typeof row.transaction_hash === 'string' ? row.transaction_hash : null,
    reporter: typeof row.reporter === 'string' ? row.reporter : null,
    wasDisputed: typeof row.was_disputed === 'boolean' ? row.was_disputed : null,
    wasArbitrated: typeof row.was_arbitrated === 'boolean' ? row.was_arbitrated : null,
    resolvedBlock: Number.isSafeInteger(row.resolved_block) ? Number(row.resolved_block) : null,
  } : null;
  const reason = status === 'closed' && !result
    ? `未提供可核实的最终结果；不会根据概率或收盘价格推断结算。${input.resolutionReason ? ` ${input.resolutionReason}` : ''}`
    : status === 'settled'
      ? null
      : status === 'open'
        ? '市场仍开放，尚无最终结算结果。'
        : '来源未提供足够的结算状态与规则证据。';
  const evidenceCore = {
    platform: input.platform,
    marketId,
    status,
    result: status === 'settled' ? result : null,
    rulesText,
    resolutionSourceUrl,
    determinationSourceUrl,
    resolutionEvidence,
    closeAt,
    determinationAt,
    settlementAt,
    reason,
  };
  const capturedAt = validIso(input.capturedAt) || new Date().toISOString();
  return {
    market: 'prediction',
    instrument: `prediction:${input.platform.toLowerCase()}:${marketId}`,
    platform: input.platform,
    marketId,
    status,
    result: status === 'settled' ? result : null,
    rulesText,
    rulesHash: rulesText ? sha256(rulesText) : null,
    resolutionSourceUrl,
    closeAt,
    determinationAt,
    settlementAt,
    determinationSourceUrl,
    resolutionEvidence,
    capturedAt,
    sourceUrl,
    evidenceHash: sha256(JSON.stringify(evidenceCore)),
    reason,
  };
}

export class PredictionSettlementRepository {
  constructor(private readonly store: StateDocumentStore, private readonly key = STORE_KEY) {}

  save(input: SettlementEvidence): SettlementEvidence {
    if (input.market !== 'prediction') throw new Error('settlement evidence must belong to prediction market');
    buildSettlementEndpoint(input.platform, input.marketId);
    const records = this.store.get<SettlementEvidence[]>(this.key) || [];
    const previous = [...records].reverse().find(item => item.platform === input.platform && item.marketId === input.marketId);
    if (previous?.evidenceHash === input.evidenceHash) return previous;
    const next = [...records, input].slice(-1000);
    this.store.set(this.key, next, 1);
    return input;
  }

  latest(platform: string, marketId: string): SettlementEvidence | null {
    const records = this.store.get<SettlementEvidence[]>(this.key) || [];
    return [...records].reverse().find(item => item.platform === platform && item.marketId === marketId) || null;
  }

  history(platform: string, marketId: string): SettlementEvidence[] {
    return (this.store.get<SettlementEvidence[]>(this.key) || []).filter(item => item.platform === platform && item.marketId === marketId);
  }
}
