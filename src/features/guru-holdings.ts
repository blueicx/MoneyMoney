import { createHash } from 'node:crypto';
import { loadSec13FDocuments, loadSec13FSubmissions, normalizeSecCik, Sec13FFiling } from './sec-edgar-client';
import { researchRepository } from './research-repository';
import { SQLiteStateStore, stateStore } from '../storage/sqlite-state';
import {
  GURU_MANAGER_REGISTRY,
  GURU_STOCK_MAPPINGS,
  getGuruManager,
  resolveGuruMappingByCusip,
  searchGuruManagerRegistry,
  GuruManagerDefinition,
} from './guru-holdings-registry';

export type Guru13FAmendmentType = 'RESTATEMENT' | 'ADD NEW HOLDINGS' | 'UNKNOWN' | null;

export interface Guru13FPosition {
  issuerName: string;
  classTitle: string;
  cusip: string;
  reportedValue: number;
  shares: number;
  putCall: string | null;
  investmentDiscretion: string | null;
  reportedValueUsd?: number | null;
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
  managerName?: string;
  informationTableUrl?: string;
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

export type GuruHoldingsDataStatus = 'cached' | 'delayed' | 'partial' | 'empty' | 'unavailable';

export interface GuruManagerSnapshot {
  market: 'stocks';
  instrument: null;
  dataStatus: GuruHoldingsDataStatus;
  source: string;
  updatedAt: string | null;
  reason: string | null;
  evidenceRefs: string[];
  manager: GuruManagerDefinition & { filerName: string | null };
  latestReport: Guru13FReport | null;
  previousReport: Guru13FReport | null;
  changes: GuruHoldingChange[];
  caveats: string[];
}

export interface GuruStockHolderRow {
  manager: GuruManagerDefinition & { filerName: string | null };
  reportPeriod: string;
  filedAt: string;
  sourceUrl: string;
  shares: number | null;
  reportedValueUsd: number | null;
  portfolioWeightPct: number | null;
  previousShares: number | null;
  shareDelta: number | null;
  change: GuruHoldingChangeKind;
}

export interface GuruStockHoldersSnapshot {
  market: 'stocks';
  instrument: string;
  dataStatus: GuruHoldingsDataStatus;
  source: string;
  updatedAt: string | null;
  reason: string | null;
  evidenceRefs: string[];
  mapping: { cusip: string; classTitle: string; issuerName: string } | null;
  holders: GuruStockHolderRow[];
  caveats: string[];
}

interface GuruRefreshState {
  checkedAt: string;
  dataStatus: 'cached' | 'partial' | 'empty' | 'unavailable';
  reason: string | null;
}

export interface GuruHoldingsServiceDependencies {
  repository: Pick<typeof researchRepository, 'listGuru13FReports' | 'saveGuru13FReport'>;
  stateStore: Pick<SQLiteStateStore, 'get' | 'set' | 'acquireLease' | 'releaseLease'>;
  loadSubmissions: typeof loadSec13FSubmissions;
  loadDocuments: typeof loadSec13FDocuments;
  now: () => Date;
  owner: string;
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

const GURU_SOURCE = 'SEC EDGAR Form 13F';
const GURU_CACHE_TTL_MS = 24 * 60 * 60_000;
const GURU_REFRESH_LEASE_MS = 2 * 60_000;
const GURU_POSITION_CAVEATS = [
  'Form 13F 是季度披露，通常可在报告期结束后最多 45 天提交；不是实时持仓。',
  '13F 仅覆盖应申报的部分美国证券多头，不代表管理人的完整组合，也不披露空头。',
  '未在最新申报中出现表示“未披露”，不能据此认定清仓。',
];

function guruStatusKey(cik: string): string { return `guru13f:manager:${cik}:status`; }
function guruLeaseKey(cik: string): string { return `guru13f:refresh:${cik}`; }

function cacheIsFresh(at: string | null | undefined, nowMs: number): boolean {
  const timestamp = Date.parse(String(at || ''));
  return Number.isFinite(timestamp) && timestamp <= nowMs && nowMs - timestamp <= GURU_CACHE_TTL_MS;
}

function managerDefinition(cik: string, filerName: string | null = null): GuruManagerDefinition & { filerName: string | null } {
  const registered = getGuruManager(cik);
  return {
    ...(registered || { cik, filingName: filerName || `SEC 申报主体 ${cik}`, aliases: [] }),
    filerName,
  };
}

function effectiveGuruReports(input: Guru13FReport[]): Guru13FReport[] {
  const byPeriod = new Map<string, Guru13FReport[]>();
  for (const report of input) {
    if (!report.reportPeriod) continue;
    const group = byPeriod.get(report.reportPeriod) || [];
    group.push(report);
    byPeriod.set(report.reportPeriod, group);
  }
  const effective: Guru13FReport[] = [];
  for (const [reportPeriod, group] of byPeriod) {
    group.sort((a, b) => String(a.filedAt || '').localeCompare(String(b.filedAt || ''))
      || String(a.accession || '').localeCompare(String(b.accession || '')));
    let current: Guru13FReport | null = null;
    for (const report of group) {
      if (report.form !== '13F-HR/A') {
        current = { ...report, comparisonAvailable: report.comparisonAvailable !== false };
        continue;
      }
      if (!current) {
        current = { ...report, comparisonAvailable: false, amendmentType: report.amendmentType || 'UNKNOWN' };
        continue;
      }
      const amended = apply13FAmendment(current, report);
      current = amended.comparable
        ? { ...report, reportPeriod, positions: amended.positions, comparisonAvailable: true }
        : { ...report, reportPeriod, positions: current.positions, comparisonAvailable: false, amendmentType: 'UNKNOWN' };
    }
    if (current) effective.push(current);
  }
  return effective.sort((a, b) => String(b.reportPeriod || '').localeCompare(String(a.reportPeriod || ''))
    || String(b.filedAt || '').localeCompare(String(a.filedAt || '')));
}

function positionReportedValueUsd(position: Guru13FPosition, report: Guru13FReport): number | null {
  if (Number.isFinite(position.reportedValueUsd) && Number(position.reportedValueUsd) >= 0) return Number(position.reportedValueUsd);
  if (report.reportedValueUnit === 'usd' && Number.isFinite(position.reportedValue)) return position.reportedValue;
  if (report.reportedValueUnit === 'thousand-usd' && Number.isFinite(position.reportedValue)) return position.reportedValue * 1_000;
  return null;
}

export function createGuruHoldingsService(overrides: Partial<GuruHoldingsServiceDependencies> = {}) {
  const repository = overrides.repository || researchRepository;
  const store = overrides.stateStore || stateStore;
  const loadSubmissions = overrides.loadSubmissions || loadSec13FSubmissions;
  const loadDocuments = overrides.loadDocuments || loadSec13FDocuments;
  const now = overrides.now || (() => new Date());
  const owner = overrides.owner || `guru13f-${process.pid}`;

  function getGuruManagerSnapshot(cikInput: string): GuruManagerSnapshot {
    const cik = normalizeSecCik(cikInput);
    const savedReports = repository.listGuru13FReports(cik, 500);
    const reports = effectiveGuruReports(savedReports);
    const latestReport = reports[0] || null;
    const previousReport = reports[1] || null;
    const state = store.get<GuruRefreshState>(guruStatusKey(cik));
    const updatedAt = latestReport?.fetchedAt || state?.checkedAt || null;
    const isFresh = cacheIsFresh(updatedAt, now().getTime());
    let dataStatus: GuruHoldingsDataStatus;
    let reason: string | null = null;
    if (!latestReport) {
      if (!state) {
        dataStatus = 'unavailable';
        reason = '尚无 SEC 13F 快照；需要管理员刷新或等待每日检查。';
      } else if (state.dataStatus === 'empty') {
        dataStatus = isFresh ? 'empty' : 'delayed';
        reason = isFresh ? state.reason || 'SEC 查询成功，但没有可用的 13F 申报。' : '上次成功检查已超过 24 小时，暂无可用的 13F 快照。';
      } else {
        dataStatus = 'unavailable';
        reason = state.reason || 'SEC 申报来源不可用。';
      }
    } else if (!isFresh || state?.dataStatus === 'unavailable' || state?.dataStatus === 'partial') {
      dataStatus = state?.dataStatus === 'partial' ? 'partial' : 'delayed';
      reason = state?.reason
        ? `SEC 最近检查异常，当前展示已保存申报：${state.reason}`
        : 'SEC 快照缓存超过 24 小时；当前数据仍是报告期持仓，不是实时仓位。';
    } else if (latestReport.comparisonAvailable === false || latestReport.reportedValueUnit === 'unknown') {
      dataStatus = 'partial';
      reason = latestReport.comparisonAvailable === false
        ? '当前期包含无法安全合并的 13F 修订，持仓变化不可比较。'
        : '申报金额单位无法确认，已隐藏市值权重。';
    } else {
      dataStatus = 'cached';
    }

    return {
      market: 'stocks',
      instrument: null,
      dataStatus,
      source: GURU_SOURCE,
      updatedAt,
      reason,
      evidenceRefs: reports.flatMap(report => [report.sourceUrl, report.informationTableUrl || '']).filter((value): value is string => !!value),
      manager: managerDefinition(cik, latestReport?.managerName || null),
      latestReport,
      previousReport,
      changes: latestReport ? compare13FReports(previousReport, latestReport) : [],
      caveats: GURU_POSITION_CAVEATS.slice(),
    };
  }

  async function listGuruManagers(query = '') {
    const normalizedQuery = String(query || '').trim();
    let definitions = searchGuruManagerRegistry(normalizedQuery);
    if (/^\d{1,10}$/.test(normalizedQuery)) {
      const cik = normalizeSecCik(normalizedQuery);
      if (!definitions.some(item => item.cik === cik)) definitions = [{ cik, filingName: `SEC 申报主体 ${cik}`, aliases: [] }];
    }
    const unique = [...new Map(definitions.map(item => [item.cik, item])).values()];
    return unique.map(definition => {
      const snapshot = getGuruManagerSnapshot(definition.cik);
      return {
        ...definition,
        filerName: snapshot.manager.filerName,
        dataStatus: snapshot.dataStatus,
        updatedAt: snapshot.updatedAt,
        reportPeriod: snapshot.latestReport?.reportPeriod || null,
        filedAt: snapshot.latestReport?.filedAt || null,
        reason: snapshot.reason,
      };
    });
  }

  async function getGuruStockHolders(symbolInput: string, ciksInput?: string[]) : Promise<GuruStockHoldersSnapshot> {
    const symbol = String(symbolInput || '').trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,15}$/.test(symbol)) throw new Error('请输入有效的美股代码');
    const stockMapping = GURU_STOCK_MAPPINGS.find(item => item.symbol === symbol);
    if (!stockMapping) {
      return {
        market: 'stocks', instrument: symbol, dataStatus: 'unavailable', source: 'SEC CUSIP/class registry',
        updatedAt: null, reason: '该股票尚无已核验的 SEC CUSIP 与证券类别映射，不能按公司名称猜测持仓。',
        evidenceRefs: [], mapping: null, holders: [], caveats: GURU_POSITION_CAVEATS.slice(),
      };
    }
    const ciks = ciksInput?.length
      ? [...new Set(ciksInput.map(value => normalizeSecCik(value)))]
      : GURU_MANAGER_REGISTRY.map(item => item.cik);
    const snapshots = ciks.map(cik => getGuruManagerSnapshot(cik));
    const holders: GuruStockHolderRow[] = [];
    for (const snapshot of snapshots) {
      const current = snapshot.latestReport;
      if (!current) continue;
      const changes = compare13FReports(snapshot.previousReport, current).filter(item => resolveGuruMappingByCusip(item.cusip, item.classTitle)?.symbol === symbol);
      for (const change of changes) {
        const currentPosition = current.positions.find(item => item.cusip === change.cusip
          && item.classTitle.toUpperCase() === change.classTitle.toUpperCase()
          && String(item.putCall || '').toUpperCase() === String(change.putCall || '').toUpperCase());
        const previousPosition = snapshot.previousReport?.positions.find(item => item.cusip === change.cusip
          && item.classTitle.toUpperCase() === change.classTitle.toUpperCase()
          && String(item.putCall || '').toUpperCase() === String(change.putCall || '').toUpperCase());
        const valueUsd = currentPosition ? positionReportedValueUsd(currentPosition, current) : null;
        const values = current.positions.map(item => positionReportedValueUsd(item, current));
      const totalUsd = values.every((value): value is number => value != null && Number.isFinite(value))
        ? values.reduce((sum, value) => sum + value, 0)
        : null;
        holders.push({
          manager: snapshot.manager,
          reportPeriod: current.reportPeriod || '',
          filedAt: current.filedAt || '',
          sourceUrl: current.informationTableUrl || current.sourceUrl || snapshot.previousReport?.sourceUrl || '',
          shares: currentPosition?.shares ?? null,
          reportedValueUsd: valueUsd,
          portfolioWeightPct: valueUsd != null && totalUsd != null && totalUsd > 0 ? Math.round(valueUsd / totalUsd * 100_000) / 1_000 : null,
          previousShares: previousPosition?.shares ?? null,
          shareDelta: change.shareDelta,
          change: change.change,
        });
      }
    }
    holders.sort((a, b) => (b.shares || 0) - (a.shares || 0) || a.manager.filingName.localeCompare(b.manager.filingName));
    const statusRank: Record<GuruHoldingsDataStatus, number> = { cached: 0, empty: 1, delayed: 2, partial: 3, unavailable: 4 };
    const worstStatus = snapshots.map(item => item.dataStatus).sort((a, b) => statusRank[b] - statusRank[a])[0] || 'unavailable';
    const dataStatus: GuruHoldingsDataStatus = holders.length
      ? (worstStatus === 'cached' ? 'cached' : worstStatus === 'delayed' ? 'delayed' : 'partial')
      : snapshots.some(item => item.latestReport)
        ? (worstStatus === 'delayed' ? 'delayed' : 'empty')
        : snapshots.every(item => item.dataStatus === 'empty') ? 'empty' : 'unavailable';
    const updatedAt = snapshots.map(item => item.updatedAt).filter((value): value is string => !!value).sort().at(-1) || null;
    const reason = holders.length
      ? (dataStatus === 'partial' ? '部分申报主体的数据不可用或修订类型不明；表中仅列出可核验的披露。' : dataStatus === 'delayed' ? '结果来自超过 24 小时未检查的 SEC 缓存。' : null)
      : dataStatus === 'empty'
        ? '已读取所选 13F 报告，但当前报告未披露该 CUSIP/类别；这不等同于清仓。'
        : '没有可用的 SEC 13F 快照；请检查来源状态或由管理员刷新。';
    return {
      market: 'stocks', instrument: symbol, dataStatus, source: GURU_SOURCE, updatedAt, reason,
      evidenceRefs: [...new Set(holders.map(row => row.sourceUrl).filter(Boolean))],
      mapping: { cusip: stockMapping.cusip, classTitle: stockMapping.classTitles.join(' / '), issuerName: stockMapping.issuerName },
      holders,
      caveats: GURU_POSITION_CAVEATS.slice(),
    };
  }

