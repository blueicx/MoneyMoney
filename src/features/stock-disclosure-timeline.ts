import { assertMarketContext, type MarketId } from './research-contracts';

type DisclosureChange = 'newly-disclosed' | 'increased' | 'reduced' | 'unchanged' | 'not-disclosed' | 'unavailable';
type SourceStatus = 'ok' | 'stale' | 'partial' | 'unavailable';

export interface Form4TimelineTrade {
  filedAt: string;
  transactionDate: string;
  ownerName: string;
  ownerTitleZh?: string;
  action: 'BUY' | 'SELL' | 'OTHER';
  shares: number;
  priceUsd: number;
  sourceUrl?: string;
}

export interface Form13FTimelineChange {
  mapped: boolean;
  managerName: string;
  reportPeriod: string;
  filedAt: string;
  previousReportPeriod?: string | null;
  previousShares?: number | null;
  shares?: number | null;
  shareDelta?: number | null;
  change: DisclosureChange;
  sourceUrl?: string;
}

export interface StockDisclosureTimelineInput {
  market: MarketId;
  instrument: string;
  retrievedAt: string;
  baseItems: Array<Record<string, unknown>>;
  form4: Form4TimelineTrade[];
  form4Status: string;
  form4Reason?: string | null;
  form4RetrievedAt?: string | null;
  form13f: Form13FTimelineChange[];
  form13fStatus: string;
  form13fReason?: string | null;
  form13fRetrievedAt?: string | null;
}

function isoAtOrBefore(value: unknown, limit: number): string | null {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp <= limit ? new Date(timestamp).toISOString() : null;
}

function officialSecUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'sec.gov' || url.hostname.endsWith('.sec.gov')) ? url.toString() : null;
  } catch { return null; }
}

function normalizeSourceStatus(value: string, emptyIsSuccess: boolean): SourceStatus {
  if (value === 'ok' || (emptyIsSuccess && value === 'empty')) return 'ok';
  if (value === 'cached' || value === 'delayed' || value === 'stale') return 'stale';
  if (value === 'partial') return 'partial';
  return 'unavailable';
}

function formatShares(value: unknown): string | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString('en-US') : null;
}

function form13fChangeText(row: Form13FTimelineChange): string | null {
  const delta = Number(row.shareDelta);
  const deltaText = Number.isFinite(delta) && delta !== 0 ? `${delta > 0 ? '+' : '−'}${Math.abs(Math.round(delta)).toLocaleString('en-US')} 股` : null;
  if (row.change === 'newly-disclosed') return `新进披露 ${formatShares(row.shares) || '数量未披露'} 股`;
  if (row.change === 'increased') return `增持${deltaText ? ` ${deltaText}` : ''}`;
  if (row.change === 'reduced') return `减持${deltaText ? ` ${deltaText}` : ''}`;
  if (row.change === 'not-disclosed') return '上一报告期有披露，本期未披露（不等于清仓）';
  return null;
}

