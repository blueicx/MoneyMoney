/**
 * Free keyless economic indicators:
 * - US Treasury interest rates (fiscaldata.treasury.gov)
 * - US unemployment & CPI (BLS public API)
 */

export interface EconomicIndicators {
  source: 'US Treasury + BLS Public API';
  fetchedAt: string;
  treasury: {
    avgRatePct: number | null;
    recordDate: string;
    securityType: string;
  };
  unemployment: {
    ratePct: number;
    period: string;
  } | null;
  cpi: {
    value: number;
    period: string;
    changePct: number | null;
  } | null;
}

const CACHE_TTL_MS = 300_000; // 5 minutes
let cache: { ts: number; value: EconomicIndicators } | null = null;

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function getEconomicIndicators(): Promise<EconomicIndicators> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const result: EconomicIndicators = {
    source: 'US Treasury + BLS Public API',
    fetchedAt: new Date().toISOString(),
    treasury: { avgRatePct: null, recordDate: '', securityType: '' },
    unemployment: null,
    cpi: null,
  };

  // Fetch Treasury data (no key needed)
  try {
    const t = await fetchJson(
      'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page%5Bsize%5D=1&filter=record_date:gte:2024-01-01'
    );
    if (t.data?.[0]) {
      const item = t.data[0];
      result.treasury = {
        avgRatePct: Number(item.avg_interest_rate_amt) || null,
        recordDate: item.record_date || '',
        securityType: item.security_desc || '',
      };
    }
  } catch {}

  // Fetch BLS data (no key needed for limited requests)
  try {
    const bls = await fetchJson('https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000,CUUR0000SA0?startyear=2025&endyear=2026');
    if (bls.Results?.series) {
      for (const series of bls.Results.series) {
        const latest = series.data?.[0];
        if (!latest) continue;
        if (series.seriesID === 'LNS14000000') {
          result.unemployment = {
            ratePct: Number(latest.value) || 0,
            period: `${latest.year}-${latest.period.replace('M', '')}`,
          };
        } else if (series.seriesID === 'CUUR0000SA0') {
          const prev = series.data?.[1];
          const curr = Number(latest.value);
          const prevVal = prev ? Number(prev.value) : 0;
          result.cpi = {
            value: curr,
            period: `${latest.year}-${latest.period.replace('M', '')}`,
            changePct: prevVal > 0 ? ((curr - prevVal) / prevVal) * 100 : null,
          };
        }
      }
    }
  } catch {}

  cache = { ts: Date.now(), value: result };
  return result;
}
