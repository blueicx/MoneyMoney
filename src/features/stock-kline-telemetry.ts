export interface StockKlineTelemetryInput {
  provider: string;
  cacheMode: string;
  providerLatencyMs: number | null;
  providerLatencyAt: number | null;
  sourceTime: string | null;
  dataStatus: string;
  reason?: string | null;
  retrievedAt?: number;
  cacheAgeMs?: number;
}

function finiteNonNegative(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function buildStockKlineProviderTelemetry(input: StockKlineTelemetryInput) {
  const retrievedAt = finiteNonNegative(input.retrievedAt) ?? Date.now();
  const providerLatencyAt = finiteNonNegative(input.providerLatencyAt);
  const sourceTime = typeof input.sourceTime === 'string' && input.sourceTime.trim() ? input.sourceTime : null;
  return {
    provider: String(input.provider || '股票K线来源'),
    cacheMode: String(input.cacheMode || 'unknown'),
    providerLatencyMs: finiteNonNegative(input.providerLatencyMs),
    providerLatencyAt: providerLatencyAt == null ? null : new Date(providerLatencyAt).toISOString(),
    sourceTime,
    retrievedAt: new Date(retrievedAt).toISOString(),
    dataStatus: String(input.dataStatus || 'unknown'),
    reason: input.reason ? String(input.reason) : null,
    cacheAgeMs: finiteNonNegative(input.cacheAgeMs) ?? 0,
  };
}
