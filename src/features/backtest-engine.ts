export interface BacktestOptions {
    marketId: string;
    rules: any;
    feeRate: number;
    slippage: number;
    rejectOnInsufficientSamples?: boolean;
    preventFutureData?: boolean;
}

export class BacktestEngine {
    constructor(private options: BacktestOptions) {}

    run(prices: number[], signals: any[]) {
        if (this.options.rejectOnInsufficientSamples && prices.length < 100) {
            throw new Error('Insufficient samples');
        }

        let pnl = 0;
        let positions = 0;
        
        for (let i = 0; i < signals.length; i++) {
            const signal = signals[i];
            
            // Prevent future data peek
            if (this.options.preventFutureData && signal.timeIndex >= prices.length) {
               continue; 
            }

            const price = prices[signal.timeIndex];
            if (!price) continue;

            const slippageImpact = price * this.options.slippage;
            const fee = price * this.options.feeRate;

            if (signal.direction === 'buy') {
                const execPrice = price + slippageImpact;
                positions++;
                pnl -= (execPrice + fee);
            } else if (signal.direction === 'sell' && positions > 0) {
                const execPrice = price - slippageImpact;
                positions--;
                pnl += (execPrice - fee);
            }
        }

        return { pnl, remainingPositions: positions };
    }
}