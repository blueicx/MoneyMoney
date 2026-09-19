const test = require('node:test');
const assert = require('node:assert/strict');

const { parseYahooNewsResponse } = require('../dist/features/stock-news');

test('stock news parser keeps ticker-scoped source evidence and drops malformed items', () => {
  const result = parseYahooNewsResponse({
    news: [
      { uuid: '1', title: 'Apple reports results', publisher: 'Yahoo Finance', link: 'https://finance.yahoo.com/news/apple', providerPublishTime: 1770000000, relatedTickers: ['AAPL'] },
      { uuid: '2', title: 'Other story', publisher: 'Yahoo Finance', link: '', providerPublishTime: 1770000000, relatedTickers: ['MSFT'] },
      { uuid: '3', title: '', publisher: 'Yahoo Finance', link: 'https://example.invalid', providerPublishTime: 1770000000, relatedTickers: ['AAPL'] },
    ],
  }, 'AAPL');
  assert.deepEqual(result, [{
    title: 'Apple reports results',
    source: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/news/apple',
    publishedAt: '2026-02-02T02:40:00.000Z',
  }]);
});
