/**
 * Keyless weather forecast evidence for prediction-market research.
 *
 * Open-Meteo provides the observation model; it is never presented as a market's
 * official resolution source. Parsing is intentionally narrow so an unrelated
 * climate question cannot borrow a city forecast.
 */

import type { PredictionMarket } from './prediction-radar';

export type WeatherMetric = 'temperature_max' | 'temperature_min' | 'precipitation' | 'snowfall' | 'wind_gust';

export interface ParsedWeatherQuestion {
  location: string;
  latitude: number;
  longitude: number;
  metric: WeatherMetric;
  comparison: 'gte' | 'lte';
  displayValue: number;
  unit: '°C' | '°F' | 'mm' | 'cm' | 'in' | 'mph' | 'km/h';
  valueC?: number;
  valueMm?: number;
  valueKmh?: number;
  date?: string;
}

export interface WeatherForecast {
  dates: string[];
  temperatureMaxC?: number[];
  temperatureMinC?: number[];
  precipitationMm?: number[];
  snowfallCm?: number[];
  windGustKmh?: number[];
}

export interface WeatherForecastEvidence {
  provider: 'Open-Meteo';
  location: string;
  metricZh: string;
  targetZh: string;
  forecastZh: string;
  referenceProbability: number;
  confidence: number;
  judgmentZh: string;
  sourceUrl: string;
}

interface WeatherLocation {
  aliases: string[];
  latitude: number;
  longitude: number;
}

const LOCATIONS: WeatherLocation[] = [
  { aliases: ['Furnace Creek', 'Death Valley'], latitude: 36.4625, longitude: -116.8665 },
  { aliases: ['New York City', 'NYC'], latitude: 40.7128, longitude: -74.006 },
  { aliases: ['Los Angeles', 'L.A.'], latitude: 34.0522, longitude: -118.2437 },
  { aliases: ['Hong Kong'], latitude: 22.3193, longitude: 114.1694 },
  { aliases: ['San Francisco'], latitude: 37.7749, longitude: -122.4194 },
  { aliases: ['Strasbourg'], latitude: 48.5833, longitude: 7.7458 },
  { aliases: ['Singapore'], latitude: 1.3521, longitude: 103.8198 },
  { aliases: ['Vancouver'], latitude: 49.2827, longitude: -123.1207 },
  { aliases: ['Amsterdam'], latitude: 52.3676, longitude: 4.9041 },
  { aliases: ['Shanghai'], latitude: 31.2304, longitude: 121.4737 },
  { aliases: ['Beijing'], latitude: 39.9042, longitude: 116.4074 },
  { aliases: ['Toronto'], latitude: 43.6532, longitude: -79.3832 },
  { aliases: ['Chicago'], latitude: 41.8781, longitude: -87.6298 },
  { aliases: ['Berlin'], latitude: 52.52, longitude: 13.405 },
  { aliases: ['London'], latitude: 51.5072, longitude: -0.1276 },
  { aliases: ['Moscow'], latitude: 55.7558, longitude: 37.6173 },
  { aliases: ['Dubai'], latitude: 25.2048, longitude: 55.2708 },
  { aliases: ['Sydney'], latitude: -33.8688, longitude: 151.2093 },
  { aliases: ['Tokyo'], latitude: 35.6895, longitude: 139.6917 },
  { aliases: ['Seoul'], latitude: 37.5665, longitude: 126.978 },
  { aliases: ['Miami'], latitude: 25.7617, longitude: -80.1918 },
  { aliases: ['Madrid'], latitude: 40.4168, longitude: -3.7038 },
  { aliases: ['Delhi'], latitude: 28.6139, longitude: 77.209 },
  { aliases: ['Paris'], latitude: 48.8566, longitude: 2.3522 },
  { aliases: ['Rome'], latitude: 41.9028, longitude: 12.4964 },
];

