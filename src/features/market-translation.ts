/**
 * Small keyless translation layer for public prediction-market titles.
 *
 * Youdao's public research endpoint is tried first because it handles complete
 * prediction-market questions well. MyMemory remains as a fallback. Successful
 * results are persisted locally, so restarting the app does not spend the free
 * quota on titles the user has already seen.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_ROOT, ensureDir } from '../utils/paths';

interface TranslationCacheEntry {
  text: string;
  expiresAt: number;
  version?: number;
}

const CACHE_VERSION = 2;

const CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_TRANSLATIONS_PER_REFRESH = 100;
const CONCURRENCY = 3;
const CACHE_FILE = path.join(DATA_ROOT, 'title-translations.cache.json');

const cache = new Map<string, TranslationCacheEntry>();
let cacheLoaded = false;

interface SogouSession {
  cookie: string;
  uuid: string;
  secretCode: string;
  expiresAt: number;
}

let sogouSession: SogouSession | null = null;

function isChinese(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(value);
}

function loadPersistentCache(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, TranslationCacheEntry>;
    for (const [source, entry] of Object.entries(raw || {})) {
      if (entry?.text && entry?.version === CACHE_VERSION && Number(entry?.expiresAt) > Date.now()) {
        cache.set(source.toLowerCase(), {
          text: String(entry.text),
          expiresAt: Number(entry.expiresAt),
        });
      }
    }
  } catch {
    // Translation cache is optional.
  }
}

function savePersistentCache(): void {
  try {
    ensureDir(DATA_ROOT);
    const entries = [...cache.entries()]
      .filter(([, entry]) => entry.expiresAt > Date.now())
      .sort((left, right) => right[1].expiresAt - left[1].expiresAt)
      .slice(0, 1200);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(entries), null, 2), 'utf8');
  } catch {
    // A read-only data folder should not break market loading.
  }
}

function translationSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function refreshSogouSession(signal?: AbortSignal): Promise<SogouSession> {
  const pageUrl = 'https://fanyi.sogou.com/text?keyword=MoneyMoney&transfrom=en&transto=zh-CHS&model=general&fr=default';
  const response = await fetch(pageUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoneyMoney/1.0',
    },
    signal: translationSignal(8_000, signal),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const uuid = html.match(/uuid":"([^"]+)/)?.[1] || '';
  const secretCode = html.match(/secretCode":(\d+)/)?.[1] || '';
  const cookies = ((response.headers as any).getSetCookie?.() || []) as string[];
  const cookie = cookies.map(item => item.split(';')[0]).filter(Boolean).join('; ');
  if (!uuid || !secretCode || !cookie) throw new Error('Sogou session unavailable');
  signal?.throwIfAborted();
  const session = { cookie, uuid, secretCode, expiresAt: Date.now() + 30 * 60_000 };
  sogouSession = session;
  return session;
}

async function requestSogouOnce(text: string, session: SogouSession, signal?: AbortSignal): Promise<string> {
  const from = 'en';
  const to = 'zh-CHS';
  // Sogou's web endpoint sometimes eats a leading "$100" as a template token.
  // Saying "100,000 US dollars" keeps amounts visible in the Chinese result.
  const sourceText = text
    .slice(0, 450)
    .replace(/\$\s?([0-9][0-9,.]*)/g, '$1 US dollars');
  const signature = crypto
    .createHash('md5')
    .update(`${from}${to}${sourceText}${session.secretCode}`, 'utf8')
    .digest('hex');
  const body = new URLSearchParams({
    from,
    to,
    text: sourceText,
    client: 'pc',
    fr: 'browser_pc',
    needQc: '1',
    s: signature,
    uuid: session.uuid,
    exchange: 'false',
  });
  const response = await fetch('https://fanyi.sogou.com/api/transpc/text/result', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      cookie: session.cookie,
      origin: 'https://fanyi.sogou.com',
      referer: 'https://fanyi.sogou.com/text?keyword=MoneyMoney&transfrom=en&transto=zh-CHS&model=general&fr=default',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoneyMoney/1.0',
      'x-requested-with': 'XMLHttpRequest',
    },
    body,
    signal: translationSignal(7_000, signal),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as any;
  const translated = String(payload?.data?.translate?.dit || '').trim();
  const errorCode = String(payload?.data?.translate?.errorCode || '');
  if (!translated || !['0', 's0'].includes(errorCode)) {
    throw new Error(`Sogou translation unavailable (${errorCode || payload?.status})`);
  }
  return translated;
}

async function requestSogou(text: string, signal?: AbortSignal): Promise<string | undefined> {
  const session = !sogouSession || sogouSession.expiresAt < Date.now()
    ? await refreshSogouSession(signal)
    : sogouSession;
  try {
    return await requestSogouOnce(text, session, signal);
  } catch (error) {
    // A short-lived browser session can expire mid-refresh; establish it once.
    signal?.throwIfAborted();
    const fresh = await refreshSogouSession(signal);
    return await requestSogouOnce(text, fresh, signal);
  }
}

async function requestYoudao(text: string, signal?: AbortSignal): Promise<string | undefined> {
  const params = new URLSearchParams({
    q: text.slice(0, 450),
    from: 'en',
    to: 'zh-CHS',
  });
  const response = await fetch(`https://aidemo.youdao.com/trans?${params}`, {
    headers: {
      accept: 'application/json',
      referer: 'https://aidemo.youdao.com/',
      'user-agent': 'MoneyMoney/1.0 (+https://github.com/blueicx/MoneyMoney)',
    },
    signal: translationSignal(7_000, signal),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as any;
  const translated = String(payload?.translation?.[0] || '').trim();
  if (!translated || payload?.errorCode !== '0') throw new Error('Youdao response unavailable');
  return translated;
}

async function requestMyMemory(text: string, signal?: AbortSignal): Promise<string | undefined> {
  const params = new URLSearchParams({
    q: text.slice(0, 480),
    langpair: 'en|zh-CN',
  });
  const email = process.env.MYMEMORY_EMAIL;
  if (email) params.set('de', email);

  const response = await fetch(`https://api.mymemory.translated.net/get?${params}`, {
    headers: { accept: 'application/json' },
    signal: translationSignal(5_000, signal),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as any;
  const translated = String(payload?.responseData?.translatedText || '').trim();
  if (!translated || /^MYMEMORY WARNING/i.test(translated)) throw new Error('Translation quota or response unavailable');
  return translated;
}

async function requestAnyTranslation(text: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    return await requestSogou(text, signal);
  } catch {
    signal?.throwIfAborted();
    try {
      return await requestYoudao(text, signal);
    } catch {
      signal?.throwIfAborted();
      return await requestMyMemory(text, signal);
    }
  }
}

/**
 * Translate only what the user will see first. The original English title
 * remains available for exact matching and for opening the venue page.
 */
