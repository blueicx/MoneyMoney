import fs from 'fs';
import path from 'path';
import type { PredictionMarket } from './prediction-radar';

export interface PredictionHistoryPoint {
  t: string;
  p: number;
}

interface PredictionHistoryEntry {
  platform: string;
  id: string;
  title: string;
  titleZh?: string;
  outcome?: string;
  points: PredictionHistoryPoint[];
}

interface PredictionHistoryFile {
  version: 1;
  updatedAt: string;
  markets: Record<string, PredictionHistoryEntry>;
}

const HISTORY_FILE = path.join(process.cwd(), 'data', 'prediction-history.json');
const MAX_POINTS_PER_MARKET = 240;
const MAX_TRACKED_MARKETS = 400;
const MIN_APPEND_INTERVAL_MS = 2 * 60_000;

function historyKey(market: Pick<PredictionMarket, 'platform' | 'id'>): string {
  return `${market.platform}::${market.id}`;
}

function clampProbability(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
}

function loadHistory(): PredictionHistoryFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) as PredictionHistoryFile;
    if (parsed?.version === 1 && parsed.markets && typeof parsed.markets === 'object') {
      return parsed;
    }
  } catch {
    // First run, corrupted local cache, or a fresh desktop installation.
  }
  return { version: 1, updatedAt: new Date().toISOString(), markets: {} };
}

// MoneyMoney records its own observations after each successful radar refresh.
// This avoids venue-specific chart APIs and works consistently across all
// prediction platforms, including crowd forecasts and weather supplements.
export async function recordPredictionHistory(markets: PredictionMarket[]): Promise<void> {
  if (!Array.isArray(markets) || !markets.length) return;
  const state = loadHistory();
  const now = Date.now();
  const selected = markets.slice(0, MAX_TRACKED_MARKETS);

  for (const market of selected) {
    if (!market?.platform || !market?.id) continue;
    const key = historyKey(market);
    const entry = state.markets[key] || {
      platform: market.platform,
      id: market.id,
      title: market.title,
      points: [],
    };
    entry.title = market.title || entry.title;
    if (market.titleZh) entry.titleZh = market.titleZh;
    if (market.outcome) entry.outcome = market.outcome;

    const last = entry.points.at(-1);
    if (last && now - new Date(last.t).getTime() < MIN_APPEND_INTERVAL_MS) {
      last.p = clampProbability(market.yesPrice);
    } else {
      entry.points.push({ t: new Date(now).toISOString(), p: clampProbability(market.yesPrice) });
    }
    if (entry.points.length > MAX_POINTS_PER_MARKET) {
      entry.points.splice(0, entry.points.length - MAX_POINTS_PER_MARKET);
    }
    state.markets[key] = entry;
  }

  for (const [key, entry] of Object.entries(state.markets)) {
    const lastTime = entry.points.at(-1)?.t ? new Date(entry.points.at(-1)!.t).getTime() : 0;
    if (now - lastTime > 7 * 86400_000) delete state.markets[key];
  }

  state.updatedAt = new Date().toISOString();
  await fs.promises.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.promises.writeFile(HISTORY_FILE, JSON.stringify(state), 'utf8');
}

export function getPredictionHistory(platform: string, id: string) {
  const normalizedPlatform = String(platform || '').trim();
  const normalizedId = String(id || '').trim();
  if (!normalizedPlatform || !normalizedId) return null;
  const state = loadHistory();
  const key = `${normalizedPlatform}::${normalizedId}`;
  const entry = state.markets[key];
  if (!entry) return null;
  return { ...entry, key, points: [...entry.points], updatedAt: state.updatedAt };
}