const FORECAST_CACHE = new Map<string, { value: WeatherForecast; expiresAt: number }>();
const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}($|[^a-z])`, 'i').test(text);
}

function parseAmount(text: string): { value: number; unit: ParsedWeatherQuestion['unit']; index: number } | null {
  let best: { value: number; unit: ParsedWeatherQuestion['unit']; index: number } | null = null;
  const pattern = /(\d+(?:\.\d+)?)\s*(°c|°f|mm|millimeters?|cm|centimeters?|inches?|in\b|mph|km\/h)/gi;
  for (const match of text.matchAll(pattern)) {
    const candidate = {
      value: Number(match[1]),
      unit: normalizeUnit(match[2]),
      index: match.index ?? 0,
    };
    const candidateIsTemp = candidate.unit === '°C' || candidate.unit === '°F';
    const bestIsTemp = best && (best.unit === '°C' || best.unit === '°F');
    if (!best || (candidateIsTemp && !bestIsTemp)) best = candidate;
  }
  return best;
}

function normalizeUnit(raw: string): ParsedWeatherQuestion['unit'] {
  const value = raw.toLowerCase();
  if (value.startsWith('°c')) return '°C';
  if (value.startsWith('°f')) return '°F';
  if (value.startsWith('mm') || value.startsWith('milli')) return 'mm';
  if (value.startsWith('cm') || value.startsWith('centi')) return 'cm';
  if (value.startsWith('in')) return 'in';
  if (value === 'mph') return 'mph';
  return 'km/h';
}

export function parseWeatherQuestion(title: string): ParsedWeatherQuestion | null {
  // These questions resolve from global datasets, policy, or model benchmarks,
  // not from a seven-day point forecast.
  if (/global|average|average[d]?|control|nws|ai model|accuracy|hurricane season|landfall|manipulate/i.test(title)) return null;

  const lower = title.toLowerCase();
  const location = LOCATIONS.find(item => item.aliases.some(alias => containsPhrase(lower, alias.toLowerCase())));
  if (!location) return null;

  const amount = parseAmount(lower);
  if (!amount || !Number.isFinite(amount.value)) return null;

  const context = lower.slice(Math.max(0, amount.index - 90), Math.min(lower.length, amount.index + 25));
  const comparison: ParsedWeatherQuestion['comparison'] = /(below|under|less than|no more than|at most|or lower|or below)/.test(context)
    ? 'lte'
    : 'gte';
  const isoDate = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)?.[0];
  const base = {
    location: location.aliases[0],
    latitude: location.latitude,
    longitude: location.longitude,
    comparison,
    date: isoDate || (/\btomorrow\b/.test(lower) ? futureIso(1) : /\btoday\b/.test(lower) ? futureIso(0) : undefined),
  };

  if ((amount.unit === '°C' || amount.unit === '°F') && !/ocean water|water temperature/.test(lower)) {
    const valueC = amount.unit === '°F' ? (amount.value - 32) * 5 / 9 : amount.value;
    const isLow = /(low temperature|nighttime low|daily low|lowest temperature)/.test(lower);
    return {
      ...base,
      metric: isLow ? 'temperature_min' : 'temperature_max',
      displayValue: amount.value,
      unit: amount.unit,
      valueC,
    };
  }

  if (/(snowfall|snow)\b/.test(context)) {
    const valueMm = amount.unit === 'cm' ? amount.value * 10 : amount.unit === 'in' ? amount.value * 25.4 : amount.value;
    return { ...base, metric: 'snowfall', displayValue: amount.value, unit: amount.unit, valueMm };
  }

  if (/(rainfall|precipitation|rain)\b/.test(context)) {
    const valueMm = amount.unit === 'in' ? amount.value * 25.4 : amount.value;
    return { ...base, metric: 'precipitation', displayValue: amount.value, unit: amount.unit as 'mm' | 'in', valueMm };
  }

  if (/(wind gusts?|gusts?)\b/.test(context)) {
    const valueKmh = amount.unit === 'mph' ? amount.value * 1.60934 : amount.value;
    return { ...base, metric: 'wind_gust', displayValue: amount.value, unit: amount.unit as 'mph' | 'km/h', valueKmh };
  }

  return null;
}

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-z * z);
  return sign * y;
}

function normalCdf(x: number, mean = 0, sigma = 1): number {
  return 0.5 * (1 + erf((x - mean) / (sigma * Math.SQRT2)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function referenceWeatherProbability(
  question: Pick<ParsedWeatherQuestion, 'metric' | 'comparison'> & { valueC?: number; valueMm?: number; valueKmh?: number },
  forecast: WeatherForecast,
  dayIndex: number,
): number {
  const sigma = 2 + Math.min(2, dayIndex) * 0.25;
  const at = Math.max(0, Math.min(forecast.dates.length - 1, dayIndex));

  if (question.metric === 'temperature_max' && question.valueC != null) {
    const value = forecast.temperatureMaxC?.[at];
    if (value == null) return 0.5;
    const p = question.comparison === 'gte' ? 1 - normalCdf(question.valueC, value, sigma) : normalCdf(question.valueC, value, sigma);
    return clamp(p, 0.01, 0.99);
  }

  if (question.metric === 'temperature_min' && question.valueC != null) {
    const values = forecast.temperatureMinC?.slice(0, at + 1) ?? [];
    const value = values.length ? Math.min(...values) : forecast.temperatureMinC?.[at];
    if (value == null) return 0.5;
    const p = question.comparison === 'lte' ? normalCdf(question.valueC, value, sigma) : 1 - normalCdf(question.valueC, value, sigma);
    return clamp(p, 0.01, 0.99);
  }

  if (question.metric === 'precipitation' && question.valueMm != null) {
    const value = forecast.precipitationMm?.[at] ?? 0;
    if (question.comparison === 'lte') return clamp(1 - precipitationChance(value, question.valueMm), 0.02, 0.97);
    return precipitationChance(value, question.valueMm);
  }

  if (question.metric === 'snowfall' && question.valueMm != null) {
    const valueCm = (forecast.snowfallCm?.[at] ?? 0);
    const ratio = valueCm * 10 / question.valueMm;
    const p = question.comparison === 'gte'
      ? 1 / (1 + Math.exp(-(ratio - 1) * 3))
      : 1 / (1 + Math.exp((ratio - 1) * 3));
    if (valueCm < 0.05 && question.comparison === 'gte') return 0.03;
    return clamp(p, 0.02, 0.97);
  }

  if (question.metric === 'wind_gust' && question.valueKmh != null) {
    const value = forecast.windGustKmh?.[at];
    if (value == null) return 0.5;
    const p = question.comparison === 'gte' ? 1 - normalCdf(question.valueKmh, value, 8) : normalCdf(question.valueKmh, value, 8);
    return clamp(p, 0.01, 0.99);
  }

  return 0.5;
}

function precipitationChance(actualMm: number, thresholdMm: number): number {
  if (actualMm < 0.15 && thresholdMm >= 1) return 0.04;
  const ratio = actualMm / thresholdMm;
  return clamp(1 / (1 + Math.exp(-(ratio - 1) * 3)), 0.03, 0.96);
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'MoneyMoney/1.0 (+https://github.com/blueicx/MoneyMoney)' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getForecast(location: ParsedWeatherQuestion): Promise<WeatherForecast> {
  const cacheKey = `${location.latitude},${location.longitude}`;
  const cached = FORECAST_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max',
    timezone: 'auto',
    forecast_days: '7',
  });
  const payload = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const daily = payload?.daily;
  if (!Array.isArray(daily?.time)) throw new Error('bad forecast payload');
  const value: WeatherForecast = {
    dates: daily.time,
    temperatureMaxC: daily.temperature_2m_max,
    temperatureMinC: daily.temperature_2m_min,
    precipitationMm: daily.precipitation_sum,
    snowfallCm: daily.snowfall_sum,
    windGustKmh: daily.wind_gusts_10m_max,
  };
  FORECAST_CACHE.set(cacheKey, { value, expiresAt: Date.now() + FORECAST_TTL_MS });
  return value;
}

function selectDay(question: ParsedWeatherQuestion, forecast: WeatherForecast): number {
  if (question.date) return forecast.dates.indexOf(question.date);
  return 0;
}

function formatValue(metric: WeatherMetric, value: number | undefined, question: ParsedWeatherQuestion): string {
  if (value == null) return '暂无数据';
  if (metric === 'temperature_max' || metric === 'temperature_min') {
    const shown = question.unit === '°F' ? value * 9 / 5 + 32 : value;
    return `预报峰值 ${shown.toFixed(1)}${question.unit}`;
  }
  if (metric === 'precipitation') {
    const shown = question.unit === 'in' ? value / 25.4 : value;
    return `预报雨量 ${shown.toFixed(2)}${question.unit}`;
  }
  if (metric === 'snowfall') {
    const shown = question.unit === 'in' ? value / 25.4 : value / 10;
    return `预报雪量 ${shown.toFixed(2)}${question.unit}`;
  }
  const shown = question.unit === 'mph' ? value / 1.60934 : value;
  return `预报阵风 ${shown.toFixed(1)}${question.unit}`;
}

function buildEvidence(
  market: PredictionMarket,
  question: ParsedWeatherQuestion,
  forecast: WeatherForecast,
): WeatherForecastEvidence | null {
  // Without a dated question, only use a forecast when the market resolves
  // inside the seven-day window; do not project a summer-long question from one day.
  if (!question.date) {
    const end = market.endDate ? new Date(market.endDate).getTime() : NaN;
    if (!Number.isFinite(end) || end > Date.now() + 7 * 86_400_000) return null;
  }
  const dayIndex = selectDay(question, forecast);
  if (dayIndex < 0) return null;

  const probability = referenceWeatherProbability(question, forecast, dayIndex);
  const yesPct = market.yesPrice * 100;
  const refPct = probability * 100;
  const gap = refPct - yesPct;
  const stance = gap >= 12 ? '更支持 YES，但仅作研究线索'
    : gap <= -12 ? '更支持 NO，但仅作研究线索'
      : '与当前市场价格接近，作为背景参考';

  const metricZh = {
    temperature_max: '最高气温',
    temperature_min: '最低气温',
    precipitation: '降雨量',
    snowfall: '降雪量',
    wind_gust: '阵风',
  }[question.metric];
  const operator = question.comparison === 'gte' ? '≥' : '≤';
  const confidence = clamp(88 - dayIndex * 6 - (question.date ? 0 : 8), 35, 88);

  return {
    provider: 'Open-Meteo',
    location: question.location,
    metricZh,
    targetZh: `${operator}${question.displayValue}${question.unit}${question.date ? ` @ ${question.date}` : ''}`,
    forecastZh: formatValue(question.metric, pickForecastValue(question, forecast, dayIndex), question),
    referenceProbability: Number(probability.toFixed(3)),
    confidence: Math.round(confidence),
    judgmentZh: `${stance}：系统参考 ${refPct.toFixed(0)}%，市场价 ${yesPct.toFixed(0)}%。`,
    sourceUrl: 'https://open-meteo.com/',
  };
}

function pickForecastValue(question: ParsedWeatherQuestion, forecast: WeatherForecast, dayIndex: number): number | undefined {
  switch (question.metric) {
    case 'temperature_max': return forecast.temperatureMaxC?.[dayIndex];
    case 'temperature_min': return forecast.temperatureMinC?.[dayIndex];
    case 'precipitation': return forecast.precipitationMm?.[dayIndex];
    case 'snowfall': return forecast.snowfallCm?.[dayIndex];
    case 'wind_gust': return forecast.windGustKmh?.[dayIndex];
  }
}

export async function attachWeatherForecastEvidence(markets: PredictionMarket[], limit = 25): Promise<void> {
  const candidates = markets
    .map(market => ({ market, question: parseWeatherQuestion(`${market.title} ${market.category}`) }))
    .filter(row => row.question != null)
    .sort((left, right) => right.market.activityScore - left.market.activityScore)
    .slice(0, limit);

  await Promise.allSettled(candidates.map(async ({ market, question }) => {
    const questionValue = question!;
    const forecast = await getForecast(questionValue);
    const evidence = buildEvidence(market, questionValue, forecast);
    if (evidence) market.weatherForecast = evidence;
  }));
}
