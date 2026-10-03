import crypto from 'node:crypto';

const HISTORY_KEY = 'telegram:test-delivery-history';
const HISTORY_LIMIT = 100;

export interface TelegramTestDeliveryRecord {
  id: string;
  status: 'sending' | 'sent' | 'failed' | 'suppressed';
  attemptedAt: string;
  completedAt?: string;
  chatFingerprint: string;
  idempotencyFingerprint: string;
  reason?: string;
}

export interface TelegramTestDeliveryStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, version?: number): void;
  acquireLease(key: string, owner: string, now?: number, leaseMs?: number): boolean;
  releaseLease(key: string, owner: string): boolean;
}

function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function history(store: TelegramTestDeliveryStore): TelegramTestDeliveryRecord[] {
  const rows = store.get<TelegramTestDeliveryRecord[]>(HISTORY_KEY);
  return Array.isArray(rows) ? rows : [];
}

function save(store: TelegramTestDeliveryStore, record: TelegramTestDeliveryRecord): void {
  const current = history(store).filter(item => item.id !== record.id);
  store.set(HISTORY_KEY, [...current, record].slice(-HISTORY_LIMIT), 1);
}

function sanitizeError(error: unknown, recipientId: string): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message
    .replace(/https?:\/\/api\.telegram\.org\/bot[^\s/]+/gi, 'https://api.telegram.org/bot[redacted]')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
    .replaceAll(recipientId, '[recipient]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (message || 'Telegram delivery failed').slice(0, 240);
}

export function runTelegramTestDelivery(input: {
  store: TelegramTestDeliveryStore;
  recipientId: string;
  adminChatIds: readonly string[];
  allowedChatIds: readonly string[];
  botConfigured: boolean;
  idempotencyKey: string;
  sendMessage: (chatId: string, text: string) => Promise<void>;
  now?: string | Date;
  cooldownMs?: number;
}) {
  const recipientId = String(input.recipientId || '').trim();
  if (!input.botConfigured || !recipientId) return Promise.resolve({ status: 'unavailable' as const, reason: 'Telegram 机器人或接收目标未配置' });
  if (!input.adminChatIds.includes(recipientId) || !input.allowedChatIds.includes(recipientId)) {
    return Promise.resolve({ status: 'rejected' as const, reason: '接收目标必须同时属于管理员列表和交互白名单' });
  }
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return Promise.resolve({ status: 'rejected' as const, reason: '幂等键无效' });
  const nowMs = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now || new Date().toISOString());
  if (!Number.isFinite(nowMs)) return Promise.resolve({ status: 'rejected' as const, reason: '投递时间无效' });
  const chatFingerprint = fingerprint(recipientId);
  const idempotencyFingerprint = fingerprint(`${chatFingerprint}\0${idempotencyKey}`);
  const existing = history(input.store).find(item => item.idempotencyFingerprint === idempotencyFingerprint);
  if (existing) return Promise.resolve({ status: 'duplicate' as const, record: existing, reason: '该次按钮请求已处理，未重复发送' });

  const leaseKey = `telegram:test-delivery:${chatFingerprint}`;
  const owner = `telegram-test-${process.pid}-${crypto.randomUUID()}`;
  if (!input.store.acquireLease(leaseKey, owner, nowMs, 30_000)) {
    return Promise.resolve({ status: 'suppressed' as const, reason: '已有测试投递正在处理' });
  }
  const attemptedAt = new Date(nowMs).toISOString();
  const record: TelegramTestDeliveryRecord = {
    id: `tgtest_${crypto.randomUUID()}`,
    status: 'sending',
    attemptedAt,
    chatFingerprint,
    idempotencyFingerprint,
  };
  try {
    const rows = history(input.store);
    const duplicate = rows.find(item => item.idempotencyFingerprint === idempotencyFingerprint);
    if (duplicate) {
      input.store.releaseLease(leaseKey, owner);
      return Promise.resolve({ status: 'duplicate' as const, record: duplicate, reason: '该次按钮请求已处理，未重复发送' });
    }
    const latestActualAttempt = rows.filter(item => item.chatFingerprint === chatFingerprint && ['sending', 'sent', 'failed'].includes(item.status))
      .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt))[0];
    const cooldownMs = Math.max(0, Math.min(10 * 60_000, input.cooldownMs ?? 60_000));
    if (latestActualAttempt && nowMs - Date.parse(latestActualAttempt.attemptedAt) < cooldownMs) {
      const suppressed = { ...record, status: 'suppressed' as const, completedAt: attemptedAt, reason: '短时间内已有测试投递，避免重复通知' };
      save(input.store, suppressed);
      input.store.releaseLease(leaseKey, owner);
      return Promise.resolve({ status: 'suppressed' as const, record: suppressed, reason: suppressed.reason });
    }
    save(input.store, record);
  } catch (error) {
    input.store.releaseLease(leaseKey, owner);
    return Promise.resolve({ status: 'failed' as const, reason: sanitizeError(error, recipientId) });
  }

  return Promise.resolve().then(() => input.sendMessage(recipientId, '🤖 <b>MoneyMoney Telegram 测试</b>\n通知通道已由管理员主动验证。'))
    .then(() => {
      const completed = { ...record, status: 'sent' as const, completedAt: new Date().toISOString(), reason: 'Telegram API 已确认发送' };
      save(input.store, completed);
      return { status: 'sent' as const, record: completed, reason: completed.reason };
    })
    .catch(error => {
      const completed = { ...record, status: 'failed' as const, completedAt: new Date().toISOString(), reason: sanitizeError(error, recipientId) };
      save(input.store, completed);
      return { status: 'failed' as const, record: completed, reason: completed.reason };
    })
    .finally(() => { input.store.releaseLease(leaseKey, owner); });
}

export function listTelegramTestDeliveries(store: TelegramTestDeliveryStore): TelegramTestDeliveryRecord[] {
  return history(store).slice(-HISTORY_LIMIT).reverse();
}
