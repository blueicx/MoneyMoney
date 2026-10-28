import crypto from 'node:crypto';
import { createEvidenceSnapshot, type EvidenceSnapshot } from './decision-intelligence';
import type { StockNewsSnapshot } from './stock-news';

export interface StockNewsEvidenceCapture {
  version: 2;
  market: 'stocks';
  instrument: string;
  symbol: string;
  source: 'Yahoo Finance';
  publicationRange: { start: string | null; end: string | null };
  retrievedAt: string;
  responseStatus: StockNewsSnapshot['status'];
  responseContentHash: string;
  rawResponseHash: string;
  rawResponseBytes: number;
  responseEvidence: EvidenceSnapshot;
  responseEvidenceRef: string;
  evidence: EvidenceSnapshot[];
  evidenceRefs: string[];
  reason: string;
}

function digest(value: unknown): string {
  const stable = (input: unknown): string => {
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    if (input && typeof input === 'object') {
      return `{${Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(input);
  };
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function validTime(value: unknown, label: string): string {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) throw new Error(`${label}无效`);
  return new Date(parsed).toISOString();
}

/**
 * Freeze one explicit stock-news response as evidence. Publication time and
 * server retrieval time remain separate so a delayed discovery is not
 * presented as contemporaneous knowledge.
 */
export function captureStockNewsEvidence(input: {
  instrument: string;
  symbol: string;
  snapshot: StockNewsSnapshot;
}): StockNewsEvidenceCapture {
  const instrument = String(input.instrument || '').trim();
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const identity = instrument.match(/^stock:(us|nasdaq|nyse):([A-Z][A-Z0-9.-]{0,14})$/i);
  if (!identity || identity[2].toUpperCase() !== symbol) throw new Error('股票新闻证据的规范标的身份与代码不一致');
  if (!input.snapshot || !['live', 'cached'].includes(input.snapshot.status)) throw new Error('股票新闻快照状态无效');
  if (!/^[a-f0-9]{64}$/.test(String(input.snapshot.contentHash || ''))) throw new Error('股票新闻响应 Hash 无效');
  if (!/^[a-f0-9]{64}$/.test(String(input.snapshot.rawResponseHash || ''))) throw new Error('股票新闻原始响应 Hash 无效');
  if (!Number.isSafeInteger(input.snapshot.rawResponseBytes) || input.snapshot.rawResponseBytes < 2 || input.snapshot.rawResponseBytes > 512 * 1024) throw new Error('股票新闻原始响应大小无效');
  let rawBytes: Buffer;
  try {
    rawBytes = Buffer.from(String(input.snapshot.rawResponseBase64 || ''), 'base64');
  } catch {
    throw new Error('股票新闻原始响应不是有效 Base64');
  }
  if (!rawBytes.byteLength || rawBytes.byteLength !== input.snapshot.rawResponseBytes) throw new Error('股票新闻原始响应字节数不一致');
  const actualRawHash = crypto.createHash('sha256').update(rawBytes).digest('hex');
  if (actualRawHash !== input.snapshot.rawResponseHash) throw new Error('股票新闻原始响应 Hash 不一致');
  const rawText = rawBytes.toString('utf8');
  try {
    JSON.parse(rawText);
  } catch {
    throw new Error('股票新闻原始响应不是有效 JSON');
  }
  const retrievedAt = validTime(input.snapshot.retrievedAt, '股票新闻服务器抓取时间');
  if (Date.parse(retrievedAt) > Date.now() + 5_000) throw new Error('股票新闻服务器抓取时间位于未来');

  const responseEvidence = createEvidenceSnapshot({
    id: `news_response_${digest({
      version: 2, instrument, retrievedAt,
      rawResponseHash: input.snapshot.rawResponseHash,
    }).slice(0, 32)}`,
    market: 'stocks',
    instrument,
    workspace: 'event-intelligence',
    dataStatus: input.snapshot.status === 'live' ? 'live' : 'cached',
    source: { id: 'yahoo-finance-news', name: input.snapshot.source, url: null },
    observedAt: retrievedAt,
    fetchedAt: retrievedAt,
    fields: {
      kind: 'news-response',
      symbol,
      responseStatus: input.snapshot.status,
      rawResponseHash: input.snapshot.rawResponseHash,
      rawResponseBytes: input.snapshot.rawResponseBytes,
      rawResponseBase64: input.snapshot.rawResponseBase64,
      normalizedContentHash: input.snapshot.contentHash,
    },
    expectedFields: ['kind', 'symbol', 'responseStatus', 'rawResponseHash', 'rawResponseBytes', 'rawResponseBase64', 'normalizedContentHash'],
    reason: '原始 HTTP 响应字节的 SHA-256 证据；规范化 contentHash 只用于解析后内容比较',
  });

  const publications: string[] = [];
  const evidence = input.snapshot.items.slice(0, 15).map(item => {
    const publishedAt = validTime(item.publishedAt, '来源发布时间');
    if (Date.parse(publishedAt) > Date.parse(retrievedAt) + 300_000) throw new Error('来源发布时间晚于服务器抓取时间');
    const title = String(item.title || '').trim();
    const sourceUrl = String(item.url || '').trim();
    const sourceName = String(item.source || input.snapshot.source).trim();
    if (!title || !/^https?:\/\//i.test(sourceUrl) || !sourceName) throw new Error('股票新闻条目标题或来源无效');
    publications.push(publishedAt);
    const evidenceId = `news_${digest({ version: 1, instrument, sourceUrl, publishedAt, title, sourceName, retrievedAt }).slice(0, 32)}`;
    return createEvidenceSnapshot({
      id: evidenceId,
      market: 'stocks',
      instrument,
      workspace: 'event-intelligence',
      dataStatus: input.snapshot.status === 'live' ? 'live' : 'cached',
      source: { id: 'yahoo-finance-news', name: sourceName, url: sourceUrl },
      observedAt: publishedAt,
      fetchedAt: retrievedAt,
      fields: {
        kind: 'news',
        title,
        publishedAt,
        sourceUrl,
        responseContentHash: input.snapshot.contentHash,
        rawResponseHash: input.snapshot.rawResponseHash,
        responseEvidenceId: responseEvidence.id,
        responseStatus: input.snapshot.status,
      },
      expectedFields: ['kind', 'title', 'publishedAt', 'sourceUrl', 'responseContentHash', 'rawResponseHash', 'responseEvidenceId'],
      reason: '逐条新闻证据分别保留来源发布时间与服务器首次获得该响应的时间；抓取时间不等于交易所或媒体首次发布时间',
    });
  });
  publications.sort();
  return {
    version: 2,
    market: 'stocks',
    instrument,
    symbol,
    source: 'Yahoo Finance',
    publicationRange: { start: publications[0] || null, end: publications.at(-1) || null },
    retrievedAt,
    responseStatus: input.snapshot.status,
    responseContentHash: input.snapshot.contentHash,
    rawResponseHash: input.snapshot.rawResponseHash,
    rawResponseBytes: input.snapshot.rawResponseBytes,
    responseEvidence,
    responseEvidenceRef: responseEvidence.id,
    evidence,
    evidenceRefs: [responseEvidence.id, ...evidence.map(item => item.id)],
    reason: evidence.length
      ? '已冻结明确股票新闻响应；每个条目均可独立引用，历史缺失来源保持未知'
      : '来源查询成功但没有与该股票明确关联的新闻；空结果不代表不存在新闻',
  };
}
