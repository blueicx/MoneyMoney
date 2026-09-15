import { transitionSignal, type SignalEvent, type SignalState } from './research-contracts';

export interface Signal {
    id: string;
    strategyId: string;
    marketId: string;
    timestamp: number;
    direction: 'buy' | 'sell';
}

export interface SignalLifecycle {
    signal: Signal;
    state: SignalState;
    accepted: boolean;
    reason?: string;
    updatedAt: number;
}

export class SignalMonitor {
    private recentSignals = new Map<string, number>();
    private lifecycles = new Map<string, SignalLifecycle>();

    constructor(private cooldownMs: number) {}

    processSignal(signal: Signal, groupId?: string): 'confirmed' | 'deduplicated' | 'cooldown' {
        if (!signal.id?.trim()) throw new Error('Signal id is required');
        if (!signal.strategyId?.trim() || !signal.marketId?.trim()) throw new Error('Signal scope is required');
        if (!Number.isFinite(signal.timestamp)) throw new Error('Signal timestamp is required');
        const key = `${groupId || 'instrument'}:${signal.strategyId}:${signal.marketId}:${signal.direction}`;
        const lastTime = this.recentSignals.get(key) || 0;

        const remember = (accepted: boolean, reason?: string) => {
            this.lifecycles.set(signal.id, { signal: { ...signal }, state: 'generated', accepted, ...(reason ? { reason } : {}), updatedAt: Date.now() });
        };
        if (signal.timestamp === lastTime) {
            remember(false, 'duplicate signal');
            return 'deduplicated';
        }

        if (signal.timestamp - lastTime < this.cooldownMs) {
            remember(false, 'cooldown active');
            return 'cooldown';
        }

        this.recentSignals.set(key, signal.timestamp);
        remember(true);
        return 'confirmed';
    }

    getLifecycle(signalId: string): SignalLifecycle {
        const record = this.lifecycles.get(signalId);
        if (!record) throw new Error(`Signal ${signalId} not found`);
        return { ...record, signal: { ...record.signal } };
    }

    advance(signalId: string, event: SignalEvent): SignalLifecycle {
        const record = this.lifecycles.get(signalId);
        if (!record) throw new Error(`Signal ${signalId} not found`);
        record.state = transitionSignal(record.state, event);
        record.updatedAt = Date.now();
        return this.getLifecycle(signalId);
    }

    listLifecycles(marketId?: string): SignalLifecycle[] {
        return [...this.lifecycles.values()]
            .filter(record => !marketId || record.signal.marketId === marketId)
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map(record => ({ ...record, signal: { ...record.signal } }));
    }
}
