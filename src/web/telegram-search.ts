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

export interface TelegramDeepLinkContext {
  market: string;
  instrument: string;
  timeframe?: string;
  workspace?: string;
}

export function telegramPublicBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = String(env.MONEYMONEY_PUBLIC_URL || env.APP_PUBLIC_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function buildTelegramDeepLink(baseUrl: string | null | undefined, context: TelegramDeepLinkContext): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) return null;
    url.searchParams.set('market', String(context.market || 'overview'));
    url.searchParams.set('workspace', String(context.workspace || 'analysis'));
    url.searchParams.set('instrument', String(context.instrument || ''));
    if (context.timeframe) url.searchParams.set('timeframe', String(context.timeframe));
    return url.toString();
  } catch {
    return null;
  }
}
