const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { buildUpcomingEvents, classifyCalendarSourceStatus } = require('../src/features/event-calendar');

assert.deepEqual(classifyCalendarSourceStatus({ macroAvailable: false, macroStale: false, earningsSucceeded: 2, earningsRequested: 7 }), {
  macro: 'unavailable', earnings: 'partial',
});
assert.deepEqual(classifyCalendarSourceStatus({ macroAvailable: true, macroStale: true, earningsSucceeded: 0, earningsRequested: 7 }), {
  macro: 'cached', earnings: 'unavailable',
});

const result = buildUpcomingEvents({
  days: 7,
  referenceDate: new Date('2026-09-14T00:00:00Z'),
  macro: {
    source: 'ForexFactory Public JSON',
    fetchedAt: '2026-09-14T00:00:00Z',
    count: 1,
    stale: true,
    events: [{
      title: 'CPI y/y',
      country: 'USD',
      date: '2026-09-15T12:30:00Z',
      impact: 'High',
      impactLabel: '高影响',
      forecast: '3.0%',
      previous: '2.9%',
      actual: '2.8%',
    }],
  },
  earnings: [{
    source: 'Nasdaq Public Calendar',
    fetchedAt: '2026-09-14T00:00:00Z',
    date: '2026-09-16',
    count: 1,
    items: [{
      symbol: 'AAPL', name: 'Apple Inc.', marketCapUsd: 3_000_000_000_000,
      marketCapLabel: '$3T', fiscalQuarter: '2026-06-30', reportPeriodEnd: '2026-06-30', epsForecast: '1.55',
      estimates: '30', lastYearEps: '1.46', lastYearReportDate: '',
      timing: 'after', timingLabel: '盘后',
    }],
  }],
});

assert.equal(result.count, 3);
assert.equal(result.events[0].category, 'macro');
assert.equal(result.events[0].countryLabel, '美国');
assert.equal(result.events[0].actual, '2.8%');
assert.equal(result.events[0].scheduledAt, result.events[0].date, 'macro calendar time is explicitly a schedule');
assert.equal(result.events[1].scheduledAt, result.events[1].date, 'published FOMC date is explicitly a schedule');
assert.equal(result.events[2].scheduledAt, result.events[2].date, 'earnings calendar time is explicitly a schedule');
assert.equal(result.events[0].retrievedAt, '2026-09-14T00:00:00Z', 'macro actuals must retain the calendar fetch timestamp');
assert.ok(result.warnings.includes('宏观日历使用近期缓存'));
assert.deepEqual(result.events.map(event => event.category), ['macro', 'central-bank', 'earnings']);
assert.equal(result.events[2].impact, 'high');
assert.match(result.events[2].detail, /盘后/);
assert.equal(result.events[2].symbol, 'AAPL');
assert.equal(result.events[2].reportPeriodEnd, '2026-06-30');
assert.equal(result.events[2].retrievedAt, '2026-09-14T00:00:00Z', 'earnings events must retain their provider fetch timestamp');

for (const [referenceDate, days, expected] of [
  ['2026-10-26T00:00:00.000Z', 4, ['2026-10-28T18:00:00.000Z']],
  ['2026-12-07T00:00:00.000Z', 4, ['2026-12-09T19:00:00.000Z']],
]) {
  const upcoming = buildUpcomingEvents({ referenceDate: new Date(referenceDate), days, macro: null, earnings: [] });
  assert.deepEqual(upcoming.events.filter(event => event.title === 'FOMC 利率决议').map(event => event.date), expected,
    'FOMC entries must use the final statement day at 2 p.m. America/New_York across DST');
}

const staleCalendar = {
  source: 'ForexFactory + Nasdaq + MoneyMoney schedule', fetchedAt: '2026-10-27T12:00:00.000Z',
  startDate: '2026-10-26', endDate: '2026-11-02', count: 1, warnings: [], stale: true,
  events: [{
    id: 'fomc-2026-10-27', title: 'FOMC 利率决议', category: 'central-bank', categoryLabel: '央行',
    date: '2026-10-27T19:00:00.000Z', scheduledAt: '2026-10-27T19:00:00.000Z', impact: 'high',
    country: 'US', countryLabel: '美国', detail: '旧缓存公告时间', detailZh: '旧缓存公告时间',
    forecast: null, previous: null, actual: null, source: 'MoneyMoney schedule',
  }],
};
const normalizedCache = require('../src/features/event-calendar').normalizeCachedFomcSchedule(staleCalendar);
assert.equal(normalizedCache.events[0].id, 'fomc-2026-10-28');
assert.equal(normalizedCache.events[0].date, '2026-10-28T18:00:00.000Z', 'stale disk cache must not revive the old meeting-start date/time');
assert.equal(normalizedCache.events[0].scheduledAt, normalizedCache.events[0].date);
assert.equal(normalizedCache.stale, true, 'schedule correction must not promote a stale provider cache to fresh');

console.log('upcoming event calendar helpers: all assertions passed');
