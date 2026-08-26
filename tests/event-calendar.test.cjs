const assert = require('node:assert/strict');
const { buildUpcomingEvents } = require('../dist/features/event-calendar');

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
      actual: null,
    }],
  },
  earnings: [{
    source: 'Nasdaq Public Calendar',
    fetchedAt: '2026-09-14T00:00:00Z',
    date: '2026-09-16',
    count: 1,
    items: [{
      symbol: 'AAPL', name: 'Apple Inc.', marketCapUsd: 3_000_000_000_000,
      marketCapLabel: '$3T', fiscalQuarter: 'Q4', epsForecast: '1.55',
      estimates: '30', lastYearEps: '1.46', lastYearReportDate: '',
      timing: 'after', timingLabel: '盘后',
    }],
  }],
});

assert.equal(result.count, 3);
assert.equal(result.events[0].category, 'macro');
assert.equal(result.events[0].countryLabel, '美国');
assert.ok(result.warnings.includes('宏观日历使用近期缓存'));
assert.deepEqual(result.events.map(event => event.category), ['macro', 'central-bank', 'earnings']);
assert.equal(result.events[2].impact, 'high');
assert.match(result.events[2].detail, /盘后/);

console.log('upcoming event calendar helpers: all assertions passed');
