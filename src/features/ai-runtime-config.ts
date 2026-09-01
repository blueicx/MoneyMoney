import { settingsManager, type StrategySettings } from './news-settings';
import { resolveChatCompletionsUrl } from './ai-endpoint';

export type AiChain = 'openrouter' | 'groq';

export interface AiRuntimeConfig {
  chain: AiChain;
  apiKey: string;
  apiUrl: string;
  model: string;
  configured: boolean;
}

export interface AiConfigurationStatus {
  configured: boolean;
  apiUrl: string;
  model: string;
}

export interface AiConnectionTestResult {
  success: boolean;
  chain: AiChain;
  model: string;
  latencyMs: number;
  message: string;
}

type AiSettings = Pick<StrategySettings, 'openRouterApiUrl' | 'openRouterModel' | 'groqApiUrl' | 'groqModel'>;
type Environment = Record<string, string | undefined>;

const DEFAULTS = {
  openrouter: {
    apiUrl: 'https://openrouter.ai/api/v1',
    model: 'minimax/minimax-m3:free',
    key: 'OPENROUTER_API_KEY',
    url: 'OPENROUTER_API_URL',
    baseUrl: 'OPENROUTER_BASE_URL',
    modelEnv: 'OPENROUTER_MODEL',
  },
  groq: {
    apiUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    key: 'GROQ_API_KEY',
    url: 'GROQ_API_URL',
    baseUrl: 'GROQ_BASE_URL',
    modelEnv: 'GROQ_MODEL',
  },
} as const;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function getAiRuntimeConfig(
  chain: AiChain,
  settings?: Partial<AiSettings>,
  env: Environment = process.env,
): AiRuntimeConfig {
  const saved = settings ?? settingsManager.get();
  const defaults = DEFAULTS[chain];
  const savedUrl = chain === 'openrouter' ? saved.openRouterApiUrl : saved.groqApiUrl;
  const savedModel = chain === 'openrouter' ? saved.openRouterModel : saved.groqModel;
  const explicitUrl = trim(savedUrl) || trim(env[defaults.url]);
  const baseUrl = trim(env[defaults.baseUrl]);
  const model = trim(savedModel) || trim(env[defaults.modelEnv]) || defaults.model;

  return {
    chain,
    apiKey: trim(env[defaults.key]),
    apiUrl: resolveChatCompletionsUrl(explicitUrl, baseUrl, defaults.apiUrl),
    model,
    configured: Boolean(trim(env[defaults.key])),
  };
}

export function getAiConfigurationStatus(
  settings?: Partial<AiSettings>,
  env: Environment = process.env,
): Record<AiChain, AiConfigurationStatus> {
  const openrouter = getAiRuntimeConfig('openrouter', settings, env);
  const groq = getAiRuntimeConfig('groq', settings, env);
  return {
    openrouter: { configured: openrouter.configured, apiUrl: openrouter.apiUrl, model: openrouter.model },
    groq: { configured: groq.configured, apiUrl: groq.apiUrl, model: groq.model },
  };
}

export async function testAiConnection(
  chain: AiChain,
  settings?: Partial<AiSettings>,
  env: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AiConnectionTestResult> {
  const runtime = getAiRuntimeConfig(chain, settings, env);
  if (!runtime.configured) {
    return { success: false, chain, model: runtime.model, latencyMs: 0, message: `未配置 ${chain === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GROQ_API_KEY'}` };
  }

  const started = Date.now();
  try {
    const response = await fetchImpl(runtime.apiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: runtime.model,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { success: false, chain, model: runtime.model, latencyMs: Date.now() - started, message: `接口返回 HTTP ${response.status}` };
    return { success: true, chain, model: runtime.model, latencyMs: Date.now() - started, message: '连接成功，模型接口可用' };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? '连接超时' : '连接失败，请检查 URL、模型和 API Key';
    return { success: false, chain, model: runtime.model, latencyMs: Date.now() - started, message };
  }
}
