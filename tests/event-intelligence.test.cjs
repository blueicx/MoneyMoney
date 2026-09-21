const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEventEntities, clusterEventEntities } = require('../dist/features/event-intelligence');

test('event intelligence normalizes timeline rows and keeps provenance', () => {
  const entities = buildEventEntities([
    { kind: 'news', at: '2026-09-20T10:00:00.000Z', title: 'Apple launches new product', source: 'BBC', url: 'https://bbc.example/apple' },
    { kind: 'event', at: '2026-09-20T12:00:00.000Z', title: 'Apple launches new product', source: 'SEC', url: 'https://sec.example/apple' },
  ], { market: 'stocks', instrument: 'stock:us:AAPL' });
  assert.equal(entities.length, 2);
  assert.equal(entities[0].market, 'stocks');
  assert.equal(entities[0].instrument, 'stock:us:AAPL');
  assert.equal(entities[0].source.url, 'https://bbc.example/apple');
  assert.ok(entities[0].normalizedTitle);
});
test('event clusters deduplicate same-market evidence without mixing instruments', () => {
  const rows = buildEventEntities([
    { kind: 'news', at: '2026-09-20T10:00:00.000Z', title: 'Apple launches new product', source: 'BBC', url: 'https://bbc.example/apple' },
    { kind: 'news', at: '2026-09-20T12:00:00.000Z', title: 'Apple launches new product', source: 'Reuters', url: 'https://reuters.example/apple' },
  ], { market: 'stocks', instrument: 'stock:us:AAPL' });
  const otherMarket = buildEventEntities([
    { kind: 'news', at: '2026-09-20T10:00:00.000Z', title: 'Apple launches new product', source: 'CryptoFeed', url: 'https://crypto.example/apple' },
  ], { market: 'crypto', instrument: 'crypto:binance:AAPLUSDT' });
  const clusters = clusterEventEntities([...rows, ...otherMarket]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters.find(item => item.market === 'stocks').evidenceCount, 2);
  assert.equal(clusters.find(item => item.market === 'crypto').evidenceCount, 1);
});

test('event intelligence rejects missing or cross-market identity', () => {
  assert.throws(() => buildEventEntities([{ title: 'bad' }], { market: 'stocks', instrument: 'crypto:binance:BTCUSDT' }), /market|instrument/i);
});
