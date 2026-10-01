export interface ScreenerMembershipDelta {
  entered: string[];
  exited: string[];
  unchanged: string[];
}

export function diffScreenerMembership(previousIds: readonly unknown[], currentIds: readonly unknown[]): ScreenerMembershipDelta {
  const previous = new Set(previousIds.map(String).map(value => value.trim()).filter(Boolean));
  const current = new Set(currentIds.map(String).map(value => value.trim()).filter(Boolean));
  return {
    entered: [...current].filter(id => !previous.has(id)).sort(),
    exited: [...previous].filter(id => !current.has(id)).sort(),
    unchanged: [...current].filter(id => previous.has(id)).sort(),
  };
}

export interface PeerPriceInput {
  id?: string;
  symbol?: string;
  title?: string;
  quote?: { price?: unknown; changePct?: unknown } | null;
  freshness?: { status?: string; fetchedAt?: string | null };
}

export function normalizePeerPrices<T extends PeerPriceInput>(items: readonly T[]): Array<T & {
  relativePct: number | null;
  reason: string | null;
}> {
  const baseline = items.map(item => Number(item.quote?.price)).find(price => Number.isFinite(price) && price > 0) ?? null;
  return items.map(item => {
    const price = Number(item.quote?.price);
    const valid = baseline !== null && Number.isFinite(price) && price > 0;
    return {
      ...item,
      relativePct: valid ? Math.round(((price / baseline! - 1) * 100) * 100) / 100 : null,
      reason: valid ? null : '价格不可用，未参与归一化比较',
    };
  });
}

export interface GuruHoldingInput {
  symbol?: string;
  dataStatus?: string;
  reason?: string | null;
  holders?: Array<{
    cik?: string;
    managerName?: string;
    filingName?: string;
    reportPeriod?: string;
    filedAt?: string;
    previousReportPeriod?: string | null;
    shares?: number | null;
    previousShares?: number | null;
    shareDelta?: number | null;
    change?: string;
    sourceUrl?: string | null;
  }>;
}

export function buildGuruHoldingsMatrix(items: readonly GuruHoldingInput[]) {
  const symbols = [...new Set(items.map(item => String(item.symbol || '').trim().toUpperCase()).filter(Boolean))].sort();
  const status: Record<string, { dataStatus: string; reason: string | null }> = {};
  const rows = new Map<string, { key: string; manager: string; cik: string | null; cells: Record<string, NonNullable<GuruHoldingInput['holders']>[number] | null> }>();

  for (const item of items) {
    const symbol = String(item.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    status[symbol] = { dataStatus: String(item.dataStatus || 'unavailable'), reason: item.reason || null };
    for (const holding of item.holders || []) {
      const cik = String(holding.cik || '').trim();
      // Never merge records by a guessed display-name identity.
      const key = cik ? `cik:${cik}` : `unmapped:${symbol}:${rows.size}`;
      const row = rows.get(key) || {
        key,
        manager: String(holding.managerName || holding.filingName || (cik ? `CIK ${cik}` : '未映射机构')),
        cik: cik || null,
        cells: Object.fromEntries(symbols.map(ticker => [ticker, null])),
      };
      row.cells[symbol] = holding;
      rows.set(key, row);
    }
  }
  return { symbols, rows: [...rows.values()].sort((a, b) => a.manager.localeCompare(b.manager)), status };
}
