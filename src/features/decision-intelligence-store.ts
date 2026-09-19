import { stateStore } from '../storage/sqlite-state';
import type { MarketId } from './research-contracts';
import type { DecisionRecord, DecisionReviewDraft, EvidenceSnapshot, PortfolioRow, SavedWorkspace, ScenarioDefinition, SignalOutcome } from './decision-intelligence';

const KEYS = {
  evidence: 'decision-intelligence:evidence',
  scenarios: 'decision-intelligence:scenarios',
  decisions: 'decision-intelligence:decisions',
  portfolio: 'decision-intelligence:portfolio',
  signals: 'decision-intelligence:signal-outcomes',
  workspaces: 'decision-intelligence:workspaces',
  reviewDrafts: 'decision-intelligence:review-drafts',
  sharedWorkspaces: 'decision-intelligence:shared-workspaces',
} as const;

function list<T>(key: string): T[] {
  const value = stateStore.get<T[]>(key);
  return Array.isArray(value) ? value : [];
}

function saveBounded<T>(key: string, value: T[], limit: number): void {
  stateStore.set(key, value.slice(-limit), 1);
}

function upsert<T extends { id: string }>(key: string, item: T, limit: number): T {
  const current = list<T>(key).filter(existing => existing.id !== item.id);
  saveBounded(key, [...current, item], limit);
  return item;
}

export const decisionIntelligenceStore = {
  saveEvidence(item: EvidenceSnapshot) { return upsert(KEYS.evidence, item, 2_000); },
  listEvidence(market?: MarketId, instrument?: string) {
    return list<EvidenceSnapshot>(KEYS.evidence).filter(item => (!market || item.market === market) && (!instrument || item.instrument === instrument)).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  },
  getEvidence(id: string) { return list<EvidenceSnapshot>(KEYS.evidence).find(item => item.id === id) || null; },

  saveScenario(item: ScenarioDefinition) { return upsert(KEYS.scenarios, item, 200); },
  listScenarios(market?: MarketId) { return list<ScenarioDefinition>(KEYS.scenarios).filter(item => !market || item.market === market); },

  saveDecision(item: DecisionRecord) { return upsert(KEYS.decisions, item, 1_000); },
  listDecisions(market?: MarketId, instrument?: string) {
    return list<DecisionRecord>(KEYS.decisions).filter(item => (!market || item.market === market) && (!instrument || item.instrument === instrument)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getDecision(id: string) { return list<DecisionRecord>(KEYS.decisions).find(item => item.id === id) || null; },
  saveReviewDraft(item: DecisionReviewDraft) { return upsert(KEYS.reviewDrafts, { ...item, id: item.decisionId }, 1_000); },
  listReviewDrafts(market?: MarketId) { return list<DecisionReviewDraft & { id: string }>(KEYS.reviewDrafts).filter(item => !market || item.market === market).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)); },

  replacePortfolio(rows: PortfolioRow[]) { stateStore.set(KEYS.portfolio, rows, 1); return rows; },
  listPortfolio(market?: MarketId) { return list<PortfolioRow>(KEYS.portfolio).filter(item => !market || item.market === market); },

  saveSignalOutcome(item: SignalOutcome) { return upsert(KEYS.signals, item, 5_000); },
  listSignalOutcomes(market?: MarketId, instrument?: string) {
    return list<SignalOutcome>(KEYS.signals).filter(item => (!market || item.market === market) && (!instrument || item.instrument === instrument));
  },

  saveWorkspace(item: SavedWorkspace) { return upsert(KEYS.workspaces, item, 200); },
  listWorkspaces(market?: MarketId) { return list<SavedWorkspace>(KEYS.workspaces).filter(item => !market || item.market === market).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
  getWorkspace(id: string) { return list<SavedWorkspace>(KEYS.workspaces).find(item => item.id === id) || null; },
  saveSharedWorkspace(item: SavedWorkspace) { return upsert(KEYS.sharedWorkspaces, { ...item, visibility: 'public' as const }, 200); },
  getSharedWorkspace(id: string) { return list<SavedWorkspace>(KEYS.sharedWorkspaces).find(item => item.id === id && item.visibility === 'public') || null; },
};
