import { createHash } from 'node:crypto';
import { EVIDENCE_MARKETS, type EvidenceMarket } from './evidence-contract';

/**
 * Read-only board over already-saved strategy signals.
 *
 * It never evaluates a strategy or generates a new signal. Each strategy's
 * saved state is summarized at a chosen point in time; expired or missing
 * signals stay explicit in the counts.
 */

export interface SignalBoardInput {
  id: string;
  strategyId: string;
  strategyVersion?: string;
  market: string;
  instrument: string;
  action?: 'BUY' | 'SELL';
  status?: string;
  triggeredAt: number;
  expiresAt?: number;
  evidenceRefs?: string[];
}

export interface SignalBoardRow {
  instrument: string;
  strategyCount: number;
  longs: number;
  shorts: number;
  unknownDirection: number;
  conflict: boolean;
  consensus: 'long' | 'short' | 'mixed' | 'none';
  missingEvidence: number;
  expired: number;
  newestSignalAt: string | null;
  oldestSignalAt: string | null;
  stale: boolean;
  strategies: Array<{ strategyId: string; strategyVersion: string | null; direction: 'long' | 'short' | 'unknown'; status: string | null }>;
}

export interface SignalBoard {
  asOf: string;
  market: EvidenceMarket;
  staleAfterMs: number;
  rows: SignalBoardRow[];
  excluded: Array<{ id: string; reason: string }>;
  contentHash: string;
}

export function buildSignalBoard(input: {
  signals: readonly unknown[];
  market: string;
  instrument?: string;
  asOf?: number;
  now?: number;
  staleAfterMs?: number;
}): SignalBoard {
  if (!input || !Array.isArray(input.signals)) throw new Error('信号看板输入必须是数组');
  const market = String(input.market) as EvidenceMarket;
  if (!EVIDENCE_MARKETS.includes(market)) throw new Error('信号看板市场无效');
  const now = input.now ?? Date.now();
  const asOf = input.asOf ?? now;
  if (!Number.isFinite(asOf) || asOf > now + 1000) throw new Error('信号看板时点不能位于未来');
  const staleAfterMs = input.staleAfterMs ?? 7 * 86_400_000;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new Error('信号新鲜度窗口无效');
  const instrumentFilter = input.instrument?.trim() || null;
  const excluded: Array<{ id: string; reason: string }> = [];
  const groups = new Map<string, Array<SignalBoardInput & { direction: 'long' | 'short' | 'unknown' }>>();
  const seen = new Set<string>();
  input.signals.forEach(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      excluded.push({ id: 'unknown', reason: '信号记录不是对象' });
      return;
    }
    const row = value as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id || id.length > 240) {
      excluded.push({ id: id || 'unknown', reason: '信号身份无效' });
      return;
    }
    if (seen.has(id)) {
      excluded.push({ id, reason: '信号身份重复' });
      return;
    }
    seen.add(id);
    if (row.market !== market) {
      excluded.push({ id, reason: '市场不一致' });
      return;
    }
    const instrument = typeof row.instrument === 'string' ? row.instrument.trim() : '';
    if (!instrument || instrument.length > 200) {
      excluded.push({ id, reason: '信号标的无效' });
      return;
    }
    if (instrumentFilter && instrument !== instrumentFilter) return;
    const triggeredAt = row.triggeredAt;
    if (typeof triggeredAt !== 'number' || !Number.isFinite(triggeredAt) || triggeredAt > asOf + 1000) {
      excluded.push({ id, reason: triggeredAt && Number(triggeredAt) > asOf ? '信号在本时点之后才触发' : '触发时间无效' });
      return;
    }
    if (row.expiresAt !== undefined && (typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt) || row.expiresAt <= triggeredAt)) {
      excluded.push({ id, reason: '过期时间无效' });
      return;
    }
    if (typeof row.strategyId !== 'string' || !row.strategyId.trim()) {
      excluded.push({ id, reason: '策略身份缺失' });
      return;
    }
    const direction: 'long' | 'short' | 'unknown' = row.action === 'BUY' ? 'long' : row.action === 'SELL' ? 'short' : 'unknown';
    const normalized: SignalBoardInput & { direction: 'long' | 'short' | 'unknown' } = {
      id,
      strategyId: row.strategyId.trim(),
      ...(typeof row.strategyVersion === 'string' ? { strategyVersion: row.strategyVersion } : {}),
      market,
      instrument,
      ...(row.action === 'BUY' || row.action === 'SELL' ? { action: row.action } : {}),
      ...(typeof row.status === 'string' ? { status: row.status } : {}),
      triggeredAt,
      ...(typeof row.expiresAt === 'number' ? { expiresAt: row.expiresAt } : {}),
      evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [],
      direction,
    };
    const list = groups.get(instrument) ?? [];
    list.push(normalized);
    groups.set(instrument, list);
  });
  const rows: SignalBoardRow[] = [...groups.entries()].map(([instrument, list]) => {
    const active = list.filter(signal => signal.expiresAt === undefined || signal.expiresAt > asOf);
    const expired = list.length - active.length;
    const longs = active.filter(signal => signal.direction === 'long').length;
    const shorts = active.filter(signal => signal.direction === 'short').length;
    const unknownDirection = active.filter(signal => signal.direction === 'unknown').length;
    const newest = active.reduce((max, signal) => Math.max(max, signal.triggeredAt), 0);
    const oldest = active.reduce((min, signal) => Math.min(min, signal.triggeredAt), Number.POSITIVE_INFINITY);
    const strategies = active
      .map(signal => ({ strategyId: signal.strategyId, strategyVersion: signal.strategyVersion ?? null, direction: signal.direction, status: signal.status ?? null }))
      .sort((left, right) => left.strategyId.localeCompare(right.strategyId));
    return {
      instrument,
      strategyCount: new Set(active.map(signal => signal.strategyId)).size,
      longs,
      shorts,
      unknownDirection,
      conflict: longs > 0 && shorts > 0,
      consensus: (longs > 0 && shorts > 0 ? 'mixed' : longs > 0 ? 'long' : shorts > 0 ? 'short' : 'none') as SignalBoardRow['consensus'],
      missingEvidence: active.filter(signal => !signal.evidenceRefs || signal.evidenceRefs.length === 0).length,
      expired,
      newestSignalAt: active.length ? new Date(newest).toISOString() : null,
      oldestSignalAt: active.length ? new Date(oldest).toISOString() : null,
      stale: active.length ? asOf - newest > staleAfterMs : false,
      strategies,
    };
  }).sort((left, right) => left.instrument.localeCompare(right.instrument));
  const payload = { asOf: new Date(asOf).toISOString(), market, staleAfterMs, rows, excluded };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
