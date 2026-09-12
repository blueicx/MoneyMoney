export interface TelegramStockSearchItem {
  code: string;
  name?: string;
  zhName?: string;
}

export function isTelegramWatchableStockId(value: string): boolean {
  return /^(?:us[A-Z][A-Z0-9.-]{0,11}|hk\d{1,6}|(?:sh|sz|bj)\d{6})$/i.test(String(value || '').trim());
}

export function buildTelegramStockSearchRows(items: TelegramStockSearchItem[], scope = 'stocks'): Array<Array<{ text: string; callback_data: string }>> {
  return items.map((item) => {
    const label = String(item.zhName || item.name || item.code).slice(0, 8);
    return [
      { text: `加入自选 ${label}`, callback_data: `watch:add:${scope}:${encodeURIComponent(item.code)}` },
      { text: `${label} 行情`, callback_data: `stock:view:${item.code}` },
    ];
  });
}
