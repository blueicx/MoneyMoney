const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEventEntities, clusterEventEntities, selectResearchEvent } = require('../dist/features/event-intelligence');

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

test('event entities keep occurrence, schedule, publication and display timestamps semantically separate', () => {
  const entities = buildEventEntities([
    { kind: 'news', at: '2026-09-20T10:00:00.000Z', occurredAt: null, publishedAt: '2026-09-20T09:00:00.000Z', retrievedAt: '2026-09-20T10:05:00.000Z', asOf: '2026-09-20T10:05:00.000Z', title: 'Apple update', source: 'BBC', url: 'https://bbc.example/apple' },
    { kind: 'event', at: '2026-09-21T10:00:00.000Z', scheduledAt: '2026-09-21T10:00:00.000Z', occurredAt: null, title: 'Apple event', source: 'SEC', url: 'https://sec.example/apple' },
    { kind: 'event', at: '2026-09-19T10:00:00.000Z', occurredAt: '2026-09-19T10:00:00.000Z', publishedAt: '2026-09-19T10:01:00.000Z', title: 'Apple filing', source: 'SEC' },
  ], { market: 'stocks', instrument: 'stock:us:AAPL' });
  assert.equal(entities[0].occurredAt, null, 'a row display timestamp must not be promoted to occurrence evidence');
  assert.equal(entities[0].timelineAt, '2026-09-20T09:00:00.000Z');
  assert.equal(entities[0].publishedAt, '2026-09-20T09:00:00.000Z');
  assert.equal(entities[0].retrievedAt, '2026-09-20T10:05:00.000Z');
  assert.equal(entities[0].asOf, '2026-09-20T10:05:00.000Z');
  assert.equal(entities[1].occurredAt, null);
  assert.equal(entities[1].scheduledAt, '2026-09-21T10:00:00.000Z');
  assert.equal(entities[1].timelineAt, '2026-09-21T10:00:00.000Z');
  assert.equal(entities[2].occurredAt, '2026-09-19T10:00:00.000Z');
});

test('research selection requires a known publication time no later than asOf', () => {
  const entities = buildEventEntities([
    { kind: 'news', at: '2026-09-20T18:00:00.000Z', publishedAt: '2026-09-20T18:00:00.000Z', title: 'AAPL earnings', source: 'Official', url: 'https://example.com/aapl' },
    { kind: 'event', at: '2026-09-20T18:00:00.000Z', title: 'AAPL future calendar' },
  ], { market: 'stocks', instrument: 'stock:us:AAPL' });
  assert.throws(() => selectResearchEvent(entities, entities[0].id, '2026-09-20T17:00:00.000Z'), /published|asOf/i);
  assert.throws(() => selectResearchEvent(entities, entities[1].id, '2026-09-21T00:00:00.000Z'), /publication/i);
  const selected = selectResearchEvent(entities, entities[0].id, '2026-09-21T00:00:00.000Z');
  assert.equal(selected.source.url, 'https://example.com/aapl');
  assert.equal(selected.publishedAt, '2026-09-20T18:00:00.000Z');
  const upcoming = buildEventEntities([{ kind: 'event', at: '2026-09-26T18:00:00.000Z', scheduledAt: '2026-09-26T18:00:00.000Z', occurredAt: null, publishedAt: '2026-09-20T18:00:00.000Z', title: 'AAPL scheduled earnings' }], { market: 'stocks', instrument: 'stock:us:AAPL' });
  assert.equal(upcoming[0].occurredAt, null);
  assert.throws(() => selectResearchEvent(upcoming, upcoming[0].id, '2026-09-25T00:00:00.000Z'), /future|scheduled|occurred|asOf/i);
  assert.throws(() => selectResearchEvent(upcoming, upcoming[0].id, '2026-09-27T00:00:00.000Z'), /occurrence|occurred|verified/i);
});

test('news may be studied from its verified publication time without inventing an occurrence time', () => {
  const entities = buildEventEntities([{ kind: 'news', at: '2026-09-20T10:00:00.000Z', occurredAt: null, publishedAt: '2026-09-20T09:00:00.000Z', title: 'AAPL news' }], { market: 'stocks', instrument: 'stock:us:AAPL' });
  const selected = selectResearchEvent(entities, entities[0].id, '2026-09-20T12:00:00.000Z');
  assert.equal(selected.occurredAt, null);
  assert.equal(selected.timelineAt, '2026-09-20T09:00:00.000Z');
  assert.equal(clusterEventEntities(entities)[0].firstAt, '2026-09-20T09:00:00.000Z');
});
