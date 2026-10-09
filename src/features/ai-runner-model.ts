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

function unwrapSingleJsonFence(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  const text = content.trim();
  const whole = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (whole) return whole[1].trim();
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  return blocks.length === 1 ? blocks[0][1].trim() : content;
}

export async function requestAiRunnerIntent(
  runner: Pick<AiRunner, 'model' | 'universe' | 'comparisonControl' | 'modelSelection'>,
  runtime: AiRuntimeConfig,
  snapshots: AiRunnerModelSnapshot[],
  fetchImpl: typeof fetch = fetch,
  beforeAttempt?: (model: string, attempt: number) => void,
): Promise<{ ok: true; intent: AiRunnerModelIntent; model: string } | { ok: false; reason: string; model?: string }> {
  if (!runtime.configured || !runtime.apiKey) return { ok: false, reason: '未配置 OpenRouter，AI 跑单不可用' };
  if (runner.modelSelection === 'available-free' && !runner.comparisonControl) {
    if (runtime.apiUrl !== 'https://openrouter.ai/api/v1/chat/completions') return { ok: false, reason: '免费自动切换仅支持 OpenRouter 官方接口' };
    const models = ['openrouter/free'];
    const failures: string[] = [];
    for (let attempt = 0; attempt < models.length && attempt < 3; attempt++) {
      const selected = models[attempt];
      try { beforeAttempt?.(selected, attempt); }
      catch (error) { return { ok: false, model: selected, reason: error instanceof Error ? error.message : 'AI 调用额度不足' }; }
      const result = await requestAiRunnerIntent({ ...runner, modelSelection: 'fixed', model: selected }, runtime, snapshots, fetchImpl);
      if (result.ok) return result;
      failures.push(`${selected}: ${result.reason}`);
      // Account/auth/rate failures apply to the service, not one model. Never spin.
      if (/HTTP (401|402|403|429)/.test(result.reason)) return result;
      if (attempt === 0) {
        try {
          const response = await fetchImpl('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5_000) });
          if (response.ok) {
            const catalog = await response.json() as { data?: Array<{ id?: string; pricing?: Record<string, string>; architecture?: { output_modalities?: string[] } }> };
            for (const row of catalog.data || []) {
              if (models.length >= 3) break;
              if (row.id?.endsWith(':free') && row.id.length <= 160 && row.pricing?.prompt === '0' && row.pricing?.completion === '0'
                && Object.values(row.pricing).every(value => Number(value) === 0) && row.architecture?.output_modalities?.includes('text') && !models.includes(row.id)) models.push(row.id);
            }
          }
        } catch { failures.push('免费模型目录暂不可用'); }
      }
    }
    return { ok: false, model: models[models.length - 1], reason: failures.join('；').slice(0, 600) };
  }
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
  try { beforeAttempt?.(model, 0); }
  catch (error) { return { ok: false, model, reason: error instanceof Error ? error.message : 'AI 调用额度不足' }; }
  try {
    const response = await fetchImpl(runtime.apiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 600,
        ...(runner.comparisonControl ? { seed: runner.comparisonControl.seed } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, reason: `AI 接口返回 HTTP ${response.status}`, model };
    const payload = await response.json() as { model?: string; choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    const validated = validateAiRunnerModelIntent(unwrapSingleJsonFence(content), runner);
    if (!validated.ok) return { ok: false, reason: validated.reason, model };
    if (validated.intent.market && validated.intent.market !== runner.universe?.market) return { ok: false, reason: 'AI 意图市场与冻结范围不一致', model };
    return { ok: true, intent: validated.intent, model: String(payload.model || model).slice(0, 160) };
  } catch {
    return { ok: false, reason: 'AI 请求失败或超时', model };
  }
}