  async function refreshGuruManager(cikInput: string, force = false): Promise<GuruManagerSnapshot> {
    const cik = normalizeSecCik(cikInput);
    const key = guruStatusKey(cik);
    const nowDate = now();
    const oldState = store.get<GuruRefreshState>(key);
    if (!force && oldState && cacheIsFresh(oldState.checkedAt, nowDate.getTime())) return getGuruManagerSnapshot(cik);
    const leaseKey = guruLeaseKey(cik);
    if (!store.acquireLease(leaseKey, owner, nowDate.getTime(), GURU_REFRESH_LEASE_MS)) {
      const current = getGuruManagerSnapshot(cik);
      return { ...current, reason: current.reason || '该 SEC 申报主体正在由另一个实例刷新。' };
    }

    try {
      const submissions = await loadSubmissions(cik);
      const periods = [...new Set(submissions.filings.map(filing => filing.reportPeriod))].sort((a, b) => b.localeCompare(a)).slice(0, 2);
      if (!periods.length) {
        store.set(key, { checkedAt: now().toISOString(), dataStatus: 'empty', reason: 'SEC submissions 查询成功，但没有有效的 13F-HR 申报。' } satisfies GuruRefreshState);
        return getGuruManagerSnapshot(cik);
      }
      const existing = repository.listGuru13FReports(cik, 500);
      const existingAccessions = new Set(existing.map(report => report.accession));
      const selected = submissions.filings.filter(filing => periods.includes(filing.reportPeriod))
        .sort((a, b) => a.reportPeriod.localeCompare(b.reportPeriod) || a.filingDate.localeCompare(b.filingDate)
          || a.accessionNumber.localeCompare(b.accessionNumber));
      const pending = selected.filter(filing => !existingAccessions.has(filing.accessionNumber));
      let saved = 0;
      const failures: string[] = [];
      for (const filing of pending) {
        try {
          const documents = await loadDocuments(cik, filing);
          const parsedPositions = parse13FInformationTable(documents.informationTableXml);
          const cover = documents.coverPageXml ? parse13FCoverPage(documents.coverPageXml)
            : filing.form === '13F-HR' ? { amendmentNumber: 0, amendmentType: null as Guru13FAmendmentType }
              : { amendmentNumber: null, amendmentType: 'UNKNOWN' as Guru13FAmendmentType };
          const isAmendment = filing.form === '13F-HR/A';
          const amendmentMismatch = isAmendment
            ? cover.amendmentType !== 'RESTATEMENT' && cover.amendmentType !== 'ADD NEW HOLDINGS'
            : cover.amendmentNumber != null && cover.amendmentNumber > 0;
          const fetchedAt = now().toISOString();
          const content = `${documents.informationTableXml}\n${documents.coverPageXml || ''}`;
          const report: Guru13FReport = {
            cik,
            accession: filing.accessionNumber,
            reportPeriod: filing.reportPeriod,
            filedAt: filing.filingDate,
            form: filing.form,
            sourceUrl: documents.sourceUrl,
            informationTableUrl: documents.informationTableUrl,
            fetchedAt,
            contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
            ...(submissions.companyName ? { managerName: submissions.companyName } : {}),
            reportedValueUnit: 'thousand-usd',
            amendmentNumber: cover.amendmentNumber,
            amendmentType: amendmentMismatch ? 'UNKNOWN' : cover.amendmentType,
            comparisonAvailable: !amendmentMismatch,
            positions: parsedPositions.map(position => ({ ...position, reportedValueUsd: position.reportedValue * 1_000 })),
          };
          repository.saveGuru13FReport(report);
          existingAccessions.add(filing.accessionNumber);
          saved += 1;
        } catch (error) {
          failures.push(`${filing.accessionNumber}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const hasStoredData = repository.listGuru13FReports(cik, 1).length > 0;
      const dataStatus: GuruRefreshState['dataStatus'] = failures.length
        ? hasStoredData ? 'partial' : 'unavailable'
        : hasStoredData ? 'cached' : saved > 0 ? 'cached' : 'unavailable';
      store.set(key, {
        checkedAt: now().toISOString(),
        dataStatus,
        reason: failures.length ? failures.join('；') : null,
      } satisfies GuruRefreshState);
      return getGuruManagerSnapshot(cik);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      store.set(key, { checkedAt: now().toISOString(), dataStatus: 'unavailable', reason } satisfies GuruRefreshState);
      return getGuruManagerSnapshot(cik);
    } finally {
      store.releaseLease(leaseKey, owner);
    }
  }

  async function refreshGuruFeaturedManagers(force = false): Promise<GuruManagerSnapshot[]> {
    const results: GuruManagerSnapshot[] = [];
    for (const definition of GURU_MANAGER_REGISTRY) {
      try { results.push(await refreshGuruManager(definition.cik, force)); }
      catch { results.push(getGuruManagerSnapshot(definition.cik)); }
    }
    return results;
  }

  return { listGuruManagers, getGuruManagerSnapshot, getGuruStockHolders, refreshGuruManager, refreshGuruFeaturedManagers };
}

const defaultGuruHoldingsService = createGuruHoldingsService();
export const listGuruManagers = defaultGuruHoldingsService.listGuruManagers;
export const getGuruManagerSnapshot = defaultGuruHoldingsService.getGuruManagerSnapshot;
export const getGuruStockHolders = defaultGuruHoldingsService.getGuruStockHolders;
export const refreshGuruManager = defaultGuruHoldingsService.refreshGuruManager;
export const refreshGuruFeaturedManagers = defaultGuruHoldingsService.refreshGuruFeaturedManagers;
