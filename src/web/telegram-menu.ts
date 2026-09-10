import type { TelegramReplyKeyboardMarkup } from '../features/telegram-bot';
import { MARKET_SCOPES, type MarketScope } from '../features/market-scope';

export const TELEGRAM_MENU_PAGE_COUNT = 3;

const MENU_PAGE_SIZE = 4;
const pageByChat = new Map<string, number>();

export const TELEGRAM_MARKET_MENU: Array<Array<{ text: string; scope: MarketScope }>> = [
  [{ text: '🏠 总体', scope: 'overview' }, { text: '📈 股票', scope: 'stocks' }, { text: '🎯 期权', scope: 'options' }],
  [{ text: '₿ 虚拟币', scope: 'crypto' }, { text: '🎯 预测市场', scope: 'prediction' }, { text: '⭐ 自选', scope: 'watchlist' }],
];

type TelegramMenuEntry = { text: string; command: string };
type TelegramMenuPage = TelegramMenuEntry[][];

const MENU_PAGES: Record<MarketScope, TelegramMenuPage[]> = {
  overview: [
    [
      [{ text: '🏠 总览', command: 'help' }, { text: '📊 风险中心', command: 'risk' }],
      [{ text: '📋 今日总览', command: 'today' }, { text: '📡 最新信号', command: 'signals' }],
      [{ text: '🌍 宏观', command: 'macro' }, { text: '📅 事件日历', command: 'events' }],
      [{ text: '📊 策略对比', command: 'strategies' }],
    ],
    [[{ text: '🔎 搜索市场', command: 'search' }, { text: '⭐ 自选市场', command: 'watchlist' }], [{ text: '🧠 信号解释', command: 'explain' }, { text: '🔬 研究工作区', command: 'research' }]],
    [[{ text: '🩺 数据源健康', command: 'sources' }, { text: '📈 历史表现', command: 'history' }], [{ text: '🔔 提醒设置', command: 'alerts' }, { text: '🗓 定时摘要', command: 'digest' }]],
  ],
  stocks: [
    [
      [{ text: '📈 股票行情', command: 'stocks' }, { text: '🌡️ 市场宽度', command: 'stocks' }],
      [{ text: '🧑‍💼 内部人', command: 'stocks' }, { text: '🏛️ 机构', command: 'stocks' }],
      [{ text: '🎯 分析师', command: 'stocks' }, { text: '📊 基本面', command: 'stocks' }],
      [{ text: '🐻 空头', command: 'stocks' }, { text: '🔎 搜索股票', command: 'search' }],
    ],
    [[{ text: '⭐ 股票自选', command: 'watchlist' }, { text: '🛡 股票风险', command: 'risk' }], [{ text: '📒 股票模拟盘', command: 'portfolio' }]],
    [[{ text: '📰 股票新闻', command: 'news' }, { text: '📈 股票历史', command: 'history' }], [{ text: '📝 股票研究日志', command: 'journal' }]],
  ],
  options: [
    [
      [{ text: '🎯 期权行情', command: 'options' }, { text: '📉 隐含波动率', command: 'options' }],
      [{ text: '🧮 期权链', command: 'options' }, { text: '🔎 搜索期权', command: 'search' }],
      [{ text: '⭐ 期权自选', command: 'watchlist' }, { text: '🛡 期权风险', command: 'risk' }],
      [{ text: '📒 期权模拟盘', command: 'portfolio' }],
    ],
    [[{ text: '📅 期权事件', command: 'events' }, { text: '📈 期权历史', command: 'history' }], [{ text: '📝 期权研究日志', command: 'journal' }]],
    [[{ text: '🩺 数据源健康', command: 'sources' }, { text: '🔔 提醒设置', command: 'alerts' }]],
  ],
  crypto: [
    [
      [{ text: '₿ 币安行情', command: 'binance' }, { text: '😱 恐贪指标', command: 'binance' }],
      [{ text: '💸 资金费率', command: 'binance' }, { text: '🧩 DeFi 数据', command: 'binance' }],
      [{ text: '🔎 搜索虚拟币', command: 'search' }, { text: '⭐ 虚拟币自选', command: 'watchlist' }],
      [{ text: '🛡 虚拟币风险', command: 'risk' }],
    ],
    [[{ text: '📒 虚拟币模拟盘', command: 'portfolio' }, { text: '📈 虚拟币历史', command: 'history' }], [{ text: '📝 虚拟币研究日志', command: 'journal' }]],
    [[{ text: '🩺 数据源健康', command: 'sources' }, { text: '🔔 提醒设置', command: 'alerts' }]],
  ],
  prediction: [
    [
      [{ text: '🌐 预测雷达', command: 'radar' }, { text: '📅 预测事件', command: 'events' }],
      [{ text: '🧠 信号解释', command: 'explain' }, { text: '🎯 概率校准', command: 'risk' }],
      [{ text: '🔎 搜索预测', command: 'search' }, { text: '⭐ 预测自选', command: 'watchlist' }],
      [{ text: '📒 预测模拟盘', command: 'portfolio' }, { text: '🛡 预测风险', command: 'risk' }],
    ],
    [[{ text: '📚 交易复盘', command: 'review' }, { text: '📝 研究日志', command: 'journal' }], [{ text: '📈 历史表现', command: 'history' }]],
    [[{ text: '🩺 数据源健康', command: 'sources' }, { text: '🔔 提醒设置', command: 'alerts' }]],
  ],
  watchlist: [
    [
      [{ text: '⭐ 我的自选', command: 'watchlist' }, { text: '🔎 搜索自选', command: 'search' }],
      [{ text: '📈 自选行情', command: 'watchlist' }, { text: '🧠 自选信号', command: 'signals' }],
      [{ text: '🛡 自选风险', command: 'risk' }, { text: '📒 自选模拟盘', command: 'portfolio' }],
      [{ text: '📝 自选研究日志', command: 'journal' }],
    ],
    [[{ text: '📊 自选比较', command: 'strategies' }, { text: '📈 历史表现', command: 'history' }], [{ text: '🔔 提醒设置', command: 'alerts' }]],
    [[{ text: '🩺 数据源健康', command: 'sources' }, { text: '❓ 帮助', command: 'help' }]],
  ],
};

