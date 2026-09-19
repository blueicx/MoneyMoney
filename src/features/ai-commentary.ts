import type { PredictionRadar } from './prediction-radar';
import { getAiRuntimeConfig } from './ai-runtime-config';
import { resolveChatCompletionsUrl } from './ai-endpoint';
import type { MarketScope } from './market-scope';

type PredictionRadarInput = Pick<PredictionRadar, 'markets'>;

export function resolveOpenRouterApiUrl(explicitUrl = process.env.OPENROUTER_API_URL, baseUrl = process.env.OPENROUTER_BASE_URL): string {
  return resolveChatCompletionsUrl(explicitUrl, baseUrl, 'https://openrouter.ai/api/v1');
}
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
let pendingSignature: string | null = null;

function radarSignature(radar: PredictionRadarInput): string {
  return radar.markets
    .slice(0, 12)
    .map(item => `${item.platform}:${item.id}:${item.yesPrice.toFixed(2)}:${item.volume24h}`)
    .join('|');
}

const SCOPE_LABELS: Record<MarketScope, string> = {
  overview: '总体市场',
  stocks: '股票',
  options: '期权',
  crypto: '虚拟币',
  prediction: '预测市场',
  watchlist: '自选标的',
};

export interface MarketContext {
  scope: MarketScope;
  workspace: string;
  instrument: string;
  dataStatus: string;
  sourceRefs: string[];
}

export interface AiAction {
  type: 'open_detail' | 'add_watchlist' | 'create_alert' | 'run_backtest';
  label: string;
  scope: MarketScope;
  instrument: string;
}

export function buildMarketContext(scope: MarketScope = 'prediction', input: Partial<MarketContext> = {}): MarketContext {
  return {
    scope,
    workspace: String(input.workspace || 'analysis').replace(/[\r\n]+/g, ' ').trim().slice(0, 80),
    instrument: String(input.instrument || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120),
    dataStatus: String(input.dataStatus || 'unknown').replace(/[\r\n]+/g, ' ').trim().slice(0, 40),
    sourceRefs: Array.from(new Set((Array.isArray(input.sourceRefs) ? input.sourceRefs : []).map(item => String(item).replace(/[\r\n]+/g, ' ').trim()).filter(Boolean))).slice(0, 12),
  };
}

export function allowedAiActions(context: MarketContext): AiAction[] {
  if (!context.instrument) return [];
  const actions: AiAction[] = [
    { type: 'open_detail', label: '打开标的详情', scope: context.scope, instrument: context.instrument },
    { type: 'add_watchlist', label: '加入自选', scope: context.scope, instrument: context.instrument },
    { type: 'create_alert', label: '设置提醒', scope: context.scope, instrument: context.instrument },
  ];
  if (context.scope === 'stocks' || context.scope === 'crypto') actions.push({ type: 'run_backtest', label: '运行回测', scope: context.scope, instrument: context.instrument });
  return actions;
}

const SCOPE_REPORT_KEYS: Record<MarketScope, string[]> = {
  overview: ['stockActions', 'sectorActions', 'optionActions', 'cryptoActions', 'predictionPicks'],
  stocks: ['stockActions', 'sectorActions'],
  options: ['optionActions'],
  crypto: ['cryptoActions'],
  prediction: ['predictionPicks'],
  watchlist: ['stockActions', 'sectorActions', 'optionActions', 'cryptoActions', 'predictionPicks'],
};

function buildRadarRows(radar: PredictionRadarInput): string {
  const rows = radar.markets
    .slice(0, 12)
    .map((item, index) => {
      const yes = Math.round(item.yesPrice * 100);
      const consensus = item.consensusProbability == null ? null : Math.round(item.consensusProbability * 100);
      const deadline = item.endDate ? new Date(item.endDate).toISOString().slice(0, 10) : '未知';
      return `${index + 1}. ${item.titleZh || item.title} | 平台:${item.platform} | 分类:${item.group} | 概率:${yes}% | 共识:${consensus ?? '-'}% | 24H成交:$${Math.round(item.volume24h)} | 截止:${deadline}`;
    })
    .join('\n');

  return rows;
}

