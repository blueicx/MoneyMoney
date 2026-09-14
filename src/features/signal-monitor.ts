export interface Signal {
    id: string;
    strategyId: string;
    marketId: string;
    timestamp: number;
    direction: 'buy' | 'sell';
}

export class SignalMonitor {
    private recentSignals = new Map<string, number>();

    constructor(private cooldownMs: number) {}

    processSignal(signal: Signal): 'confirmed' | 'deduplicated' | 'cooldown' {
        const key = `${signal.strategyId}:${signal.marketId}:${signal.direction}`;
        const lastTime = this.recentSignals.get(key) || 0;

        if (signal.timestamp === lastTime) {
            return 'deduplicated';
        }

        if (signal.timestamp - lastTime < this.cooldownMs) {
            return 'cooldown';
        }

        this.recentSignals.set(key, signal.timestamp);
        return 'confirmed';
    }
}