function normalizeChatId(chatId: string): string {
  return String(chatId || '').trim();
}

function clampPage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(TELEGRAM_MENU_PAGE_COUNT, Math.trunc(page)));
}

export function getTelegramMenuPage(chatId: string): number {
  const key = normalizeChatId(chatId);
  return key ? pageByChat.get(key) || 1 : 1;
}

export function setTelegramMenuPage(chatId: string, page: number): number {
  const normalizedPage = clampPage(page);
  const key = normalizeChatId(chatId);
  if (key) pageByChat.set(key, normalizedPage);
  return normalizedPage;
}

export function moveTelegramMenuPage(chatId: string, delta: number): number {
  const safeDelta = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return setTelegramMenuPage(chatId, getTelegramMenuPage(chatId) + safeDelta);
}

export function resetTelegramMenuPage(chatId: string): number {
  return setTelegramMenuPage(chatId, 1);
}

export function getTelegramMarketButtons(): Array<{ text: string; scope: MarketScope }> {
  return TELEGRAM_MARKET_MENU.flat().map(button => ({ ...button }));
}

export function getTelegramMenuEntries(scope: string): TelegramMenuEntry[] {
  const normalized = String(scope || '').toLowerCase() as MarketScope;
  const safeScope = MARKET_SCOPES.includes(normalized) ? normalized : 'overview';
  return MENU_PAGES[safeScope].flat(2).map(entry => ({ ...entry }));
}

export function buildTelegramBottomMenu(chatId: string, scope: string = 'overview'): TelegramReplyKeyboardMarkup {
  const page = getTelegramMenuPage(chatId);
  const normalized = String(scope || '').toLowerCase() as MarketScope;
  const safeScope = MARKET_SCOPES.includes(normalized) ? normalized : 'overview';
  const featureRows = MENU_PAGES[safeScope][page - 1].slice(0, MENU_PAGE_SIZE)
    .map((row) => row.map((button) => ({ ...button })));
  const navigationRow = [] as Array<{ text: string }>;

  if (page > 1) navigationRow.push({ text: '⬅ 上一页' });
  navigationRow.push({ text: `菜单 ${page}/${TELEGRAM_MENU_PAGE_COUNT}` });
  if (page < TELEGRAM_MENU_PAGE_COUNT) navigationRow.push({ text: '下一页 ➡' });

  return {
    keyboard: [...TELEGRAM_MARKET_MENU.map(row => row.map(button => ({ text: button.text }))), ...featureRows.map(row => row.map(button => ({ text: button.text }))), navigationRow],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: '选择功能或输入命令',
  };
}
