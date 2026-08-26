import { settingsManager } from './news-settings';
import { telegram } from './telegram';

const WECOM_WEBHOOK_URL = process.env.WECOM_WEBHOOK_URL || '';
const BARK_DEVICE_KEY = (process.env.BARK_DEVICE_KEY || '').trim();

export function wecomConfigured(): boolean {
  return /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/.test(WECOM_WEBHOOK_URL);
}

export function notificationChannelsConfigured(): { telegram: boolean; wecom: boolean; bark: boolean } {
  return {
    telegram: telegram.isConfigured,
    wecom: wecomConfigured(),
    bark: !!BARK_DEVICE_KEY,
  };
}

function splitMarkdown(content: string, limit = 3_600): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of content.split('\n')) {
    if ((current + '\n' + line).length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 4);
}

export async function sendWeComMarkdown(content: string): Promise<boolean> {
  if (!wecomConfigured()) return false;
  const chunks = splitMarkdown(content);
  let anySent = false;
  for (const markdown of chunks) {
    try {
      const res = await fetch(WECOM_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => null) as { errcode?: number } | null;
      if (res.ok && body?.errcode === 0) anySent = true;
      else return anySent;
    } catch {
      return anySent;
    }
  }
  return anySent;
}

function plainText(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(b|strong)>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 3_000);
}

export async function sendBarkNotification(title: string, body: string): Promise<boolean> {
  if (!BARK_DEVICE_KEY) return false;
  try {
    const res = await fetch('https://api.day.app/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        device_key: BARK_DEVICE_KEY,
        title: title.replace(/\s+/g, ' ').slice(0, 120),
        body: plainText(body),
        group: 'MoneyMoney',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await res.json().catch(() => null) as { code?: number | string } | null;
    const code = Number(payload?.code);
    return res.ok && (code === 0 || code === 200);
  } catch {
    return false;
  }
}

export async function sendNotificationChannels(options: {
  telegramHtml: string;
  wecomMarkdown: string;
  barkTitle?: string;
}): Promise<{ telegram: boolean; wecom: boolean; bark: boolean; any: boolean }> {
  const enabled = settingsManager.get().telegramEnabled;
  const configured = notificationChannelsConfigured();
  if (!enabled || (!configured.telegram && !configured.wecom && !configured.bark)) {
    return { telegram: false, wecom: false, bark: false, any: false };
  }

  const [telegramResult, wecomResult, barkResult] = await Promise.allSettled([
    configured.telegram ? telegram.send(options.telegramHtml) : Promise.resolve(false),
    configured.wecom ? sendWeComMarkdown(options.wecomMarkdown) : Promise.resolve(false),
    configured.bark
      ? sendBarkNotification(options.barkTitle || 'MoneyMoney 高成功率信号', options.wecomMarkdown)
      : Promise.resolve(false),
  ]);
  const telegramOk = telegramResult.status === 'fulfilled' && telegramResult.value;
  const wecomOk = wecomResult.status === 'fulfilled' && wecomResult.value;
  const barkOk = barkResult.status === 'fulfilled' && barkResult.value;
  return { telegram: telegramOk, wecom: wecomOk, bark: barkOk, any: telegramOk || wecomOk || barkOk };
}

export async function testNotificationChannels(): Promise<{
  telegram: { configured: boolean; sent: boolean };
  wecom: { configured: boolean; sent: boolean };
  bark: { configured: boolean; sent: boolean };
  any: boolean;
}> {
  const result = await sendNotificationChannels({
    telegramHtml: '🤖 <b>MoneyMoney 通知测试</b>\n\n高胜率信号通道已连通。',
    wecomMarkdown: '### 🤖 MoneyMoney 通知测试\n\n高胜率信号通道已连通。',
    barkTitle: 'MoneyMoney 通知测试',
  });
  const configured = notificationChannelsConfigured();
  return {
    telegram: { configured: configured.telegram, sent: result.telegram },
    wecom: { configured: configured.wecom, sent: result.wecom },
    bark: { configured: configured.bark, sent: result.bark },
    any: result.any,
  };
}
