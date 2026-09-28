export type Guru13FAmendmentType = 'RESTATEMENT' | 'ADD NEW HOLDINGS' | 'UNKNOWN' | null;

export interface Guru13FPosition {
  issuerName: string;
  classTitle: string;
  cusip: string;
  reportedValue: number;
  shares: number;
  putCall: string | null;
  investmentDiscretion: string | null;
}

export interface Guru13FReport {
  positions: Guru13FPosition[];
  cik?: string;
  accession?: string;
  reportPeriod?: string;
  filedAt?: string;
  form?: '13F-HR' | '13F-HR/A';
  sourceUrl?: string;
  fetchedAt?: string;
  contentHash?: string;
  reportedValueUnit?: 'usd' | 'thousand-usd' | 'unknown';
  amendmentNumber?: number | null;
  amendmentType?: Guru13FAmendmentType;
  comparisonAvailable?: boolean;
}

export type GuruHoldingChangeKind =
  | 'newly-disclosed'
  | 'increased'
  | 'reduced'
  | 'unchanged'
  | 'not-disclosed'
  | 'unavailable';

export interface GuruHoldingChange {
  issuerName: string;
  classTitle: string;
  cusip: string;
  putCall: string | null;
  previousShares: number | null;
  currentShares: number | null;
  shareDelta: number | null;
  change: GuruHoldingChangeKind;
}

export interface Guru13FCoverPage {
  amendmentNumber: number | null;
  amendmentType: Guru13FAmendmentType;
}

export interface Guru13FAmendmentResult {
  positions: Guru13FPosition[];
  comparable: boolean;
  reason: string | null;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]{1,6});/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d{1,7});/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function readSingleElement(xml: string, element: string, required = false): string | null {
  const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...xml.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'gi'))];
  if (matches.length > 1) throw new Error(`Ambiguous 13F XML element: ${element}`);
  if (!matches.length) {
    if (required) throw new Error(`Missing 13F XML element: ${element}`);
    return null;
  }
  return decodeXmlText(matches[0][1]);
}

