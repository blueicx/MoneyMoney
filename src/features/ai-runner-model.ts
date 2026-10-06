import type { AiRuntimeConfig } from './ai-runtime-config';
import { validateAiRunnerModelIntent, type AiRunner, type AiRunnerDataEvidence, type AiRunnerModelIntent } from './ai-paper-runner';

export interface AiRunnerModelSnapshot {
  instrument: string;
  market: string;
  dataStatus: string;
  dataAt?: string;
  indicatorDataStatus?: string;
  indicatorDataAt?: string;
  indicatorRetrievedAt?: string;
  evidence?: AiRunnerDataEvidence[];
  source?: string;
  price?: number;
  rsi14?: number;
  sma10?: number;
  candidateSignals?: string[];
  openPosition?: boolean;
  reason?: string;
}

export async function requestAiRunnerIntent(
  runner: Pick<AiRunner, 'model' | 'universe' | 'comparisonControl'>,
  runtime: AiRuntimeConfig,
  snapshots: AiRunnerModelSnapshot[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; intent: AiRunnerModelIntent; model: string } | { ok: false; reason: string; model?: string }> {
  if (!runtime.configured || !runtime.apiKey) return { ok: false, reason: '未配置 OpenRouter，AI 跑单不可用' };
  const model = String(runner.model || runtime.model || '').trim();
  if (!model || model.length > 160) return { ok: false, reason: 'OpenRouter 模型配置无效' };
  const safeSnapshots = snapshots.slice(0, 5).map(item => ({
    instrument: String(item.instrument).slice(0, 80), market: String(item.market),
    dataStatus: String(item.dataStatus), dataAt: item.dataAt, source: item.source,
    indicatorDataStatus: item.indicatorDataStatus, indicatorDataAt: item.indicatorDataAt, indicatorRetrievedAt: item.indicatorRetrievedAt,
    evidence: (item.evidence || []).slice(0, 4).map(row => ({
      dataset: row.dataset, source: String(row.source).slice(0, 100), status: String(row.status).slice(0, 32),
      dataAt: row.dataAt, retrievedAt: row.retrievedAt, reason: String(row.reason || '').slice(0, 160),
    })),
    price: Number.isFinite(item.price) ? item.price : undefined,
    rsi14: Number.isFinite(item.rsi14) ? item.rsi14 : undefined,
    sma10: Number.isFinite(item.sma10) ? item.sma10 : undefined,
    candidateSignals: (item.candidateSignals || []).slice(0, 6),
    openPosition: item.openPosition === true, reason: String(item.reason || '').slice(0, 240),
  }));
  const messages = [
    {
      role: 'system',
      content: '你是 MoneyMoney 的模拟交易研究助手。不得输出思维链。仅根据给定快照返回一个 JSON 对象，字段为 action(BUY/SELL/HOLD)、instrument、side(可选)、confidence(0到1)、rationale(简短证据摘要)、counterEvidence(字符串数组)、riskNotes(字符串数组)、market。只能选择输入中冻结范围内的 instrument；任一决策所依赖的数据或指标陈旧、历史、失败或证据不足时必须 HOLD。不得提出真实下单。',
    },
    { role: 'user', content: JSON.stringify({ market: runner.universe?.market, allowedInstruments: runner.universe?.instruments.map(item => item.symbolOrMarketId), snapshots: safeSnapshots }) },
  ];
  try {
    const response = await fetchImpl(runtime.apiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 600,
        ...(runner.comparisonControl ? { seed: runner.comparisonControl.seed } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, reason: `AI 接口返回 HTTP ${response.status}`, model };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    const validated = validateAiRunnerModelIntent(content, runner);
    if (!validated.ok) return { ok: false, reason: validated.reason, model };
    if (validated.intent.market && validated.intent.market !== runner.universe?.market) return { ok: false, reason: 'AI 意图市场与冻结范围不一致', model };
    return { ok: true, intent: validated.intent, model };
  } catch {
    return { ok: false, reason: 'AI 请求失败或超时', model };
  }
}
