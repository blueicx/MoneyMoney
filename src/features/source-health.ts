import { getPredictionRadar } from './prediction-radar';
import { aiCommentaryConfigured } from './ai-commentary';
import { ResilientDataSourceAdapter, type SourceStatus } from '../data/source-adapter';

export interface SourceHealthItem {
  id: string;
  name: string;
  group: string;
  ok: boolean;
  configured?: boolean;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
  status?: SourceStatus;
  expiresAt?: string;
}

export interface SourceHealthReport {
  updatedAt: string;
  total: number;
  online: number;
  configuredOptional: number;
  items: SourceHealthItem[];
}

interface HealthCache {
  value: SourceHealthReport;
  expiresAt: number;
}

let cache: HealthCache | null = null;

function friendlyError(value: unknown): string {
  const text = String(value || '未知错误');
  if (/aborted due to timeout|timeout|timed out/i.test(text)) return '连接超时';
  if (/HTTP 5\d\d|ECONN|ENOTFOUND|fetch failed|network/i.test(text)) return '暂时连不上';
  if (/HTTP 4\d\d/i.test(text)) return '访问受限';
  if (/allorigins|relay/i.test(text)) return '公共线路不稳定';
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

async function timedJson(
  url: string,
  timeoutMs = 5_000,
  init: RequestInit = {},
): Promise<{ ok: boolean; latencyMs: number; payload?: any; error?: Error }> {
  const key = `${url}:${init.method || 'GET'}:${String(init.body || '')}`;
  let adapter = jsonAdapters.get(key);
  if (!adapter) {
    adapter = new ResilientDataSourceAdapter<any>({
      id: key,
      group: 'health-check',
      timeoutMs,
      retries: 2,
      fetcher: async (_input, signal) => {
        const response = await fetch(url, {
          ...init,
          headers: {
            accept: 'application/json',
            'user-agent': 'MoneyMoney/1.0 (+https://github.com/blueicx/MoneyMoney)',
            ...(init.headers || {}),
          },
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      },
    });
    jsonAdapters.set(key, adapter);
  }
  const snapshot = await adapter.fetch();
  return {
    ok: snapshot.status === 'fresh' || snapshot.status === 'stale',
    latencyMs: snapshot.latencyMs || 0,
    payload: snapshot.data,
    error: snapshot.error ? new Error(snapshot.error) : undefined,
  };
}

const jsonAdapters = new Map<string, ResilientDataSourceAdapter<any>>();

function radarItem(
  name: string,
  state: { ok: boolean; count: number; error?: string; latencyMs?: number; checkedAt?: string },
  configured?: boolean,
): SourceHealthItem {
  const unconfigured = configured === false;
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    group: '预测雷达',
    ok: !unconfigured && state.ok && state.count > 0,
    configured,
    latencyMs: state.latencyMs ?? null,
    detail: unconfigured
      ? '可选数据源未配置 Token'
      : state.ok
      ? (state.count > 0 ? `${state.count} 个市场` : '连接成功，暂无开放市场')
      : friendlyError(state.error),
    checkedAt: state.checkedAt || new Date().toISOString(),
    status: unconfigured ? 'unconfigured' : state.ok ? 'fresh' : 'failed',
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  };
}

async function buildSourceHealth(): Promise<SourceHealthReport> {
  // This normally reuses the warm radar cache, so the panel does not duplicate
  // the radar's network work. On a fresh install it may wait for one warm-up.
  const radar = await getPredictionRadar('', 1);
  const checkedAt = new Date().toISOString();
  const source = radar.sources || {};
  const optionalConfigured: boolean[] = [];

  const [predict, binance, openMeteo] = await Promise.all([
    timedJson('https://graphql.predict.fun/graphql', 6_000, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query HealthCheck { categories(filter: { status: OPEN }, pagination: { first: 1 }) { totalCount edges { node { id } } } }',
        variables: {},
      }),
    }),
    timedJson('https://api.binance.com/api/v3/ping', 4_000),
    timedJson('https://api.open-meteo.com/v1/forecast?latitude=39.9042&longitude=116.4074&current=temperature_2m', 5_000),
  ]);

  const aiConfigured = aiCommentaryConfigured();
  optionalConfigured.push(aiConfigured);

  const extraItems: SourceHealthItem[] = [
    {
      id: 'predict-graphql',
      name: 'Predict.fun GraphQL',
      group: '交易数据',
      ok: predict.ok && !!predict.payload?.data?.categories,
      latencyMs: predict.latencyMs,
      detail: predict.ok
        ? `正常 · ${Number(predict.payload?.data?.categories?.totalCount || 0)} 个事件`
        : friendlyError(predict.error),
      checkedAt,
      status: predict.ok ? 'fresh' : 'failed',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    },
    {
      id: 'binance-public',
      name: '币安公共行情',
      group: '加密与宏观',
      ok: binance.ok,
      latencyMs: binance.latencyMs,
      detail: binance.ok ? '正常' : friendlyError(binance.error),
      checkedAt,
      status: binance.ok ? 'fresh' : 'failed',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    },
    {
      id: 'open-meteo',
      name: 'Open-Meteo 天气',
      group: '天气证据',
      ok: openMeteo.ok && openMeteo.payload?.current != null,
      latencyMs: openMeteo.latencyMs,
      detail: openMeteo.ok ? '预报接口正常' : friendlyError(openMeteo.error),
      checkedAt,
      status: openMeteo.ok ? 'fresh' : 'failed',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    },
    {
      id: 'openrouter',
      name: 'OpenRouter AI',
      group: 'AI 点评',
      ok: aiConfigured,
      configured: aiConfigured,
      latencyMs: null,
      detail: aiConfigured ? '已配置；实际生成时检查模型可用性' : '未配置 OPENROUTER_API_KEY',
      checkedAt,
      status: aiConfigured ? 'fresh' : 'unconfigured',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    },
  ];

  const items = [
    radarItem('Polymarket', source.polymarket || { ok: false, count: 0, error: '尚未检查', checkedAt }),
    radarItem('Kalshi', source.kalshi || { ok: false, count: 0, error: '尚未检查', checkedAt }),
    radarItem('Manifold', source.manifold || { ok: false, count: 0, error: '尚未检查', checkedAt }),
    radarItem('Good Judgment Open', source.gjopen || { ok: false, count: 0, error: '尚未检查', checkedAt }),
    radarItem('Metaculus', source.metaculus || { ok: false, count: 0, error: '尚未检查', checkedAt }, /未配置/.test(String(source.metaculus?.error || '')) ? false : undefined),
    ...extraItems,
  ];

  return {
    updatedAt: checkedAt,
    total: items.length,
    online: items.filter(item => item.ok).length,
    configuredOptional: optionalConfigured.filter(Boolean).length,
    items,
  };
}

export async function getSourceHealth(): Promise<SourceHealthReport> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const value = await buildSourceHealth();
  cache = { value, expiresAt: Date.now() + 30_000 };
  return value;
}