export function mergeStockDisclosureTimeline(input: StockDisclosureTimelineInput): {
  items: Array<Record<string, unknown>>;
  sourceStatus: Record<string, SourceStatus>;
  sectionReasons: Record<string, string>;
} {
  if (input.market !== 'stocks') throw new Error('Stock disclosures can only be merged into the stocks timeline');
  const identity = input.instrument.match(/^stock:(us|nasdaq|nyse):([A-Z][A-Z0-9.-]{0,14})$/i);
  if (!identity) throw new Error('股票披露时间线需要规范的 stock:venue:symbol 标的身份');
  assertMarketContext({ market: 'stocks', instrument: input.instrument, workspace: 'event-intelligence' });
  const now = Date.parse(input.retrievedAt);
  if (!Number.isFinite(now)) throw new Error('股票披露时间线 retrievedAt 无效');

  const items: Array<Record<string, unknown>> = input.baseItems.flatMap(row => {
    if (row.scope && row.scope !== 'stocks') return [];
    if (row.instrumentId && row.instrumentId !== input.instrument) return [];
    return [{ ...row, scope: 'stocks', instrumentId: input.instrument }];
  });
  const form4RetrievedAt = isoAtOrBefore(input.form4RetrievedAt, now) || input.retrievedAt;
  for (const trade of input.form4) {
    if (!['BUY', 'SELL'].includes(trade.action) || !Number.isFinite(Number(trade.shares)) || Number(trade.shares) <= 0) continue;
    const filedAt = isoAtOrBefore(trade.filedAt, now);
    const transactionDate = filedAt && isoAtOrBefore(trade.transactionDate, Date.parse(filedAt));
    const url = officialSecUrl(trade.sourceUrl);
    if (!filedAt || !transactionDate || !url) continue;
    const action = trade.action === 'BUY' ? '买入' : '卖出';
    const price = Number(trade.priceUsd);
    const details = [
      `交易日 ${transactionDate.slice(0, 10)}`,
      `${formatShares(trade.shares)} 股`,
      Number.isFinite(price) && price > 0 ? `约 $${price.toFixed(2)}` : '',
      String(trade.ownerTitleZh || '').trim(),
    ].filter(Boolean).join(' · ');
    items.push({
      kind: 'event', at: filedAt, occurredAt: filedAt, publishedAt: filedAt, retrievedAt: form4RetrievedAt,
      title: `内部人${action} · ${String(trade.ownerName || '申报人').trim()} · ${details}`,
      source: 'SEC EDGAR Form 4', url, scope: 'stocks', instrumentId: input.instrument,
    });
  }

  const form13fRetrievedAt = isoAtOrBefore(input.form13fRetrievedAt, now) || input.retrievedAt;
  for (const disclosure of input.form13f) {
    const filedAt = isoAtOrBefore(disclosure.filedAt, now);
    const reportPeriod = String(disclosure.reportPeriod || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    const url = officialSecUrl(disclosure.sourceUrl);
    const changeText = form13fChangeText(disclosure);
    if (!disclosure.mapped || !filedAt || !reportPeriod || Date.parse(reportPeriod) > Date.parse(filedAt) || !url || !changeText) continue;
    items.push({
      kind: 'event', at: filedAt, occurredAt: filedAt, publishedAt: filedAt, retrievedAt: form13fRetrievedAt,
      title: `13F 持仓披露变化 · ${String(disclosure.managerName || '机构申报人').trim()} · ${reportPeriod} 报告期 · ${changeText}`,
      source: 'SEC EDGAR Form 13F', url, scope: 'stocks', instrumentId: input.instrument,
    });
  }

  const sourceStatus = {
    secForm4: normalizeSourceStatus(input.form4Status, true),
    sec13f: normalizeSourceStatus(input.form13fStatus, true),
  };
  const sectionReasons: Record<string, string> = {};
  if (sourceStatus.secForm4 === 'unavailable') sectionReasons.secForm4 = input.form4Reason || 'SEC Form 4 来源不可用';
  else if (sourceStatus.secForm4 === 'partial') sectionReasons.secForm4 = input.form4Reason || 'SEC Form 4 原文部分读取失败；当前记录仅包含成功解析的申报';
  else if (!input.form4.length) sectionReasons.secForm4 = 'SEC Form 4 查询成功，但近 90 天暂无符合条件的内部人交易记录';
  if (sourceStatus.sec13f === 'unavailable') sectionReasons.sec13f = input.form13fReason || 'SEC 13F 来源或已核验证券映射不可用';
  else if (sourceStatus.sec13f === 'partial') sectionReasons.sec13f = input.form13fReason || 'SEC 13F 部分申报主体或报告期不可用';
  else if (!input.form13f.length) sectionReasons.sec13f = input.form13fReason || '当前可比 13F 报告期没有该证券的持仓变化记录';
  else if (sourceStatus.sec13f === 'stale') sectionReasons.sec13f = input.form13fReason || '13F 是季度披露，最新可用记录可能已延迟';

  items.sort((left, right) => Date.parse(String(right.at || right.occurredAt || 0)) - Date.parse(String(left.at || left.occurredAt || 0)));
  return { items, sourceStatus, sectionReasons };
}
