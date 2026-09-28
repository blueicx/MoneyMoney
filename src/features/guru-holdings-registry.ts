export interface GuruManagerDefinition {
  cik: string;
  filingName: string;
  aliases: string[];
  personAssociation?: string;
  attributionNote?: string;
}

export interface GuruStockMapping {
  symbol: string;
  cusip: string;
  classTitles: string[];
  issuerName: string;
}

// CIKs identify SEC filing entities. Person associations are labels only and
// never imply that a 13F report represents an individual's complete portfolio.
export const GURU_MANAGER_REGISTRY: readonly GuruManagerDefinition[] = [
  { cik: '0001067983', filingName: 'Berkshire Hathaway Inc.', aliases: ['Berkshire Hathaway'], personAssociation: 'Warren Buffett', attributionNote: '公开关联人物；SEC 申报主体仍为公司' },
  { cik: '0001336528', filingName: 'Pershing Square Capital Management, L.P.', aliases: ['Pershing Square'], personAssociation: 'Bill Ackman', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
  { cik: '0001649339', filingName: 'Scion Asset Management, LLC', aliases: ['Scion'], personAssociation: 'Michael Burry', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
  { cik: '0001697748', filingName: 'ARK Investment Management LLC', aliases: ['ARK Invest', 'ARK'], personAssociation: 'Cathie Wood', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
  { cik: '0001656456', filingName: 'Appaloosa Management, L.P.', aliases: ['Appaloosa'], personAssociation: 'David Tepper', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
  { cik: '0001536411', filingName: 'Duquesne Family Office LLC', aliases: ['Duquesne'], personAssociation: 'Stanley Druckenmiller', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
  { cik: '0001350694', filingName: 'Bridgewater Associates, LP', aliases: ['Bridgewater'], personAssociation: 'Ray Dalio', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
  { cik: '0001423053', filingName: 'Citadel Advisors LLC', aliases: ['Citadel Advisors'], personAssociation: 'Ken Griffin', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
  { cik: '0001037389', filingName: 'Renaissance Technologies LLC', aliases: ['Renaissance Technologies', 'Renaissance'], attributionNote: '按机构申报展示，不推断个人账户归属' },
  { cik: '0001040273', filingName: 'Third Point LLC', aliases: ['Third Point'], personAssociation: 'Daniel Loeb', attributionNote: '公开关联人物；SEC 申报主体仍为管理公司' },
];

// Exact CUSIP and reported class only. Unknown securities remain unmapped;
// issuer-name similarity is intentionally not used to guess a ticker.
export const GURU_STOCK_MAPPINGS: readonly GuruStockMapping[] = [
  { symbol: 'AAPL', cusip: '037833100', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Apple Inc.' },
  { symbol: 'MSFT', cusip: '594918104', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Microsoft Corporation' },
  { symbol: 'NVDA', cusip: '67066G104', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'NVIDIA Corporation' },
  { symbol: 'AMZN', cusip: '023135106', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Amazon.com, Inc.' },
  { symbol: 'GOOGL', cusip: '02079K305', classTitles: ['CL A', 'CLASS A'], issuerName: 'Alphabet Inc.' },
  { symbol: 'GOOG', cusip: '02079K107', classTitles: ['CL C', 'CLASS C'], issuerName: 'Alphabet Inc.' },
  { symbol: 'META', cusip: '30303M102', classTitles: ['CL A', 'CLASS A'], issuerName: 'Meta Platforms, Inc.' },
  { symbol: 'TSLA', cusip: '88160R101', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Tesla, Inc.' },
  { symbol: 'MU', cusip: '595112103', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Micron Technology, Inc.' },
  { symbol: 'SPY', cusip: '78462F103', classTitles: ['ETF', 'UNIT'], issuerName: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'AVGO', cusip: '11135F101', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Broadcom Inc.' },
  { symbol: 'AMD', cusip: '007903107', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Advanced Micro Devices, Inc.' },
  { symbol: 'PLTR', cusip: '69608A108', classTitles: ['CL A', 'CLASS A'], issuerName: 'Palantir Technologies Inc.' },
  { symbol: 'JPM', cusip: '46625H100', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'JPMorgan Chase & Co.' },
  { symbol: 'ORCL', cusip: '68389X105', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Oracle Corporation' },
  { symbol: 'NFLX', cusip: '64110L106', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Netflix, Inc.' },
  { symbol: 'BRK.B', cusip: '084670702', classTitles: ['CL B', 'CLASS B'], issuerName: 'Berkshire Hathaway Inc.' },
  { symbol: 'INTC', cusip: '458140100', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Intel Corporation' },
  { symbol: 'COIN', cusip: '19260Q107', classTitles: ['CL A', 'CLASS A'], issuerName: 'Coinbase Global, Inc.' },
  { symbol: 'XOM', cusip: '30231G102', classTitles: ['COM', 'COMMON STOCK'], issuerName: 'Exxon Mobil Corporation' },
];

export function getGuruManager(cik: string): GuruManagerDefinition | null {
  return GURU_MANAGER_REGISTRY.find(item => item.cik === cik) || null;
}

export function searchGuruManagerRegistry(query = ''): GuruManagerDefinition[] {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  if (!normalized) return [...GURU_MANAGER_REGISTRY];
  return GURU_MANAGER_REGISTRY.filter(item => [item.cik, item.filingName, ...item.aliases, item.personAssociation || '']
    .some(value => value.toLocaleLowerCase().includes(normalized)));
}

export function resolveGuruStockMapping(symbol: string, cusip: string, classTitle: string): GuruStockMapping | null {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const normalizedCusip = String(cusip || '').trim().toUpperCase();
  const normalizedClass = String(classTitle || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const mapping = GURU_STOCK_MAPPINGS.find(item => item.symbol === normalizedSymbol
    && item.cusip === normalizedCusip
    && item.classTitles.some(title => title.toUpperCase() === normalizedClass));
  return mapping ? { ...mapping, classTitles: [...mapping.classTitles] } : null;
}

export function resolveGuruMappingByCusip(cusip: string, classTitle: string): GuruStockMapping | null {
  const normalizedCusip = String(cusip || '').trim().toUpperCase();
  const normalizedClass = String(classTitle || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const mapping = GURU_STOCK_MAPPINGS.find(item => item.cusip === normalizedCusip
    && item.classTitles.some(title => title.toUpperCase() === normalizedClass));
  return mapping ? { ...mapping, classTitles: [...mapping.classTitles] } : null;
}
