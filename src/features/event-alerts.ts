export const EVENT_REMINDER_THRESHOLDS_MINUTES = [1440, 720, 360, 180, 60, 30, 10, 5] as const;

export type EventReminderThreshold = typeof EVENT_REMINDER_THRESHOLDS_MINUTES[number];
export type EventResultComparison = 'above' | 'below' | 'inline' | 'unknown';
export type EventResultDirection = 'bullish' | 'bearish' | 'neutral';

export function getReachedEventReminderThreshold(minutesUntil: number): EventReminderThreshold | null {
  if (!Number.isFinite(minutesUntil) || minutesUntil < 0) return null;
  for (let index = EVENT_REMINDER_THRESHOLDS_MINUTES.length - 1; index >= 0; index -= 1) {
    const threshold = EVENT_REMINDER_THRESHOLDS_MINUTES[index];
    if (minutesUntil <= threshold) return threshold;
  }
  return null;
}

export function decideEventReminder(
  minutesUntil: number,
  previousStage: EventReminderThreshold | null,
  initialized: boolean,
): { stage: EventReminderThreshold | null; shouldSend: boolean } {
  const stage = getReachedEventReminderThreshold(minutesUntil);
  if (!initialized || stage === null) return { stage, shouldSend: false };
  if (previousStage === null) return { stage, shouldSend: true };
  return { stage, shouldSend: stage < previousStage };
}

function parseComparableNumber(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  const match = normalized.match(/([-+]?\d+(?:\.\d+)?)\s*([KMBT])?/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const multiplier = ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as Record<string, number>)[String(match[2] || '').toUpperCase()] || 1;
  return number * multiplier;
}

export function compareEventValues(actual: string | null, forecast: string | null): EventResultComparison {
  const actualNumber = parseComparableNumber(actual);
  const forecastNumber = parseComparableNumber(forecast);
  if (actualNumber === null || forecastNumber === null) return 'unknown';
  const tolerance = Math.max(1e-9, Math.abs(forecastNumber) * 1e-9);
  if (Math.abs(actualNumber - forecastNumber) <= tolerance) return 'inline';
  return actualNumber > forecastNumber ? 'above' : 'below';
}

const HIGHER_IS_BULLISH = [
  /non[- ]farm/i, /payroll/i, /employment/i, /gdp/i, /retail sales/i,
  /industrial production/i, /pmi/i, /consumer confidence/i, /job openings/i,
  /building permits/i, /new home sales/i, /durable goods/i,
];
const HIGHER_IS_BEARISH = [
  /cpi/i, /ppi/i, /pce/i, /inflation/i, /unemployment/i,
  /jobless claims/i, /initial claims/i, /continuing claims/i,
];

export function classifyEventResult(title: string, comparison: EventResultComparison): EventResultDirection {
  if (comparison !== 'above' && comparison !== 'below') return 'neutral';
  const higherDirection = HIGHER_IS_BULLISH.some(pattern => pattern.test(title))
    ? 'bullish'
    : HIGHER_IS_BEARISH.some(pattern => pattern.test(title))
      ? 'bearish'
      : 'neutral';
  if (higherDirection === 'neutral' || comparison === 'above') return higherDirection;
  return higherDirection === 'bullish' ? 'bearish' : 'bullish';
}
