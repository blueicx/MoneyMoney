/**
 * Unified audit timeline. It reads append-only logs that already exist and
 * merges them; it does not create a second source of truth. Records without
 * an actor stay explicit about that instead of guessing a user.
 */

export const AUDIT_CATEGORIES = ['auth', 'research', 'recovery', 'ledger', 'account', 'report', 'other'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface RawAuditEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
  actor?: string | null;
  projectId?: string | null;
  market?: string | null;
  category?: AuditCategory;
}

export interface AuditTimelineEvent {
  id: string;
  at: string;
  category: AuditCategory;
  action: string;
  actor: string | null;
  projectId: string | null;
  market: string | null;
  detail: string;
}

export interface AuditTimeline {
  generatedAt: string;
  total: number;
  truncated: boolean;
  categories: Record<AuditCategory, number>;
  events: AuditTimelineEvent[];
  contentHash: string;
}

function classify(action: string): AuditCategory {
  if (/^(guest_session|login|logout|session|auth)/i.test(action)) return 'auth';
  if (/^research-project/i.test(action)) return 'research';
  if (/(recovery|rollback|restore)/i.test(action)) return 'recovery';
  if (/(import|ledger)/i.test(action)) return 'ledger';
  if (/(paper|account)/i.test(action)) return 'account';
  if (/(report|export)/i.test(action)) return 'report';
  return 'other';
}

function parseDetail(detail: string): { projectId: string | null; market: string | null } {
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    return {
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      market: typeof parsed.market === 'string' ? parsed.market : null,
    };
  } catch {
    return { projectId: null, market: null };
  }
}

import { createHash } from 'node:crypto';

export function buildAuditTimeline(input: {
  entries: readonly RawAuditEntry[];
  from?: string;
  to?: string;
  category?: string;
  projectId?: string;
  limit?: number;
  now?: number;
}): AuditTimeline {
  if (!input || !Array.isArray(input.entries)) throw new Error('审计输入必须是数组');
  const limit = input.limit === undefined ? 200 : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('审计条数必须是 1–500 的整数');
  const from = input.from === undefined ? null : Date.parse(input.from);
  const to = input.to === undefined ? null : Date.parse(input.to);
  if (from !== null && !Number.isFinite(from)) throw new Error('起始时间无效');
  if (to !== null && !Number.isFinite(to)) throw new Error('结束时间无效');
  if (input.category !== undefined && !AUDIT_CATEGORIES.includes(input.category as AuditCategory)) throw new Error('审计分类无效');
  if (input.projectId !== undefined && (typeof input.projectId !== 'string' || input.projectId.length > 240)) throw new Error('审计项目筛选无效');
  const now = input.now ?? Date.now();
  const events: AuditTimelineEvent[] = [];
  const seen = new Set<string>();
  input.entries.forEach(entry => {
    if (!entry || typeof entry !== 'object') throw new Error('审计记录必须是对象');
    const at = typeof entry.at === 'string' ? Date.parse(entry.at) : NaN;
    if (!Number.isFinite(at) || at > now + 1000) throw new Error('审计时间无效');
    if (typeof entry.action !== 'string' || !entry.action.trim() || entry.action.length > 120) throw new Error('审计动作无效');
    const category = entry.category ?? classify(entry.action);
    if (!AUDIT_CATEGORIES.includes(category)) throw new Error('审计分类无效');
    const parsed = parseDetail(String(entry.detail ?? ''));
    const projectId = entry.projectId ?? parsed.projectId;
    const market = entry.market ?? parsed.market;
    if (input.category && category !== input.category) return;
    if (input.projectId && projectId !== input.projectId) return;
    if (from !== null && at < from) return;
    if (to !== null && at > to) return;
    const key = `${category}:${entry.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push({
      id: String(entry.id),
      at: new Date(at).toISOString(),
      category,
      action: entry.action,
      actor: typeof entry.actor === 'string' && entry.actor.trim() ? entry.actor.trim() : null,
      projectId: projectId ?? null,
      market: market ?? null,
      detail: String(entry.detail ?? '').slice(0, 4000),
    });
  });
  events.sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
  const categories = Object.fromEntries(AUDIT_CATEGORIES.map(category => [category, events.filter(event => event.category === category).length])) as Record<AuditCategory, number>;
  const payload = {
    generatedAt: new Date(now).toISOString(),
    total: events.length,
    truncated: events.length > limit,
    categories,
    events: events.slice(0, limit),
  };
  return { ...payload, contentHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function renderAuditCsv(timeline: AuditTimeline): string {
  const header = ['id', 'at', 'category', 'action', 'actor', 'projectId', 'market', 'detail'];
  const escape = (value: string | null | undefined) => {
    const text = value == null ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header.join(','), ...timeline.events.map(event => header.map(key => escape((event as unknown as Record<string, string | null>)[key])).join(','))].join('\n');
}
