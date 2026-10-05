import { randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';

type CoordinatorStore = Pick<SQLiteStateStore, 'getIdempotent' | 'setIdempotent' | 'acquireLease' | 'refreshLease' | 'releaseLease' | 'transaction'>;

export type AiRunnerTickResult<T> =
  | { status: 'busy' }
  | { status: 'duplicate'; result: T }
  | { status: 'completed'; result: T };

export function buildAiRunnerTickIdempotencyKey(runnerId: string, at = new Date(), bucketMs = 60_000): string {
  const timestamp = at.getTime();
  if (!runnerId.trim() || !Number.isFinite(timestamp) || !Number.isFinite(bucketMs) || bucketMs < 1_000) throw new Error('跑单周期标识无效');
  return `ai-runner-tick:${runnerId}:${Math.floor(timestamp / bucketMs)}`;
}

export class AiRunnerTickCoordinator {
  constructor(private readonly store: CoordinatorStore, private readonly leaseMs = 120_000) {}

  async run<TPrepared, TResult>(
    runnerId: string,
    idempotencyKey: string,
    prepare: () => Promise<TPrepared>,
    commit: (prepared: TPrepared) => TResult,
    owner = randomUUID(),
  ): Promise<AiRunnerTickResult<TResult>> {
    const cached = this.store.getIdempotent<{ result: TResult }>(idempotencyKey);
    if (cached) return { status: 'duplicate', result: cached.result };
    const leaseKey = `ai-paper-runner:${runnerId}`;
    if (!this.store.acquireLease(leaseKey, owner, Date.now(), this.leaseMs)) return { status: 'busy' };
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      if (!this.store.refreshLease(leaseKey, owner, Date.now(), this.leaseMs)) leaseLost = true;
    }, Math.max(10, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();
    try {
      const afterLease = this.store.getIdempotent<{ result: TResult }>(idempotencyKey);
      if (afterLease) return { status: 'duplicate', result: afterLease.result };
      const prepared = await prepare();
      return this.store.transaction(() => {
        if (leaseLost || !this.store.refreshLease(leaseKey, owner, Date.now(), this.leaseMs)) return { status: 'busy' as const };
        const committed = this.store.getIdempotent<{ result: TResult }>(idempotencyKey);
        if (committed) return { status: 'duplicate', result: committed.result };
        const result = commit(prepared);
        this.store.setIdempotent(idempotencyKey, { result });
        return { status: 'completed', result };
      });
    } finally {
      clearInterval(heartbeat);
      this.store.releaseLease(leaseKey, owner);
    }
  }
}