function parseNonNegativeNumber(value: string | null, label: string): number {
  if (value == null || !/^(?:\d+)(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid ${label} in 13F information table`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${label} in 13F information table`);
  return parsed;
}

function positionIdentity(position: Pick<Guru13FPosition, 'cusip' | 'classTitle' | 'putCall'>): string {
  return [String(position.cusip || '').trim().toUpperCase(), String(position.classTitle || '').trim().toUpperCase(), String(position.putCall || '').trim().toUpperCase()].join('\u0000');
}

function hasDuplicateIdentities(positions: Guru13FPosition[]): boolean {
  const seen = new Set<string>();
  for (const position of positions) {
    const identity = positionIdentity(position);
    if (seen.has(identity)) return true;
    seen.add(identity);
  }
  return false;
}

export function parse13FInformationTable(xml: string): Guru13FPosition[] {
  if (typeof xml !== 'string' || !/<informationTable\b[^>]*>/i.test(xml) || !/<\/informationTable\s*>/i.test(xml)) {
    throw new Error('Malformed 13F information table XML');
  }
  const openCount = [...xml.matchAll(/<infoTable\b[^>]*>/gi)].length;
  const closeCount = [...xml.matchAll(/<\/infoTable\s*>/gi)].length;
  const blocks = [...xml.matchAll(/<infoTable\b[^>]*>([\s\S]*?)<\/infoTable\s*>/gi)];
  if (openCount !== closeCount || blocks.length !== openCount) throw new Error('Malformed 13F information table XML');

  const positions = blocks.map((match): Guru13FPosition => {
    const block = match[1];
    const issuerName = readSingleElement(block, 'nameOfIssuer', true) || '';
    const classTitle = readSingleElement(block, 'titleOfClass', true) || '';
    const cusip = (readSingleElement(block, 'cusip', true) || '').toUpperCase();
    if (!issuerName || !classTitle || !/^[A-Z0-9*@#]{9}$/.test(cusip)) {
      throw new Error('Invalid issuer, class, or CUSIP in 13F information table');
    }

    const amountBlock = readSingleElement(block, 'shrsOrPrnAmt', true);
    if (!amountBlock) throw new Error('Missing 13F share amount');
    const shares = parseNonNegativeNumber(readSingleElement(amountBlock, 'sshPrnamt', true), 'share count');
    const reportedValue = parseNonNegativeNumber(readSingleElement(block, 'value', true), 'reported value');
    const putCall = readSingleElement(block, 'putCall')?.toUpperCase() || null;
    const investmentDiscretion = readSingleElement(block, 'investmentDiscretion');

    return { issuerName, classTitle, cusip, reportedValue, shares, putCall, investmentDiscretion };
  });

  if (hasDuplicateIdentities(positions)) throw new Error('Duplicate 13F position identity is ambiguous');
  return positions;
}

export function parse13FCoverPage(xml: string): Guru13FCoverPage {
  const amendmentFlag = readSingleElement(xml, 'isAmendment')?.toLowerCase();
  if (amendmentFlag === 'false' || amendmentFlag === 'no') return { amendmentNumber: 0, amendmentType: null };
  if (amendmentFlag !== 'true' && amendmentFlag !== 'yes') return { amendmentNumber: null, amendmentType: 'UNKNOWN' };

  const rawNumber = readSingleElement(xml, 'amendmentNo');
  const parsedNumber = rawNumber && /^\d+$/.test(rawNumber) ? Number(rawNumber) : null;
  const rawType = (readSingleElement(xml, 'amendmentType') || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();
  const amendmentType: Guru13FAmendmentType = rawType === 'RESTATEMENT' || rawType === 'ADD NEW HOLDINGS' ? rawType : 'UNKNOWN';
  return {
    amendmentNumber: parsedNumber != null && Number.isSafeInteger(parsedNumber) ? parsedNumber : null,
    amendmentType,
  };
}

export function apply13FAmendment(base: Guru13FReport, amendment: Guru13FReport): Guru13FAmendmentResult {
  const unavailable = (reason: string): Guru13FAmendmentResult => ({ positions: [], comparable: false, reason });
  if (amendment.amendmentType === 'UNKNOWN' || amendment.comparisonAvailable === false) {
    return unavailable('amendment-type-unknown');
  }
  if (amendment.amendmentType === 'RESTATEMENT') {
    if (hasDuplicateIdentities(amendment.positions)) return unavailable('ambiguous-restatement-identities');
    return { positions: amendment.positions.slice(), comparable: true, reason: null };
  }
  if (amendment.amendmentType === 'ADD NEW HOLDINGS') {
    if (hasDuplicateIdentities(base.positions) || hasDuplicateIdentities(amendment.positions)) {
      return unavailable('ambiguous-additive-amendment-identities');
    }
    const seen = new Set(base.positions.map(positionIdentity));
    if (amendment.positions.some(position => seen.has(positionIdentity(position)))) {
      return unavailable('additive-amendment-duplicates-existing-position');
    }
    return { positions: [...base.positions, ...amendment.positions], comparable: true, reason: null };
  }
  return unavailable('not-an-amendment');
}

export function compare13FReports(previous: Guru13FReport | null, current: Guru13FReport): GuruHoldingChange[] {
  if (current.comparisonAvailable === false || current.amendmentType === 'UNKNOWN'
    || (previous && (previous.comparisonAvailable === false || previous.amendmentType === 'UNKNOWN'))) {
    return current.positions.map(position => ({
      issuerName: position.issuerName,
      classTitle: position.classTitle,
      cusip: position.cusip,
      putCall: position.putCall,
      previousShares: null,
      currentShares: position.shares,
      shareDelta: null,
      change: 'unavailable',
    }));
  }

  if (!previous) {
    return current.positions.map(position => ({
      issuerName: position.issuerName,
      classTitle: position.classTitle,
      cusip: position.cusip,
      putCall: position.putCall,
      previousShares: null,
      currentShares: position.shares,
      shareDelta: null,
      change: 'unavailable',
    }));
  }
  if (hasDuplicateIdentities(previous.positions) || hasDuplicateIdentities(current.positions)) {
    return current.positions.map(position => ({
      issuerName: position.issuerName,
      classTitle: position.classTitle,
      cusip: position.cusip,
      putCall: position.putCall,
      previousShares: null,
      currentShares: position.shares,
      shareDelta: null,
      change: 'unavailable',
    }));
  }

  const previousByIdentity = new Map(previous.positions.map(position => [positionIdentity(position), position]));
  const currentByIdentity = new Map(current.positions.map(position => [positionIdentity(position), position]));
  const identities = new Set([...previousByIdentity.keys(), ...currentByIdentity.keys()]);
  return [...identities].sort().map(identity => {
    const before = previousByIdentity.get(identity);
    const after = currentByIdentity.get(identity);
    const position = after || before!;
    const delta = before && after ? after.shares - before.shares : null;
    return {
      issuerName: String(position.issuerName || ''),
      classTitle: String(position.classTitle || ''),
      cusip: String(position.cusip || ''),
      putCall: position.putCall,
      previousShares: before?.shares ?? null,
      currentShares: after?.shares ?? null,
      shareDelta: delta,
      change: !before ? 'newly-disclosed' : !after ? 'not-disclosed' : delta! > 0 ? 'increased' : delta! < 0 ? 'reduced' : 'unchanged',
    };
  });
}
