import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { curlCommand } from '../utils/platform-command';
import { buildTelegramBottomMenu } from '../web/telegram-menu';
import { telegramNetworkAllowed } from '../config/runtime-secrets';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096;

export interface TelegramChat {
  id: number | string;
  type?: string;
  username?: string;
  title?: string;
  first_name?: string;
}

export interface TelegramMessage {
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface ParsedTelegramCommand {
  command: string;
  args: string[];
}

export interface TelegramCommandContext {
  chatId: string;
  command: string;
  args: string[];
  message: TelegramMessage;
  update: TelegramUpdate;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramReplyKeyboardButton {
  text: string;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramReplyKeyboardButton[][];
  is_persistent?: boolean;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
  selective?: boolean;
}

export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;

export interface TelegramReply {
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  replyKeyboard?: 'menu';
}

export interface TelegramCallbackContext {
  callbackQueryId: string;
  chatId: string;
  data: string;
  message: TelegramMessage;
  update: TelegramUpdate;
}

export type TelegramCommandResult = string | TelegramReply | void;
export type TelegramCommandHandler = (context: TelegramCommandContext) => TelegramCommandResult | Promise<TelegramCommandResult>;
export type TelegramCallbackHandler = (context: TelegramCallbackContext) => TelegramCommandResult | Promise<TelegramCommandResult>;

export interface TelegramTransport {
  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

export interface TelegramPollStateStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, version?: number): void;
}

export interface TelegramPollLeaseStore {
  acquireLease(key: string, owner: string, now?: number, leaseMs?: number): boolean;
  refreshLease(key: string, owner: string, now?: number, leaseMs?: number): boolean;
  releaseLease(key: string, owner: string): boolean;
}

export interface TelegramInteractionBotOptions {
  token?: string;
  proxyUrl?: string;
  allowedChatIds: Iterable<string> | string;
  handlers: Record<string, TelegramCommandHandler>;
  textHandlers?: Record<string, TelegramCommandHandler>;
  textFallback?: TelegramCommandHandler;
  callbackHandlers?: Record<string, TelegramCallbackHandler>;
  unknownCallbackHandler?: TelegramCallbackHandler;
  transport?: TelegramTransport;
  stateFile?: string;
  pollStateStore?: TelegramPollStateStore;
  menuScope?: (chatId: string) => string;
  pollTimeoutSeconds?: number;
  pollLease?: TelegramPollLeaseStore;
  pollLeaseKey?: string;
  pollOwnerId?: string;
  pollLeaseMs?: number;
  pollLeaseWaitMs?: number;
  pollConflictBackoffMs?: number;
  logger?: Pick<Console, 'error'>;
}

interface TelegramState {
  nextOffset: number;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export function isTelegramPollingConflict(error: unknown): boolean {
  return /(?:409|conflict).*getupdates|terminated by other getupdates request/i.test(error instanceof Error ? error.message : String(error));
}

export function parseAllowedChatIds(value?: string, fallback?: string): Set<string> {
  const values = (value || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
  if (values.length > 0) return new Set(values);
  return fallback?.trim() ? new Set([fallback.trim()]) : new Set();
}

export function parseTelegramCommand(text?: string): ParsedTelegramCommand | null {
  const normalized = text?.trim() || '';
  const match = normalized.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const argsText = match[2]?.trim() || '';
  return {
    command: match[1].toLowerCase(),
    args: argsText ? argsText.split(/\s+/) : [],
  };
}

export function splitTelegramMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  if (maxLength <= 0) throw new Error('maxLength must be positive');
  if (!text) return [''];
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += maxLength) {
    parts.push(text.slice(start, start + maxLength));
  }
  return parts;
}

export function escapeTelegramHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export class TelegramApiTransport implements TelegramTransport {
  constructor(
    private readonly token: string,
    private readonly proxyUrl = '',
  ) {}

  async getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const response = await this.callApi<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'channel_post', 'callback_query'],
    }, Math.max(15_000, (timeoutSeconds + 10) * 1000), signal);
    return response.result || [];
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<void> {
    await this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }, 15_000);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.callApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    }, 15_000);
  }

  private async callApi<T>(method: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<TelegramApiResponse<T>> {
    if (!telegramNetworkAllowed()) throw new Error('Telegram network disabled in this environment');
    const url = `${TELEGRAM_API}/bot${this.token}/${method}`;
    const request = createTimeoutSignal(signal, timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal,
      });
      const parsed = await response.json() as TelegramApiResponse<T>;
      if (!response.ok || !parsed.ok) throw new Error(parsed.description || `Telegram HTTP ${response.status}`);
      return parsed;
    } catch (error) {
      // An intentional shutdown must never fall through to a second transport
      // request through curl. That would keep the long poll alive and could
      // release the lease while Telegram still sees the previous request.
      if (isAbortError(error)) throw error;
      if (!this.proxyUrl) throw error;
      return await this.callApiWithCurl<T>(url, body, timeoutMs, request.signal);
    } finally {
      request.cleanup();
    }
  }

  private async callApiWithCurl<T>(url: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<TelegramApiResponse<T>> {
    const command = curlCommand();
    const maxTimeSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));
    const args = [
      '--silent', '--show-error', '--location', '--max-time', String(maxTimeSeconds),
      '--request', 'POST', url,
      '--header', 'Content-Type: application/json',
      '--data', JSON.stringify(body),
      '--proxy', this.proxyUrl,
    ];
    const output = await new Promise<string>((resolve, reject) => {
      execFile(command, args, { windowsHide: true, timeout: timeoutMs + 3_000, signal }, (error, stdout) => {
        if (error) {
          reject(new Error(`Telegram proxy request failed (${error.code || 'unknown'})`));
          return;
        }
        resolve(stdout.toString());
      });
    });
    const parsed = JSON.parse(output) as TelegramApiResponse<T>;
    if (!parsed.ok) throw new Error(parsed.description || 'Telegram API request failed');
    return parsed;
  }
}

