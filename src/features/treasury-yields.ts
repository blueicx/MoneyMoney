/**
 * Official U.S. Treasury daily par yield curve rates.
 * The CSV endpoint is public and does not require an API key.
 */

export interface TreasuryMaturity {
  label: string;
  years: number;
  yieldPct: number;
  changeBp: number | null;
}

export interface TreasurySpread {
  label: string;
  valuePct: number;
  changeBp: number | null;
}

export interface TreasuryYields {
  source: 'U.S. Department of the Treasury';
  fetchedAt: string;
  asOf: string;
  asOfLabel: string;
  maturities: TreasuryMaturity[];
  spreads: TreasurySpread[];
  curveInverted2s10s: boolean;
}

interface YieldRow {
  date: Date;
  values: Record<string, number>;
}

const CACHE_TTL_MS = 600_000; // Official daily data changes slowly.
let cache: { ts: number; value: TreasuryYields } | null = null;

const MATURITY_COLUMNS = [
  { column: '1 Mo', label: '1M', years: 1 / 12 },
  { column: '3 Mo', label: '3M', years: 0.25 },
  { column: '6 Mo', label: '6M', years: 0.5 },
  { column: '1 Yr', label: '1Y', years: 1 },
  { column: '2 Yr', label: '2Y', years: 2 },
  { column: '3 Yr', label: '3Y', years: 3 },
  { column: '5 Yr', label: '5Y', years: 5 },
  { column: '7 Yr', label: '7Y', years: 7 },
  { column: '10 Yr', label: '10Y', years: 10 },
  { column: '20 Yr', label: '20Y', years: 20 },
  { column: '30 Yr', label: '30Y', years: 30 },
];

async function fetchCsv(year: number): Promise<string> {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 MoneyMoney/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`US Treasury HTTP ${response.status}`);
  return response.text();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  return rows;
}

function parseRows(csv: string): YieldRow[] {
  const table = parseCsv(csv);
  if (table.length < 2) return [];
  const header = table[0].map(value => value.trim());

  return table.slice(1).flatMap(row => {
    const rawDate = row[0]?.trim() || '';
    const parts = rawDate.split('/').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return [];
    // Treasury uses MM/DD/YYYY; UTC avoids shifting the report date.
    const date = new Date(Date.UTC(parts[2], parts[0] - 1, parts[1]));
    if (Number.isNaN(date.getTime())) return [];

    const values: Record<string, number> = {};
    for (let i = 1; i < header.length && i < row.length; i++) {
      const value = Number(row[i]);
      if (Number.isFinite(value)) values[header[i]] = value;
    }
    return [{ date, values }];
  }).sort((a, b) => b.date.getTime() - a.date.getTime());
}

function changeInBp(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined) return null;
  return Math.round((current - previous) * 100);
}

export async function getTreasuryYields(): Promise<TreasuryYields> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const now = new Date();
  const years = [now.getUTCFullYear(), now.getUTCFullYear() - 1];
  const csvFiles = await Promise.all(years.map(year => fetchCsv(year)));
  const rows = csvFiles.flatMap(csv => parseRows(csv))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .filter((row, index, all) => index === 0 || all[index - 1].date.getTime() !== row.date.getTime());

  const latest = rows[0];
  const previous = rows[1];
  if (!latest) throw new Error('No US Treasury yield data available');

  const maturities = MATURITY_COLUMNS.flatMap(({ column, label, years: maturityYears }) => {
    const yieldPct = latest.values[column];
    if (yieldPct === undefined) return [];
    return [{
      label,
      years: maturityYears,
      yieldPct,
      changeBp: changeInBp(yieldPct, previous?.values[column]),
    }];
  });

  const readValue = (column: string): number | undefined =>
    latest.values[column] !== undefined ? latest.values[column] : undefined;
  const readPrevious = (column: string): number | undefined => previous?.values[column];
  const makeSpread = (label: string, shortColumn: string, longColumn: string): TreasurySpread | null => {
    const shortRate = readValue(shortColumn);
    const longRate = readValue(longColumn);
    if (shortRate === undefined || longRate === undefined) return null;
    const previousShort = readPrevious(shortColumn);
    const previousLong = readPrevious(longColumn);
    return {
      label,
      valuePct: Number((longRate - shortRate).toFixed(2)),
      changeBp: previousShort === undefined || previousLong === undefined
        ? null
        : Math.round(((longRate - shortRate) - (previousLong - previousShort)) * 100),
    };
  };

  const spreads = [makeSpread('2s10s', '2 Yr', '10 Yr'), makeSpread('3m10s', '3 Mo', '10 Yr')]
    .filter((item): item is TreasurySpread => item !== null);
  const twoTen = spreads.find(item => item.label === '2s10s');

  const value: TreasuryYields = {
    source: 'U.S. Department of the Treasury',
    fetchedAt: new Date().toISOString(),
    asOf: latest.date.toISOString(),
    asOfLabel: `${latest.date.getUTCFullYear()}-${String(latest.date.getUTCMonth() + 1).padStart(2, '0')}-${String(latest.date.getUTCDate()).padStart(2, '0')}`,
    maturities,
    spreads,
    curveInverted2s10s: twoTen ? twoTen.valuePct < 0 : false,
  };

  cache = { ts: Date.now(), value };
  return value;
}
