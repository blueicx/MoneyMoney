import { randomInt } from 'node:crypto';

interface OpenRouterModel {
  id?: string;
  pricing?: Record<string, unknown>;
  architecture?: { output_modalities?: string[] };
}

function isExplicitZero(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value)) && Number(value) === 0;
}

export function selectRandomOpenRouterFreeModel(
  rows: unknown,
  pickIndex: (length: number) => number = length => randomInt(length),
): string {
  const candidates = (Array.isArray(rows) ? rows as OpenRouterModel[] : [])
    .filter(row => {
      const id = String(row?.id || '').trim();
      const pricing = row?.pricing;
      const modalities = row?.architecture?.output_modalities;
      return /^[a-z0-9._/-]{1,150}:free$/i.test(id)
        && !['openrouter/free', 'openrouter/auto'].includes(id.toLowerCase())
        && !!pricing && isExplicitZero(pricing.prompt) && isExplicitZero(pricing.completion)
        && Object.keys(pricing).length > 0 && Object.values(pricing).every(isExplicitZero)
        && Array.isArray(modalities) && modalities.includes('text');
    })
    .map(row => String(row.id).trim())
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort((left, right) => left.localeCompare(right));
  if (!candidates.length) throw new Error('OpenRouter 当前目录没有可用的具体免费文本模型');
  const index = pickIndex(candidates.length);
  if (!Number.isSafeInteger(index) || index < 0 || index >= candidates.length) throw new Error('随机模型索引无效');
  return candidates[index];
}

export async function fetchRandomOpenRouterFreeModel(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  pickIndex?: (length: number) => number,
): Promise<string> {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('未配置 OpenRouter API Key');
  try {
    const response = await fetchImpl('https://openrouter.ai/api/v1/models', {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`OpenRouter 模型目录返回 HTTP ${response.status}`);
    const payload = await response.json() as { data?: unknown };
    return selectRandomOpenRouterFreeModel(payload.data, pickIndex);
  } catch (error) {
    if (error instanceof Error && /OpenRouter|免费文本模型|随机模型/.test(error.message)) throw error;
    throw new Error('OpenRouter 免费模型目录暂不可用');
  }
}