function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|abort/i.test(error.message));
}

export class TelegramInteractionBot {
  private readonly allowedChatIds: Set<string>;
  private readonly handlers: Record<string, TelegramCommandHandler>;
  private readonly textHandlers: Record<string, TelegramCommandHandler>;
  private readonly textFallback?: TelegramCommandHandler;
  private readonly callbackHandlers: Record<string, TelegramCallbackHandler>;
  private readonly unknownCallbackHandler?: TelegramCallbackHandler;
  private readonly transport: TelegramTransport;
  private readonly stateFile: string;
  private readonly pollStateStore?: TelegramPollStateStore;
  private readonly menuScope: (chatId: string) => string;
  private readonly pollTimeoutSeconds: number;
  private readonly pollLease?: TelegramPollLeaseStore;
  private readonly pollLeaseKey: string;
  private readonly pollOwnerId: string;
  private readonly pollLeaseMs: number;
  private readonly pollLeaseWaitMs: number;
  private readonly pollConflictBackoffMs: number;
  private readonly logger: Pick<Console, 'error'>;
  private nextOffset = 0;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private lastPollError: string | null = null;
  private lastPollAt: string | null = null;
  private lastSuccessfulPollAt: string | null = null;
  private leaseHeld = false;
  private leaseExpiresAt: number | null = null;
  private conflictCount = 0;

