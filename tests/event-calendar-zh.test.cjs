const assert = require('node:assert/strict');
const {
  buildUpcomingEvents,
  translateMacroTitle,
  translateCompanyName,
} = require('../dist/features/event-calendar');

const result = buildUpcomingEvents({
  days: 7,
  referenceDate: new Date('2026-09-14T00:00:00Z'),
  macro: {
    source: 'ForexFactory Public JSON',
    fetchedAt: '2026-09-14T00:00:00Z',
    count: 2,
    events: [
      {
        title: 'CPI y/y',
        country: 'USD',
        date: '2026-09-15T12:30:00Z',
        impact: 'High',
        impactLabel: '高影响',
      },
      {
        title: 'Unemployment Claims',
        country: 'CHF',
        date: '2026-09-16T12:30:00Z',
        impact: 'Medium',
        impactLabel: '中影响',
      },
    ],
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

const macro = result.events[0];
const earnings = result.events[3];

assert.equal(translateMacroTitle('Core PCE Price Index y/y'), '核心个人消费支出(PCE)物价指数 年率');
assert.match(translateMacroTitle('Fed Chairman Powell Speaks'), /美联储主席/);
assert.equal(macro.titleZh, '消费者物价指数(CPI) 年率');
assert.equal(earnings.titleZh, undefined);
assert.equal(earnings.title, 'AAPL 财报');
assert.equal(translateCompanyName('Apple Inc.'), '苹果');
assert.match(earnings.detailZh, /^苹果 · 盘后 · Q4$/);
assert.equal(earnings.detailNote, 'Apple Inc.');
assert.equal(result.events[2].countryLabel, '瑞士');

console.log('event calendar localization: all assertions passed');
