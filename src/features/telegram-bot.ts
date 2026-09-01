import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

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
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

export interface TelegramInteractionBotOptions {
  token?: string;
  proxyUrl?: string;
  allowedChatIds: Iterable<string> | string;
  handlers: Record<string, TelegramCommandHandler>;
  textHandlers?: Record<string, TelegramCommandHandler>;
  callbackHandlers?: Record<string, TelegramCallbackHandler>;
  unknownCallbackHandler?: TelegramCallbackHandler;
  transport?: TelegramTransport;
  stateFile?: string;
  pollTimeoutSeconds?: number;
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

class TelegramApiTransport implements TelegramTransport {
  constructor(
    private readonly token: string,
    private readonly proxyUrl = '',
  ) {}

  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    const response = await this.callApi<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'channel_post', 'callback_query'],
    }, Math.max(15_000, (timeoutSeconds + 10) * 1000));
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

  private async callApi<T>(method: string, body: Record<string, unknown>, timeoutMs: number): Promise<TelegramApiResponse<T>> {
    const url = `${TELEGRAM_API}/bot${this.token}/${method}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = await response.json() as TelegramApiResponse<T>;
      if (!response.ok || !parsed.ok) throw new Error(parsed.description || `Telegram HTTP ${response.status}`);
      return parsed;
    } catch (error) {
      if (!this.proxyUrl) throw error;
      return await this.callApiWithCurl<T>(url, body, timeoutMs);
    }
  }

  private async callApiWithCurl<T>(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<TelegramApiResponse<T>> {
    const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const maxTimeSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));
    const args = [
      '--silent', '--show-error', '--location', '--max-time', String(maxTimeSeconds),
      '--request', 'POST', url,
      '--header', 'Content-Type: application/json',
      '--data', JSON.stringify(body),
      '--proxy', this.proxyUrl,
    ];
    const output = await new Promise<string>((resolve, reject) => {
      execFile(command, args, { windowsHide: true, timeout: timeoutMs + 3_000 }, (error, stdout) => {
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

export class TelegramInteractionBot {
  private readonly allowedChatIds: Set<string>;
  private readonly handlers: Record<string, TelegramCommandHandler>;
  private readonly textHandlers: Record<string, TelegramCommandHandler>;
  private readonly callbackHandlers: Record<string, TelegramCallbackHandler>;
  private readonly unknownCallbackHandler?: TelegramCallbackHandler;
  private readonly transport: TelegramTransport;
  private readonly stateFile: string;
  private readonly pollTimeoutSeconds: number;
  private readonly logger: Pick<Console, 'error'>;
  private nextOffset = 0;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private lastPollError: string | null = null;
  private lastPollAt: string | null = null;

  constructor(options: TelegramInteractionBotOptions) {
    this.allowedChatIds = typeof options.allowedChatIds === 'string'
      ? parseAllowedChatIds(options.allowedChatIds)
      : new Set([...options.allowedChatIds].map(String));
    this.handlers = options.handlers;
    this.textHandlers = options.textHandlers || {};
    this.callbackHandlers = options.callbackHandlers || {};
    this.unknownCallbackHandler = options.unknownCallbackHandler;
    this.transport = options.transport || new TelegramApiTransport(options.token || '', options.proxyUrl || '');
    this.stateFile = options.stateFile || path.resolve('data/telegram-bot-state.json');
    this.pollTimeoutSeconds = Math.max(1, Math.min(50, options.pollTimeoutSeconds || 25));
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

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  stop(): void {
    this.running = false;
  }

  async pollOnce(): Promise<number> {
    const updates = await this.transport.getUpdates(this.nextOffset, this.pollTimeoutSeconds);
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
    const handler = parsed ? (this.handlers[command] || this.handlers.help) : textHandler;
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
    const parts = splitTelegramMessage(normalized.text);
    for (const part of parts) {
      await this.transport.sendMessage(chatId, part, normalized.replyMarkup);
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
        this.lastPollAt = new Date().toISOString();
        this.lastPollError = null;
      } catch (error) {
        this.lastPollError = error instanceof Error ? error.message : 'unknown error';
        this.lastPollAt = new Date().toISOString();
        this.logger.error(`[telegram] polling failed: ${this.lastPollError}`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    this.loopPromise = null;
  }

  private readState(): TelegramState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Partial<TelegramState>;
      return { nextOffset: Number.isInteger(parsed.nextOffset) && parsed.nextOffset! >= 0 ? parsed.nextOffset! : 0 };
    } catch {
      return { nextOffset: 0 };
    }
  }

  private writeState(): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify({ nextOffset: this.nextOffset }), 'utf8');
    fs.renameSync(tempFile, this.stateFile);
  }
}

export function createTelegramInteractionBot(options: TelegramInteractionBotOptions): TelegramInteractionBot {
  return new TelegramInteractionBot(options);
}
