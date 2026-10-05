import {
  buildTelegramStockSignalUniverse,
  type TelegramMoverSourceStatus,
  type TelegramStockMover,
  type TelegramStockSignalCandidate,
} from './telegram-stock-signal-universe';
import {
  formatTelegramStockSignalPage,
  paginateTelegramStockSignals,
  type TelegramStockSignalScanInput,
  type TelegramStockSignalScanner,
} from './telegram-stock-signals';
import type { StockSignalCandidateAnalysis } from './trade-assistant';

export interface TelegramStockMoverDiscovery {
  movers: TelegramStockMover[];
  status: Exclude<TelegramMoverSourceStatus['state'], 'pending'>;
  source: string;
  updatedAt: string | null;
  reason?: string;
}

export interface TelegramStockSignalCommandInput {
  chatId: string;
  scope: string;
  args: string[];
  telegramWatchlistIds: string[];
  administratorWatchlistIds?: string[];
  isAdmin: boolean;
  scanner: TelegramStockSignalScanner;
  discoverMovers: () => Promise<TelegramStockMoverDiscovery>;
  analyze: (candidate: TelegramStockSignalCandidate) => Promise<StockSignalCandidateAnalysis>;
  now?: () => number;
}

function previousMovers(snapshot: ReturnType<TelegramStockSignalScanner['get']>, now: number): TelegramStockMover[] {
  if (!snapshot) return [];
  return snapshot.candidates.flatMap(row => {
    const mover = row.candidate.mover;
    const age = mover ? now - Date.parse(mover.updatedAt) : Infinity;
    return mover && Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60_000
      ? [{ symbol: mover.symbol, name: mover.name, changePct: mover.changePct, volume: mover.volume, marketCapUsd: mover.marketCapUsd }]
      : [];
  });
}

function universeInput(
  command: TelegramStockSignalCommandInput,
  movers: TelegramStockMover[],
  moverStatus: TelegramMoverSourceStatus,
) {
  return buildTelegramStockSignalUniverse({
    telegramWatchlistIds: command.telegramWatchlistIds,
    administratorWatchlistIds: command.administratorWatchlistIds,
    isAdmin: command.isAdmin,
    movers,
    moverStatus,
  });
}

function pageText(snapshot: NonNullable<ReturnType<TelegramStockSignalScanner['get']>>, page: number): string {
  return formatTelegramStockSignalPage(paginateTelegramStockSignals(snapshot, page));
}

/** Run or page the current chat's stock-only scan without sharing watchlist state. */
export async function handleTelegramStockSignalsCommand(command: TelegramStockSignalCommandInput): Promise<string> {
  if (command.scope !== 'stocks') return '股票信号仅在股票市场可用，请先 /market stocks。';

  const arg = String(command.args[0] || '').trim().toLowerCase();
  const refresh = arg === 'refresh';
  const page = /^\d+$/.test(arg) ? Number(arg) : 1;
  const existing = command.scanner.get(command.chatId);

  if (!refresh && existing?.status === 'complete') return pageText(existing, page);

  if (!refresh && existing?.status === 'partial') {
    if (arg === 'continue') {
      const resumed = command.scanner.resume(command.chatId, command.analyze);
      return pageText(resumed?.snapshot || existing, 1);
    }
    return pageText(existing, page);
  }

  if (!refresh && existing?.status === 'scanning') {
    const resumed = command.scanner.resume(command.chatId, command.analyze);
    const snapshot = resumed?.snapshot || existing;
    return pageText(snapshot, page);
  }

  if (!refresh && existing?.status === 'discovering' && existing.moverStatus.state !== 'pending') {
    const resumed = command.scanner.resume(command.chatId, command.analyze);
    if (resumed) return pageText(resumed.snapshot, page);
  }

  const pendingStatus: TelegramMoverSourceStatus = {
    state: 'pending', source: 'Nasdaq Public Screener', updatedAt: null,
  };
  const initialUniverse = universeInput(command, [], pendingStatus);
  const priorMovers = previousMovers(existing, (command.now || Date.now)());
  const job = command.scanner.start(command.chatId, {
    initialUniverse,
    loadUniverse: async () => {
      let discovery: TelegramStockMoverDiscovery;
      try {
        discovery = await command.discoverMovers();
      } catch (error) {
        discovery = {
          movers: [],
          status: 'unavailable',
          source: 'Nasdaq Public Screener',
          updatedAt: null,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (discovery.status === 'unavailable' && priorMovers.length) {
        const fallbackStatus: TelegramMoverSourceStatus = {
          state: 'stale', source: discovery.source, updatedAt: existing?.moverStatus.updatedAt || null,
          reason: `异动源不可用，沿用最近缓存：${discovery.reason || '请求失败'}`,
        };
        return universeInput(command, priorMovers, fallbackStatus);
      }
      const status: TelegramMoverSourceStatus = {
        state: discovery.status,
        source: discovery.source,
        updatedAt: discovery.updatedAt,
        ...(discovery.reason ? { reason: discovery.reason } : {}),
      };
      return universeInput(command, discovery.movers, status);
    },
    analyze: command.analyze,
  });
  return pageText(job.snapshot, page);
}