  constructor(options: TelegramInteractionBotOptions) {
    this.allowedChatIds = typeof options.allowedChatIds === 'string'
      ? parseAllowedChatIds(options.allowedChatIds)
      : new Set([...options.allowedChatIds].map(String));
    this.handlers = options.handlers;
    this.textHandlers = options.textHandlers || {};
    this.textFallback = options.textFallback;
    this.callbackHandlers = options.callbackHandlers || {};
    this.unknownCallbackHandler = options.unknownCallbackHandler;
    this.transport = options.transport || new TelegramApiTransport(options.token || '', options.proxyUrl || '');
    this.stateFile = options.stateFile || path.resolve('data/telegram-bot-state.json');
    this.pollStateStore = options.pollStateStore;
    this.menuScope = options.menuScope || (() => 'overview');
    this.pollTimeoutSeconds = Math.max(1, Math.min(50, options.pollTimeoutSeconds || 25));
    this.pollLease = options.pollLease;
    this.pollLeaseKey = options.pollLeaseKey || 'telegram:getUpdates';
    this.pollOwnerId = options.pollOwnerId || `telegram-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.pollLeaseMs = Math.max(5_000, options.pollLeaseMs || 30_000);
    this.pollLeaseWaitMs = Math.max(1, options.pollLeaseWaitMs || 1_000);
    this.pollConflictBackoffMs = Math.max(1, options.pollConflictBackoffMs || 30_000);
    this.logger = options.logger || console;
    this.nextOffset = this.readState().nextOffset;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get offset(): number {
    return this.nextOffset;
  }

  get lastError(): string | null {
    return this.lastPollError;
  }

  get lastPollTime(): string | null {
    return this.lastPollAt;
  }

  get pollingStatus(): {
    leaseKey: string;
    ownerId: string;
    leaseHeld: boolean;
    leaseExpiresAt: string | null;
    lastError: string | null;
    lastPollAt: string | null;
    lastSuccessfulPollAt: string | null;
    conflictCount: number;
  } {
    return {
      leaseKey: this.pollLeaseKey,
      ownerId: this.pollOwnerId,
      leaseHeld: this.leaseHeld,
      leaseExpiresAt: this.leaseExpiresAt == null ? null : new Date(this.leaseExpiresAt).toISOString(),
      lastError: this.lastPollError,
      lastPollAt: this.lastPollAt,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      conflictCount: this.conflictCount,
    };
  }

  start(): void {
    if (this.running) return;
    this.abortController = new AbortController();
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    const loop = this.loopPromise;
    if (loop) await loop;
    else this.releasePollLease();
    this.abortController = null;
  }

  async pollOnce(): Promise<number> {
    if (!this.ensurePollLease()) return 0;
    const updates = await this.transport.getUpdates(this.nextOffset, this.pollTimeoutSeconds, this.abortController?.signal);
    if (this.pollLease && !this.pollLease.refreshLease(this.pollLeaseKey, this.pollOwnerId, Date.now(), this.pollLeaseMs)) {
      this.leaseHeld = false;
      this.leaseExpiresAt = null;
      throw new Error('Telegram polling lease lost');
    }
    let handled = 0;
    for (const update of updates) {
      const result = await this.handleUpdate(update);
      if (result.handled) handled += 1;
    }
    return handled;
  }

  /** Send a direct interactive reply without exposing the transport to callers. */
  async sendToChat(chatId: string, reply: TelegramCommandResult): Promise<void> {
    if (!this.allowedChatIds.has(String(chatId))) return;
    await this.sendReply(String(chatId), reply);
  }

  async handleUpdate(update: TelegramUpdate): Promise<{ handled: boolean; reason: string }> {
    if (!Number.isInteger(update.update_id)) return { handled: false, reason: 'invalid_update' };
    if (update.update_id < this.nextOffset) return { handled: false, reason: 'duplicate_update' };

    this.nextOffset = update.update_id + 1;
    this.writeState();

    const callback = update.callback_query;
    const message = update.message || update.channel_post || callback?.message;
    if (!message) return { handled: false, reason: 'no_message' };
    const chatId = String(message.chat.id);
    if (!this.allowedChatIds.has(chatId)) return { handled: false, reason: 'unauthorized_chat' };

    if (callback) {
      const knownHandler = callback.data ? this.callbackHandlers[callback.data] : undefined;
      const handler = knownHandler || this.unknownCallbackHandler;
      await this.transport.answerCallbackQuery(callback.id, knownHandler ? undefined : '无法识别的按钮');
      if (!handler) return { handled: false, reason: 'unknown_callback' };
      const reply = await handler({
        callbackQueryId: callback.id,
        chatId,
        data: callback.data || '',
        message,
        update,
      });
      await this.sendReply(chatId, reply);
      return { handled: true, reason: 'callback_replied' };
    }

    if (!message.text) return { handled: false, reason: 'no_text_message' };

    const parsed = parseTelegramCommand(message.text);
    const textHandler = this.textHandlers[message.text.trim()];
    const command = parsed?.command || '';
    const args = parsed?.args || [];
    const handler = parsed ? (this.handlers[command] || this.handlers.help) : (textHandler || this.textFallback);
    if (!handler) return { handled: false, reason: parsed ? 'unknown_command' : 'not_a_command' };

    const reply = await handler({
      chatId,
      command,
      args,
      message,
      update,
    });
    await this.sendReply(chatId, reply);
    return { handled: true, reason: 'replied' };
  }

  private async sendReply(chatId: string, reply: TelegramCommandResult): Promise<void> {
    if (reply === undefined || reply === '') return;
    const normalized = typeof reply === 'string' ? { text: reply } : reply;
    const replyMarkup = normalized.replyKeyboard === 'menu'
      ? buildTelegramBottomMenu(chatId, this.menuScope(chatId))
      : normalized.replyMarkup;
    const parts = splitTelegramMessage(normalized.text);
    for (const part of parts) {
      await this.transport.sendMessage(chatId, part, replyMarkup);
    }
  }

  private async pollLoop(): Promise<void> {
    try {
      while (this.running) {
        try {
          await this.pollOnce();
          this.lastPollAt = new Date().toISOString();
          this.lastSuccessfulPollAt = this.lastPollAt;
          if (!this.pollLease || this.leaseHeld) this.lastPollError = null;
          if (this.pollLease) await this.delay(this.pollLeaseWaitMs);
        } catch (error) {
          if (!this.running && isAbortError(error)) break;
          this.lastPollError = error instanceof Error ? error.message : 'unknown error';
          this.lastPollAt = new Date().toISOString();
          if (isTelegramPollingConflict(error)) {
            this.conflictCount += 1;
            this.logger.error(`[telegram] polling conflict: ${this.lastPollError}`);
            this.releasePollLease();
            await this.delay(this.pollConflictBackoffMs);
          } else {
            this.logger.error(`[telegram] polling failed: ${this.lastPollError}`);
            await this.delay(1_000);
          }
        }
      }
    } finally {
      this.loopPromise = null;
      this.releasePollLease();
    }
  }

  private ensurePollLease(): boolean {
    if (!this.pollLease) return true;
    const now = Date.now();
    if (this.leaseHeld && this.pollLease.refreshLease(this.pollLeaseKey, this.pollOwnerId, now, this.pollLeaseMs)) {
      this.leaseExpiresAt = now + this.pollLeaseMs;
      return true;
    }
    this.leaseHeld = this.pollLease.acquireLease(this.pollLeaseKey, this.pollOwnerId, now, this.pollLeaseMs);
    this.leaseExpiresAt = this.leaseHeld ? now + this.pollLeaseMs : null;
    if (!this.leaseHeld) this.lastPollError = 'Telegram polling lease unavailable';
    return this.leaseHeld;
  }

  private releasePollLease(): void {
    if (this.pollLease && this.leaseHeld) this.pollLease.releaseLease(this.pollLeaseKey, this.pollOwnerId);
    this.leaseHeld = false;
    this.leaseExpiresAt = null;
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve(undefined);
      }, { once: true });
    });
  }

  private readState(): TelegramState {
    if (this.pollStateStore) {
      const stored = this.pollStateStore.get<Partial<TelegramState>>('telegram-poll-state');
      return { nextOffset: Number.isInteger(stored?.nextOffset) && stored!.nextOffset! >= 0 ? stored!.nextOffset! : 0 };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Partial<TelegramState>;
      return { nextOffset: Number.isInteger(parsed.nextOffset) && parsed.nextOffset! >= 0 ? parsed.nextOffset! : 0 };
    } catch {
      return { nextOffset: 0 };
    }
  }

  private writeState(): void {
    if (this.pollStateStore) {
      this.pollStateStore.set('telegram-poll-state', { nextOffset: this.nextOffset }, 1);
      return;
    }
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify({ nextOffset: this.nextOffset }), 'utf8');
    fs.renameSync(tempFile, this.stateFile);
  }
}

export function createTelegramInteractionBot(options: TelegramInteractionBotOptions): TelegramInteractionBot {
  return new TelegramInteractionBot(options);
}
