import { createHash } from 'node:crypto';
import { EVIDENCE_MARKETS, type EvidenceMarket } from './evidence-contract';

/**
 * Cross-project text search over a rebuildable index. The index is derived
 * data: callers rebuild it from their stores, and this module never persists
 * anything. Permission filtering happens before scoring so denied rows cannot
 * leak through counts, snippets or ordering.
 */

export const SEARCH_DOCUMENT_TYPES = ['project', 'workspace', 'decision', 'evidence', 'report', 'journal'] as const;
export type SearchDocumentType = (typeof SEARCH_DOCUMENT_TYPES)[number];

export interface WorkspaceSearchDocument {
  id: string;
  type: SearchDocumentType;
  market: EvidenceMarket;
  title: string;
  text: string;
  updatedAt: string;
  projectId?: string;
  ownerAdmin: true;
}

export interface WorkspaceSearchIndex {
  digest: string;
  documents: WorkspaceSearchDocument[];
}

export interface SearchOptions {
  market?: string;
  types?: readonly string[];
  from?: string;
  to?: string;
  limit?: number;
  now?: number;
}

export interface SearchHit {
  id: string;
  type: SearchDocumentType;
  market: EvidenceMarket;
  title: string;
  snippet: string;
  updatedAt: string;
  projectId?: string;
  score: number;
}

function normalizeDocument(value: unknown): WorkspaceSearchDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('索引文档必须是对象');
  const row = value as Record<string, unknown>;
  const allowed = ['id', 'type', 'market', 'title', 'text', 'updatedAt', 'projectId', 'ownerAdmin'];
  if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error('索引文档包含未支持字段');
  const text = (input: unknown, label: string, max: number) => {
    if (typeof input !== 'string' || !input.trim() || input.length > max) throw new Error(`${label}无效`);
    return input.trim();
  };
  const market = String(row.market) as EvidenceMarket;
  if (!EVIDENCE_MARKETS.includes(market)) throw new Error('索引文档市场无效');
  const type = String(row.type) as SearchDocumentType;
  if (!SEARCH_DOCUMENT_TYPES.includes(type)) throw new Error('索引文档类型无效');
  if (row.ownerAdmin !== true) throw new Error('只允许索引管理员记录');
  if (typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error('索引文档更新时间无效');
  const source: WorkspaceSearchDocument = {
    id: text(row.id, '索引文档身份', 240),
    type,
    market,
    title: text(row.title, '索引标题', 240),
    text: text(row.text, '索引正文', 20000),
    updatedAt: new Date(Date.parse(row.updatedAt)).toISOString(),
    ownerAdmin: true,
  };
  if (row.projectId !== undefined) source.projectId = text(row.projectId, '索引项目身份', 240);
  return source;
}

export function buildWorkspaceSearchIndex(input: readonly unknown[]): WorkspaceSearchIndex {
  if (!Array.isArray(input)) throw new Error('索引输入必须是数组');
  const seen = new Set<string>();
  const documents = input.map(value => {
    const document = normalizeDocument(value);
    const key = `${document.type}:${document.id}`;
    if (seen.has(key)) throw new Error(`索引文档重复：${key}`);
    seen.add(key);
    return document;
  });
  return { digest: createHash('sha256').update(JSON.stringify(documents)).digest('hex'), documents };
}

function snippet(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase();
  const first = terms.map(term => lower.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 60);
  const end = Math.min(text.length, start + 180);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function searchWorkspaceIndex(
  index: WorkspaceSearchIndex,
  query: string,
  canRead: (document: WorkspaceSearchDocument) => boolean,
  options: SearchOptions = {},
): { query: string; total: number; truncated: boolean; indexDigest: string; hits: SearchHit[] } {
  if (!index || typeof index !== 'object' || !Array.isArray(index.documents)) throw new Error('检索索引不可用');
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('检索词必须为 1–200 字');
  if (typeof canRead !== 'function') throw new Error('检索缺少权限判断');
  const limit = options.limit === undefined ? 30 : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('检索条数必须是 1–100 的整数');
  const from = options.from === undefined ? null : Date.parse(options.from);
  const to = options.to === undefined ? null : Date.parse(options.to);
  if (from !== null && !Number.isFinite(from)) throw new Error('起始时间无效');
  if (to !== null && !Number.isFinite(to)) throw new Error('结束时间无效');
  const types = options.types === undefined ? null : new Set(options.types);
  if (types && [...types].some(type => !SEARCH_DOCUMENT_TYPES.includes(type as SearchDocumentType))) throw new Error('检索类型无效');
  const market = options.market;
  if (market !== undefined && !EVIDENCE_MARKETS.includes(market as EvidenceMarket)) throw new Error('检索市场无效');
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  const now = options.now ?? Date.now();
  const hits: SearchHit[] = [];
  index.documents.forEach(document => {
    if (market && document.market !== market) return;
    if (types && !types.has(document.type)) return;
    const updated = Date.parse(document.updatedAt);
    if (from !== null && updated < from) return;
    if (to !== null && updated > to) return;
    if (!canRead(document)) return;
    const haystack = `${document.title}\n${document.text}`.toLowerCase();
    if (!terms.every(term => haystack.includes(term))) return;
    const titleLower = document.title.toLowerCase();
    const titleHits = terms.filter(term => titleLower.includes(term)).length;
    const occurrences = terms.reduce((sum, term) => sum + haystack.split(term).length - 1, 0);
    const ageDays = Math.max(0, (now - updated) / 86_400_000);
    const recency = 1 / (1 + ageDays / 30);
    const score = Number((titleHits * 5 + Math.min(occurrences, 20) + recency).toFixed(4));
    hits.push({
      id: document.id,
      type: document.type,
      market: document.market,
      title: document.title,
      snippet: snippet(document.text, terms),
      updatedAt: document.updatedAt,
      ...(document.projectId ? { projectId: document.projectId } : {}),
      score,
    });
  });
  hits.sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  return { query, total: hits.length, truncated: hits.length > limit, indexDigest: index.digest, hits: hits.slice(0, limit) };
}
