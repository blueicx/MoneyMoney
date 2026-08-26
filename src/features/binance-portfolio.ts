// ============================================
// BINANCE PORTFOLIO TRACKER (read-only API key)
// ============================================

import crypto from 'crypto';

const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const BINANCE_SECRET = process.env.BINANCE_API_SECRET || '';
const BASE_URL = 'https://api.binance.com';

export interface BinanceAsset {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdValue: number;
  priceUsd: number;
}

export interface PortfolioSummary {
  totalUsd: number;
  assets: BinanceAsset[];
  lastUpdated: string;
}

export class BinancePortfolio {

  get isConfigured(): boolean {
    return !!(BINANCE_API_KEY && BINANCE_SECRET);
  }

  private sign(queryString: string): string {
    return crypto.createHmac('sha256', BINANCE_SECRET).update(queryString).digest('hex');
  }

  async getPortfolio(): Promise<PortfolioSummary | null> {
    if (!this.isConfigured) return null;

    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=10000`;
      const signature = this.sign(queryString);

      const res = await fetch(`${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': BINANCE_API_KEY },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return null;
      const data: any = await res.json();

      const balances = data.balances.filter((b: any) => parseFloat(b.free) + parseFloat(b.locked) > 0);
      const assets: BinanceAsset[] = [];

      for (const bal of balances) {
        const total = parseFloat(bal.free) + parseFloat(bal.locked);
        let priceUsd = 1; // USDT/USDC/BUSD = $1
        if (!['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD'].includes(bal.asset)) {
          try {
            const symbol = bal.asset === 'BTC' ? 'BTCUSDT' : `${bal.asset}USDT`;
            const pRes = await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
            if (pRes.ok) {
              const pData: any = await pRes.json();
              priceUsd = parseFloat(pData.price);
            } else { continue; }
          } catch { continue; }
        }

        assets.push({
          asset: bal.asset,
          free: parseFloat(bal.free),
          locked: parseFloat(bal.locked),
          total,
          usdValue: parseFloat((total * priceUsd).toFixed(2)),
          priceUsd,
        });
      }

      assets.sort((a, b) => b.usdValue - a.usdValue);
      const totalUsd = assets.reduce((s, a) => s + a.usdValue, 0);

      return { totalUsd: parseFloat(totalUsd.toFixed(2)), assets, lastUpdated: new Date().toISOString() };
    } catch {
      return null;
    }
  }
}

export const binancePortfolio = new BinancePortfolio();

