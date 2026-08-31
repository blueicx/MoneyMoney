import type { PredictionRadar } from './prediction-radar';
import { resolveChatCompletionsUrl } from './ai-endpoint';

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_MODEL = (process.env.OPENROUTER_MODEL || 'minimax/minimax-m3:free').trim();
export function resolveOpenRouterApiUrl(explicitUrl = process.env.OPENROUTER_API_URL, baseUrl = process.env.OPENROUTER_BASE_URL): string {
  return resolveChatCompletionsUrl(explicitUrl, baseUrl, 'https://openrouter.ai/api/v1');
}
const OPENROUTER_URL = resolveOpenRouterApiUrl();
const FALLBACK_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
];

interface CommentaryCache {
  value: string;
  model: string;
  createdAt: string;
  signature: string;
}

let cache: CommentaryCache | null = null;
let pending: Promise<CommentaryCache> | null = null;

function radarSignature(radar: PredictionRadar): string {
  return radar.markets
    .slice(0, 12)
    .map(item => `${item.platform}:${item.id}:${item.yesPrice.toFixed(2)}:${item.volume24h}`)
    .join('|');
}

function buildPrompt(radar: PredictionRadar): string {
  const rows = radar.markets
    .slice(0, 12)
    .map((item, index) => {
      const yes = Math.round(item.yesPrice * 100);
      const consensus = item.consensusProbability == null ? null : Math.round(item.consensusProbability * 100);
      const deadline = item.endDate ? new Date(item.endDate).toISOString().slice(0, 10) : '未知';
      return `${index + 1}. ${item.titleZh || item.title} | 平台:${item.platform} | 分类:${item.group} | 概率:${yes}% | 共识:${consensus ?? '-'}% | 24H成交:$${Math.round(item.volume24h)} | 截止:${deadline}`;
    })
    .join('\n');

  return `你是严谨的中文市场研究助手。以下是跨平台预测市场的最新快照：\n${rows}\n\n请用简体中文输出三段，不要编造数据，不给出保证赚钱的说法，不构成投资建议：\n1. 今日重点：最多 4 条，解释哪些市场最值得关注；\n2. 分歧与风险：指出概率分歧、低流动性、临近截止或解读风险；\n3. 观察清单：给出 3 个后续核对动作。\n\n要求总长不超过 320 字，使用短句和“·”分隔要点。`;
}

async function callOpenRouter(model: string, prompt: string): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'http-referer': 'https://github.com/blueicx/MoneyMoney',
      'x-title': 'MoneyMoney',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你擅长把预测市场数据转成简洁、谨慎、可核对的中文研究点评。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 650,
      temperature: 0.25,
    }),
    signal: AbortSignal.timeout(24_000),
  });
  const payload = await res.json().catch(() => null) as any;
  if (!res.ok) {
    const detail = payload?.error?.message || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  const content = String(payload?.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('模型没有返回内容');
  return content;
}

export function aiCommentaryConfigured(): boolean {
  return !!OPENROUTER_API_KEY;
}

export async function getAiMarketCommentary(radar: PredictionRadar, force = false): Promise<{
  configured: boolean;
  analysis: string;
  model: string;
  updatedAt: string;
  cached: boolean;
}> {
  if (!OPENROUTER_API_KEY) {
    return {
      configured: false,
      analysis: '未配置 OPENROUTER_API_KEY。请在本机 .env 中填写 OpenRouter 密钥。',
      model: '',
      updatedAt: new Date().toISOString(),
      cached: false,
    };
  }

  const signature = radarSignature(radar);
  if (!force && cache && cache.signature === signature) {
    return {
      configured: true,
      analysis: cache.value,
      model: cache.model,
      updatedAt: cache.createdAt,
      cached: true,
    };
  }
  if (!force && pending) {
    const result = await pending;
    return {
      configured: true,
      analysis: result.value,
      model: result.model,
      updatedAt: result.createdAt,
      cached: false,
    };
  }

  pending = (async () => {
    const prompt = buildPrompt(radar);
    let lastError = '';
    for (const model of [OPENROUTER_MODEL, ...FALLBACK_MODELS.filter(item => item !== OPENROUTER_MODEL)]) {
      try {
        const value = await callOpenRouter(model, prompt);
        cache = { value, model, createdAt: new Date().toISOString(), signature };
        return cache;
      } catch (error: any) {
        lastError = String(error?.message || error);
      }
    }
    throw new Error(lastError || 'AI 点评暂时不可用');
  })();

  try {
    const result = await pending;
    return {
      configured: true,
      analysis: result.value,
      model: result.model,
      updatedAt: result.createdAt,
      cached: false,
    };
  } finally {
    pending = null;
  }
}
