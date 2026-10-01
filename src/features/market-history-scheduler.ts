import type { SQLiteStateStore } from '../storage/sqlite-state';
import { assertMarketContext, type MarketId } from './research-contracts';

type CaptureTarget = { market: MarketId; instrument: string; cooldownMs: number };
type CaptureRunState = { cursor: number; lastAttempt: Record<string, { at: string; status: string; reason?: string }> };
const KEY = 'market-history:capture-scheduler';
const LEASE = 'market-history:capture-scheduler:lease';

export class MarketHistoryCaptureScheduler {
  constructor(private readonly store: SQLiteStateStore, private readonly batchSize = 3) {}

  state(): CaptureRunState {
    return this.store.get<CaptureRunState>(KEY) || { cursor: 0, lastAttempt: {} };
  }

  async runOnce(ids: string[], capture: (target: CaptureTarget) => Promise<{ status: string; reason?: string }>, now = Date.now()) {
    const owner = `history-${process.pid}-${now}-${Math.random().toString(36).slice(2, 8)}`;
    if (!this.store.acquireLease(LEASE, owner, now, 180_000)) return { acquired: false, attempted: 0, results: [] as Array<Record<string, unknown>> };
    try {
      const targets = [...new Map(ids.flatMap(raw => {
        const id = String(raw || '').trim();
        const match = id.match(/^(option|crypto|prediction):([^:]+):(.+)$/i);
        if (!match) return [];
        const market = ({ option: 'options', crypto: 'crypto', prediction: 'prediction' } as const)[match[1].toLowerCase() as 'option' | 'crypto' | 'prediction'];
        const venue = match[2].toLowerCase();
        const asset = match[3].toUpperCase();
        if (market === 'crypto') {
          if (!['binance', 'gateio'].includes(venue)) return [];
          const base = asset.replace(/(?:_?USDT|USDC)$/, '');
          if (!['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'].includes(base)) return [];
        }
        if (market === 'options' && !['cboe', 'deribit'].includes(venue)) return [];
        if (market === 'options' && venue === 'deribit' && !['BTC', 'ETH'].includes(asset)) return [];
        try { assertMarketContext({ market, instrument: id, workspace: 'market-history-scheduler' }); } catch { return []; }
        const cooldownMs = market === 'options' ? 24 * 60 * 60_000 : 60 * 60_000;
        const target = { market, instrument: id, cooldownMs };
        return [[id, target] as const];
      }))].map(([, target]) => target);
      if (!targets.length) return { acquired: true, attempted: 0, results: [] as Array<Record<string, unknown>> };
      const state = this.state();
      const start = ((state.cursor % targets.length) + targets.length) % targets.length;
      const rotated = [...targets.slice(start), ...targets.slice(0, start)];
      const due = rotated.filter(target => {
        const previous = Date.parse(state.lastAttempt[target.instrument]?.at || '');
        return !Number.isFinite(previous) || now - previous >= target.cooldownMs;
      }).slice(0, this.batchSize);
      const results: Array<Record<string, unknown>> = [];
      for (const target of due) {
        const attemptedAt = new Date(now).toISOString();
        let status = 'failed', reason: string | undefined;
        try {
          const result = await capture(target);
          status = String(result.status || 'unavailable'); reason = result.reason;
        } catch (error) { reason = error instanceof Error ? error.message : '来源请求失败'; }
        const current = this.state();
        this.store.set(KEY, {
          cursor: (targets.findIndex(row => row.instrument === target.instrument) + 1) % targets.length,
          lastAttempt: { ...current.lastAttempt, [target.instrument]: { at: attemptedAt, status, ...(reason ? { reason: reason.slice(0, 300) } : {}) } },
        });
        results.push({ ...target, status, reason: reason || null, attemptedAt });
      }
      return { acquired: true, attempted: due.length, results };
    } finally { this.store.releaseLease(LEASE, owner); }
  }
}
