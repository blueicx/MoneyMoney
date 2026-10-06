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
  type TelegramStockSignalFilter,
} from './telegram-stock-signals';
import type { StockSignalSchedule } from './stock-signal-schedule';
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
  schedule?: StockSignalSchedule;
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

function pageText(snapshot: NonNullable<ReturnType<TelegramStockSignalScanner['get']>>, page: number, filters: TelegramStockSignalFilter): string {
  return formatTelegramStockSignalPage(paginateTelegramStockSignals(snapshot, page, 8, filters));
}

/** Run or page the current chat's stock-only scan without sharing watchlist state. */
export async function handleTelegramStockSignalsCommand(command: TelegramStockSignalCommandInput): Promise<string> {
  if (command.scope !== 'stocks') return '股票信号仅在股票市场可用，请先 /market stocks。';

  const arg = String(command.args[0] || '').trim().toLowerCase();
  if (arg === 'auto') {
    if (!command.isAdmin || !command.schedule) return '自动扫描仅管理员可配置。';
    const verb = command.args[1];
    if (verb && !['on','off'].includes(verb)) return '用法：/signals auto on|off [15–240分钟]';
    const config = verb ? command.schedule.configure(command.chatId,{enabled:verb==='on',...(command.args[2] ? {intervalMinutes:Number(command.args[2])}:{})}) : command.schedule.get(command.chatId);
    return `股票自动扫描：${config.enabled ? '开启':'关闭'} · 每 ${config.intervalMinutes} 分钟 · 按美股常规时段，行情过期/来源失败不生成交易信号。\n手动扫描 /signals refresh；查看运行历史 /signals history。`;
  }
  if (arg === 'history') return command.isAdmin && command.schedule ? ['<b>股票扫描运行历史</b>',...command.schedule.history(command.chatId).slice(-10).map(row=>`${row.at} · ${row.status}${row.reason ? ' · '+row.reason.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'):''}`)].join('\n') : '仅管理员可查看自动扫描记录。';
  const filters: TelegramStockSignalFilter = {};
  for (const argument of command.args) {
    const [key,value] = argument.split('=');
    if (key === 'pool') filters.pool=value as TelegramStockSignalFilter['pool'];
    else if (key === 'direction') filters.direction=value?.toUpperCase() as TelegramStockSignalFilter['direction'];
    else if (key === 'status') filters.status=value as TelegramStockSignalFilter['status'];
  }
  if (filters.pool && !['fixed','mover','watchlist'].includes(filters.pool) || filters.direction && !['BUY','SELL','WAIT'].includes(filters.direction) || filters.status && !['pending','ready','unavailable'].includes(filters.status)) return '筛选无效：pool=fixed|mover|watchlist direction=BUY|SELL|WAIT status=pending|ready|unavailable';
  const refresh = arg === 'refresh';
  const page = /^\d+$/.test(arg) ? Number(arg) : 1;
  const existing = command.scanner.get(command.chatId);

  if (!refresh && existing?.status === 'complete') return pageText(existing, page, filters);

  if (!refresh && existing?.status === 'partial') {
    if (arg === 'continue') {
      const resumed = command.scanner.resume(command.chatId, command.analyze);
      return pageText(resumed?.snapshot || existing, 1, filters);
    }
    return pageText(existing, page, filters);
  }

  if (!refresh && existing?.status === 'scanning') {
    const resumed = command.scanner.resume(command.chatId, command.analyze);
    const snapshot = resumed?.snapshot || existing;
    return pageText(snapshot, page, filters);
  }

  if (!refresh && existing?.status === 'discovering' && existing.moverStatus.state !== 'pending') {
    const resumed = command.scanner.resume(command.chatId, command.analyze);
    if (resumed) return pageText(resumed.snapshot, page, filters);
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
  return pageText(job.snapshot, page, filters);
}
