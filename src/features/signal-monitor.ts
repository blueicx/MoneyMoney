import { transitionSignal, type SignalEvent, type SignalState } from './research-contracts';
import { researchRepository } from './research-repository';
import type { StrategyDriftGate } from './paper-drift';

export interface Signal {
    id: string;
    strategyId: string;
    strategyVersion?: string;
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

    constructor(private cooldownMs: number, private driftGate?: StrategyDriftGate) {}

    processSignal(signal: Signal, groupId?: string): 'confirmed' | 'deduplicated' | 'cooldown' | 'paused' {
        if (!signal.id?.trim()) throw new Error('Signal id is required');
        if (!signal.strategyId?.trim() || !signal.marketId?.trim()) throw new Error('Signal scope is required');
        if (!Number.isFinite(signal.timestamp)) throw new Error('Signal timestamp is required');
        const key = `${groupId || 'instrument'}:${signal.strategyId}:${signal.marketId}:${signal.direction}`;
        const lastTime = this.recentSignals.get(key) || 0;

        const remember = (accepted: boolean, reason?: string) => {
            const lc: SignalLifecycle = { signal: { ...signal }, state: 'generated', accepted, ...(reason ? { reason } : {}), updatedAt: Date.now() };
            (researchRepository as any).saveSignal(signal.id, lc);
        };
        if (signal.strategyVersion && this.driftGate?.isPaused(signal.marketId, signal.strategyId, signal.strategyVersion)) {
            remember(false, 'strategy alerts paused after paper/backtest drift');
            return 'paused';
        }
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
        const record = (researchRepository as any).getSignal(signalId);
        if (!record) throw new Error(`Signal ${signalId} not found`);
        return record;
    }

    advance(signalId: string, event: SignalEvent): SignalLifecycle {
        const record = this.getLifecycle(signalId);
        record.state = transitionSignal(record.state, event);
        record.updatedAt = Date.now();
        (researchRepository as any).saveSignal(signalId, record);
        return record;
    }

    listLifecycles(marketId?: string): SignalLifecycle[] {
        return (researchRepository as any).getAllSignals()
            .filter((record: any) => !marketId || record.signal.marketId === marketId)
            .sort((left: any, right: any) => right.updatedAt - left.updatedAt);
    }
}
