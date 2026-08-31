import fs from 'fs';
import path from 'path';
import { DATA_ROOT, ensureDir } from '../utils/paths';

export type ResearchSubjectType = 'prediction' | 'crypto' | 'stock' | 'macro';
export type ResearchStatus = 'WATCHING' | 'ACTIVE' | 'RESOLVED' | 'ARCHIVED';

export interface ResearchSource {
  name: string;
  status: 'fresh' | 'stale' | 'failed' | 'unknown';
  capturedAt?: string;
  url?: string;
  note?: string;
}

export interface ResearchSnapshot {
  capturedAt: string;
  marketProbability?: number;
  modelProbability?: number;
  confidence?: number;
  price?: number;
  note?: string;
  sources: ResearchSource[];
}

export interface ResearchNote {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}

export interface ResearchEntry {
  id: string;
  subjectType: ResearchSubjectType;
  subjectId: string;
  title: string;
  thesis: string;
  status: ResearchStatus;
  tags: string[];
  snapshots: ResearchSnapshot[];
  notes: ResearchNote[];
  createdAt: string;
  updatedAt: string;
  outcome?: 'YES' | 'NO' | 'UNKNOWN';
}

export interface ResearchSummary {
  id: string;
  title: string;
  status: ResearchStatus;
  latestAt: string;
  marketProbabilityPct: number | null;
  modelProbabilityPct: number | null;
  edgePct: number | null;
  sourceCount: number;
  freshSourceCount: number;
  noteCount: number;
}

const RESEARCH_FILE = path.join(DATA_ROOT, 'research-workspace.json');

function nowIso(): string { return new Date().toISOString(); }
function makeId(): string { return `research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function loadEntries(): ResearchEntry[] {
  ensureDir(DATA_ROOT);
  try {
    const parsed = JSON.parse(fs.readFileSync(RESEARCH_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveEntries(entries: ResearchEntry[]): void {
  ensureDir(DATA_ROOT);
  fs.writeFileSync(RESEARCH_FILE, JSON.stringify(entries.slice(0, 500), null, 2), 'utf8');
}

export function createResearchEntry(input: {
  subjectType: ResearchSubjectType;
  subjectId: string;
  title: string;
  thesis?: string;
  tags?: string[];
}, createdAt = new Date()): ResearchEntry {
  const timestamp = createdAt.toISOString();
  return {
    id: makeId(),
    subjectType: input.subjectType,
    subjectId: String(input.subjectId).trim(),
    title: String(input.title).trim(),
    thesis: String(input.thesis || '').trim(),
    status: 'WATCHING',
    tags: Array.from(new Set((input.tags || []).map(String).map(v => v.trim()).filter(Boolean))).slice(0, 20),
    snapshots: [],
    notes: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function summarizeResearchEntry(entry: ResearchEntry): ResearchSummary {
  const latest = [...entry.snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);
  const market = latest?.marketProbability;
  const model = latest?.modelProbability;
  const sources = latest?.sources || [];
  return {
    id: entry.id,
    title: entry.title,
    status: entry.status,
    latestAt: latest?.capturedAt || entry.updatedAt,
    marketProbabilityPct: market == null ? null : Math.round(market * 1000) / 10,
    modelProbabilityPct: model == null ? null : Math.round(model * 1000) / 10,
    edgePct: market == null || model == null ? null : Math.round((model - market) * 1000) / 10,
    sourceCount: sources.length,
    freshSourceCount: sources.filter(source => source.status === 'fresh').length,
    noteCount: entry.notes.length,
  };
}

export function appendResearchNote(entry: ResearchEntry, text: string, tags: string[] = [], createdAt = new Date()): ResearchEntry {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('研究笔记不能为空');
  const note: ResearchNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text: cleanText.slice(0, 2000),
    tags: Array.from(new Set(tags.map(String).map(v => v.trim()).filter(Boolean))).slice(0, 12),
    createdAt: createdAt.toISOString(),
  };
  return { ...entry, notes: [note, ...entry.notes].slice(0, 200), updatedAt: note.createdAt };
}

export function appendResearchSnapshot(entry: ResearchEntry, snapshot: ResearchSnapshot): ResearchEntry {
  if (!snapshot.capturedAt || Number.isNaN(new Date(snapshot.capturedAt).getTime())) throw new Error('快照时间无效');
  const values = [snapshot.marketProbability, snapshot.modelProbability, snapshot.price].filter(v => v != null);
  if (values.some(v => !Number.isFinite(v) || (v as number) < 0)) throw new Error('快照数值无效');
  return { ...entry, snapshots: [...entry.snapshots, { ...snapshot, sources: snapshot.sources || [] }].slice(-500), updatedAt: snapshot.capturedAt };
}

export function listResearchEntries(limit = 50): ResearchEntry[] {
  return loadEntries().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, Math.min(200, limit)));
}

export function getResearchEntry(id: string): ResearchEntry | null {
  return loadEntries().find(entry => entry.id === id) || null;
}

export function saveResearchEntry(entry: ResearchEntry): ResearchEntry {
  const entries = loadEntries();
  const index = entries.findIndex(item => item.id === entry.id);
  if (index >= 0) entries[index] = entry;
  else entries.unshift(entry);
  saveEntries(entries);
  return entry;
}

export function upsertResearchEntry(input: {
  id?: string;
  subjectType: ResearchSubjectType;
  subjectId: string;
  title: string;
  thesis?: string;
  tags?: string[];
}): ResearchEntry {
  const existing = input.id ? getResearchEntry(input.id) : null;
  const entry = existing ? {
    ...existing,
    subjectType: input.subjectType,
    subjectId: String(input.subjectId).trim(),
    title: String(input.title).trim(),
    thesis: String(input.thesis ?? existing.thesis).trim(),
    tags: Array.from(new Set((input.tags || existing.tags).map(String).map(v => v.trim()).filter(Boolean))).slice(0, 20),
    updatedAt: nowIso(),
  } : createResearchEntry(input);
  return saveResearchEntry(entry);
}

export function addResearchNote(id: string, text: string, tags: string[] = []): ResearchEntry | null {
  const entry = getResearchEntry(id);
  return entry ? saveResearchEntry(appendResearchNote(entry, text, tags)) : null;
}

export function addResearchSnapshot(id: string, snapshot: ResearchSnapshot): ResearchEntry | null {
  const entry = getResearchEntry(id);
  return entry ? saveResearchEntry(appendResearchSnapshot(entry, snapshot)) : null;
}
