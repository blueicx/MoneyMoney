import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, ensureDir } from '../utils/paths';

export type RuntimeSecretKey =
  | 'openrouterApiKey'
  | 'groqApiKey'
  | 'telegramBotToken'
  | 'telegramChatId'
  | 'telegramAllowedChatIds'
  | 'telegramAdminChatIds'
  | 'telegramProxyUrl'
  | 'telegramPollingEnabled';

type RuntimeSecretValues = Partial<Record<RuntimeSecretKey, string | boolean>>;
type Environment = Record<string, string | undefined>;

const ENV_KEYS: Record<RuntimeSecretKey, string> = {
  openrouterApiKey: 'OPENROUTER_API_KEY',
  groqApiKey: 'GROQ_API_KEY',
  telegramBotToken: 'TELEGRAM_BOT_TOKEN',
  telegramChatId: 'TELEGRAM_CHAT_ID',
  telegramAllowedChatIds: 'TELEGRAM_ALLOWED_CHAT_IDS',
  telegramAdminChatIds: 'TELEGRAM_ADMIN_CHAT_IDS',
  telegramProxyUrl: 'TELEGRAM_PROXY_URL',
  telegramPollingEnabled: 'TELEGRAM_POLLING_ENABLED',
};

const SECRET_KEYS = Object.keys(ENV_KEYS) as RuntimeSecretKey[];

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanValue(key: RuntimeSecretKey, value: unknown): string | boolean {
  if (key === 'telegramPollingEnabled') return value === true || value === 'true';
  return clean(value).slice(0, 2000);
}

export interface RuntimeSecretStatus {
  openrouterConfigured: boolean;
  groqConfigured: boolean;
  telegramConfigured: boolean;
  telegramPollingEnabled: boolean;
  telegramAllowedChatCount: number;
}

export interface RuntimeTelegramConfig {
  botToken: string;
  chatId: string;
  allowedChatIds: string;
  adminChatIds: string;
  proxyUrl: string;
  pollingEnabled: boolean;
}

export class RuntimeSecretsStore {
  private values: RuntimeSecretValues;

  constructor(private readonly filePath = path.join(DATA_ROOT, 'runtime-secrets.json')) {
    this.values = this.read();
  }

  get(key: RuntimeSecretKey): string | boolean | undefined {
    return this.values[key];
  }

  update(partial: Partial<RuntimeSecretValues>): void {
    const next = { ...this.values };
    for (const key of SECRET_KEYS) {
      if (!(key in partial)) continue;
      next[key] = cleanValue(key, partial[key]);
    }
    this.values = next;
    this.write();
  }

  status(env: Environment = process.env): RuntimeSecretStatus {
    const telegram = getRuntimeTelegramConfig(this, env);
    return {
      openrouterConfigured: Boolean(getRuntimeAiKey('openrouter', this, env)),
      groqConfigured: Boolean(getRuntimeAiKey('groq', this, env)),
      telegramConfigured: Boolean(telegram.botToken && telegram.chatId),
      telegramPollingEnabled: telegram.pollingEnabled,
      telegramAllowedChatCount: parseChatIds(telegram.allowedChatIds, telegram.chatId).length,
    };
  }

  private read(): RuntimeSecretValues {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Record<string, unknown>;
      return Object.fromEntries(
        SECRET_KEYS
          .filter(key => key in parsed)
          .map(key => [key, cleanValue(key, parsed[key])]),
      ) as RuntimeSecretValues;
    } catch {
      return {};
    }
  }

  private write(): void {
    ensureDir(path.dirname(this.filePath));
    fs.writeFileSync(this.filePath, JSON.stringify(this.values, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}

export const runtimeSecrets = new RuntimeSecretsStore();

function resolveString(key: RuntimeSecretKey, store: RuntimeSecretsStore, env: Environment): string {
  const saved = store.get(key);
  if (typeof saved === 'string' && saved) return saved;
  return clean(env[ENV_KEYS[key]]);
}

export function getRuntimeAiKey(
  chain: 'openrouter' | 'groq',
  store = runtimeSecrets,
  env: Environment = process.env,
): string {
  return resolveString(chain === 'openrouter' ? 'openrouterApiKey' : 'groqApiKey', store, env);
}

export function parseChatIds(value: string, fallback = ''): string[] {
  const ids = value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean);
  if (ids.length) return [...new Set(ids)];
  return fallback.trim() ? [fallback.trim()] : [];
}

export function getRuntimeTelegramConfig(
  store = runtimeSecrets,
  env: Environment = process.env,
): RuntimeTelegramConfig {
  const chatId = resolveString('telegramChatId', store, env);
  return {
    botToken: resolveString('telegramBotToken', store, env),
    chatId,
    allowedChatIds: resolveString('telegramAllowedChatIds', store, env),
    adminChatIds: resolveString('telegramAdminChatIds', store, env),
    proxyUrl: resolveString('telegramProxyUrl', store, env),
    pollingEnabled: store.get('telegramPollingEnabled') !== undefined
      ? store.get('telegramPollingEnabled') === true
      : env.TELEGRAM_POLLING_ENABLED === 'true',
  };
}