function buildReportRows(scope: MarketScope, report: Record<string, unknown>): string {
  return SCOPE_REPORT_KEYS[scope]
    .flatMap(key => Array.isArray(report[key]) ? report[key] as unknown[] : [])
    .slice(0, 24)
    .map(row => {
      const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      const title = String(item.titleZh || item.title || item.name || item.symbol || '').trim();
      const reason = String(item.reasonZh || item.reason || item.summary || item.signalZh || '').trim();
      return title ? `- ${title}${reason ? `：${reason}` : ''}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function buildAiMarketPrompt(
  scope: MarketScope = 'prediction',
  radar: PredictionRadarInput,
  report: Record<string, unknown> = {},
  instrumentRef = '',
  context: Partial<MarketContext> = {},
): string {
  const marketContext = buildMarketContext(scope, { ...context, instrument: context.instrument || instrumentRef });
  const selectedInstrument = marketContext.instrument;
  const sections: string[] = [
    `当前市场作用域：${SCOPE_LABELS[scope]}`,
    `当前标的：${selectedInstrument || '未指定'}`,
    `当前工作区：${marketContext.workspace}`,
    `数据状态：${marketContext.dataStatus}`,
    `来源引用：${marketContext.sourceRefs.length ? marketContext.sourceRefs.join('、') : '暂无'}`,
  ];
  if (scope === 'prediction' || scope === 'overview') {
    sections.push(`预测市场快照：\n${buildRadarRows(radar) || '暂无预测市场数据'}`);
  }
  if (scope !== 'prediction') {
    sections.push(`${SCOPE_LABELS[scope]}专属行动与指标：\n${buildReportRows(scope, report) || '暂无当前市场行动数据'}`);
  }
  return `你是严谨的中文市场研究助手。只分析“${SCOPE_LABELS[scope]}”作用域，禁止引用其他市场的数据或术语。以下是当前作用域可用的快照：\n${sections.join('\n\n')}\n\n请用简体中文输出三段，不要编造数据，不给出保证赚钱的说法，不构成投资建议：\n1. 今日重点：最多 4 条；\n2. 分歧与风险：指出数据不足、低流动性或解读风险；\n3. 观察清单：给出 3 个后续核对动作。\n\n要求总长不超过 320 字，使用短句和“·”分隔要点。`;
}

async function callOpenRouter(model: string, prompt: string): Promise<string> {
  const runtime = getAiRuntimeConfig('openrouter');
  const res = await fetch(runtime.apiUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${runtime.apiKey}`,
      'content-type': 'application/json',
      'http-referer': 'https://github.com/blueicx/MoneyMoney',
      'x-title': 'MoneyMoney',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你擅长把当前市场作用域的数据转成简洁、谨慎、可核对的中文研究点评。严格遵守给定作用域。' },
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
  return getAiRuntimeConfig('openrouter').configured;
}

export async function getAiMarketCommentary(
  radar: PredictionRadarInput,
  force = false,
  scope: MarketScope = 'prediction',
  report: Record<string, unknown> = {},
  instrumentRef: string = '',
  context: Partial<MarketContext> = {},
): Promise<{
  configured: boolean;
  analysis: string;
  model: string;
  updatedAt: string;
  cached: boolean;
  context: MarketContext;
  actions: AiAction[];
}> {
  const marketContext = buildMarketContext(scope, { ...context, instrument: context.instrument || instrumentRef });
  const actions = allowedAiActions(marketContext);
  const runtime = getAiRuntimeConfig('openrouter');
  if (!runtime.configured) {
    return {
      configured: false,
      analysis: '未配置 OPENROUTER_API_KEY。请在本机 .env 中填写 OpenRouter 密钥。',
      model: '',
      updatedAt: new Date().toISOString(),
      cached: false,
      context: marketContext,
      actions,
    };
  }

  const prompt = buildAiMarketPrompt(scope, radar, report, marketContext.instrument, marketContext);
  const signature = `${scope}|${radarSignature(radar)}|${prompt}|${JSON.stringify(marketContext)}`;
  const isCacheValid = cache && cache.signature === signature && (Date.now() - new Date(cache.createdAt).getTime() < 15 * 60 * 1000);
  if (!force && isCacheValid) {
    return {
      configured: true,
      analysis: cache!.value,
      model: cache!.model,
      updatedAt: cache!.createdAt,
      cached: true,
      context: marketContext,
      actions,
    };
  }
  if (!force && pending && pendingSignature === signature) {
    const result = await pending;
    return {
      configured: true,
      analysis: result.value,
      model: result.model,
      updatedAt: result.createdAt,
      cached: false,
      context: marketContext,
      actions,
    };
  }

  pendingSignature = signature;
  pending = (async () => {
    let lastError = '';
    for (const model of [runtime.model, ...FALLBACK_MODELS.filter(item => item !== runtime.model)]) {
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
      context: marketContext,
      actions,
    };
  } finally {
    if (pendingSignature === signature) {
      pending = null;
      pendingSignature = null;
    }
  }
}