export async function translateEnglishTitles(
  titles: string[],
  limit = MAX_TRANSLATIONS_PER_REFRESH,
  options: { budgetMs?: number } = {},
): Promise<Map<string, string>> {
  if (options.budgetMs !== undefined && (!Number.isInteger(options.budgetMs) || options.budgetMs < 1 || options.budgetMs > 10_000)) {
    throw new Error('Translation budget must be an integer from 1 to 10000 ms');
  }
  const signal = options.budgetMs === undefined ? undefined : AbortSignal.timeout(options.budgetMs);
  loadPersistentCache();
  const unique = [...new Set(titles.map(item => item.trim()).filter(Boolean))];
  const pending = unique.filter(item => !isChinese(item)).slice(0, limit);
  const results = new Map<string, string>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length && !signal?.aborted) {
      const index = cursor++;
      const source = pending[index];
      const cached = cache.get(source.toLowerCase());
      if (cached && cached.expiresAt > Date.now()) {
        results.set(source, cached.text);
        continue;
      }
      try {
        const translated = await requestAnyTranslation(source, signal);
        if (signal?.aborted) break;
        // A provider sometimes echoes a phrase when it has no useful model.
        // Keeping the local Chinese summary is better than pretending it was translated.
        if (translated && translated.toLowerCase() !== source.toLowerCase()) {
          results.set(source, translated);
          cache.set(source.toLowerCase(), {
          text: translated,
          expiresAt: Date.now() + CACHE_TTL_MS,
          version: CACHE_VERSION,
          });
          savePersistentCache();
        }
      } catch {
        // A missing optional translation must never break the market radar.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  for (const [source, translated] of cache.entries()) {
    if (translated.expiresAt > Date.now()) results.set(source, translated.text);
  }
  return results;
}
