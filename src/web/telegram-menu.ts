import type { TelegramReplyKeyboardMarkup } from '../features/telegram-bot';

export const TELEGRAM_MENU_PAGE_COUNT = 3;

const MENU_PAGE_SIZE = 4;
const pageByChat = new Map<string, number>();

const MENU_PAGES: Array<Array<Array<{ text: string }>>> = [
  [
    [{ text: '🏠 总览' }, { text: '📊 风险中心' }],
    [{ text: '📋 今日总览' }, { text: '📡 最新信号' }],
  ],
  [
    [{ text: '🔎 搜索市场' }, { text: '📅 事件日历' }],
    [{ text: '⭐ 自选市场' }, { text: '🧠 信号解释' }],
    [{ text: '📒 模拟盘' }, { text: '🔬 研究工作区' }],
    [{ text: '📚 交易复盘' }, { text: '📝 研究日志' }],
  ],
  [
    [{ text: '🩺 数据源健康' }, { text: '📈 历史表现' }],
    [{ text: '🔔 提醒设置' }, { text: '🗓 定时摘要' }],
    [{ text: '⚙ 自动化状态' }, { text: '🩺 系统状态' }],
    [{ text: '🔔 通知测试' }, { text: '❓ 帮助' }],
  ],
];

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

export function buildTelegramBottomMenu(chatId: string): TelegramReplyKeyboardMarkup {
  const page = getTelegramMenuPage(chatId);
  const featureRows = MENU_PAGES[page - 1].slice(0, MENU_PAGE_SIZE)
    .map((row) => row.map((button) => ({ ...button })));
  const navigationRow = [] as Array<{ text: string }>;

  if (page > 1) navigationRow.push({ text: '⬅ 上一页' });
  navigationRow.push({ text: `菜单 ${page}/${TELEGRAM_MENU_PAGE_COUNT}` });
  if (page < TELEGRAM_MENU_PAGE_COUNT) navigationRow.push({ text: '下一页 ➡' });

  return {
    keyboard: [...featureRows, navigationRow],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: '选择功能或输入命令',
  };
}
