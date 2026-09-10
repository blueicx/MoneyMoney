export type CompareScope = 'stocks' | 'options' | 'crypto' | 'prediction';
export type CompareInstrumentType = 'stock' | 'option' | 'crypto' | 'prediction';

export interface CompareInstrument {
  id: string;
  type: CompareInstrumentType;
  symbol: string;
  title?: string;
  quote?: Record<string, unknown> | null;
  dataTime?: string | null;
  sourceStatus?: Record<string, string> | string;
}

export interface ComparedInstrument extends CompareInstrument {
  quote: { price: number | null; changePct: number | null; [key: string]: unknown };
  freshness: { status: 'fresh' | 'stale' | 'unavailable'; fetchedAt: string | null };
}

function expectedType(scope: CompareScope): CompareInstrumentType {
  if (scope === 'stocks') return 'stock';
  if (scope === 'options') return 'option';
  if (scope === 'crypto') return 'crypto';
  return 'prediction';
}

export function compareInstruments(scope: CompareScope, instruments: CompareInstrument[]): ComparedInstrument[] {
  if (!['stocks', 'options', 'crypto', 'prediction'].includes(scope)) throw new Error(`不支持的比较市场: ${scope}`);
  if (instruments.length > 6) throw new Error('最多同时比较 6 个标的');
  const type = expectedType(scope);
  if (instruments.some(item => item.type !== type)) throw new Error('只能比较同一 market scope 的标的');
  return instruments.map(item => {
    const quote = item.quote || {};
    const fetchedAt = item.dataTime || null;
    const age = fetchedAt ? Date.now() - new Date(fetchedAt).getTime() : NaN;
    return {
      ...item,
      quote: { ...quote, price: Number.isFinite(Number(quote.price)) ? Number(quote.price) : null, changePct: Number.isFinite(Number(quote.changePct)) ? Number(quote.changePct) : null },
      freshness: { status: !fetchedAt || !Number.isFinite(age) ? 'unavailable' : age <= 5 * 60_000 ? 'fresh' : 'stale', fetchedAt },
    };
  });
}

export function createCompareSnapshot(scope: CompareScope, instruments: ComparedInstrument[]) {
  return { id: `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, scope, createdAt: new Date().toISOString(), instruments: compareInstruments(scope, instruments) };
}
