const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadDigest() {
  const file = path.join(__dirname, '../dist/features/market-change-digest.js');
  assert.ok(fs.existsSync(file), 'market-change-digest module must be built');
  return require(file);
}

test('shared digest filters exact watchlist identity, stale/private rows and deduplicates records', () => {
  const { buildMarketChangeDigest } = loadDigest();
  const since = '2026-09-29T00:00:00.000Z';
  const records = [
    { id: 'news-aapl', dedupeKey: 'same-news', market: 'stocks', instrument: 'stock:us:AAPL', kind: 'news', title: 'AAPL filing', observedAt: '2026-09-29T03:00:00.000Z', source: 'SEC', sourceUrl: 'https://www.sec.gov/x', evidenceRefs: ['evidence-abc'] },
    { id: 'news-aapl-copy', dedupeKey: 'same-news', market: 'stocks', instrument: 'stock:us:AAPL', kind: 'news', title: 'Duplicate', observedAt: '2026-09-29T03:00:00.000Z', source: 'SEC' },
    { id: 'news-aapl', dedupeKey: 'same-news', market: 'stocks', instrument: 'stock:us:AAPL', kind: 'news', title: 'AAPL filing duplicate', observedAt: '2026-09-29T03:00:00.000Z', source: 'SEC' },
    { id: 'crypto-btc', market: 'crypto', instrument: 'crypto:binance:BTCUSDT', kind: 'signal', title: 'BTC signal', observedAt: '2026-09-29T04:00:00.000Z', source: 'Strategy' },
    { id: 'private', market: 'stocks', instrument: 'stock:us:AAPL', kind: 'signal', title: 'private', observedAt: '2026-09-29T05:00:00.000Z', private: true },
    { id: 'old', market: 'stocks', instrument: 'stock:us:AAPL', kind: 'event', title: 'old', observedAt: '2026-09-28T23:59:59.000Z' },
    { id: 'unwatched', market: 'stocks', instrument: 'stock:us:MSFT', kind: 'news', title: 'MSFT', observedAt: '2026-09-29T05:00:00.000Z' },
    { id: 'stock-outage', market: 'stocks', kind: 'source-outage', title: 'SEC source outage', observedAt: '2026-09-29T06:00:00.000Z', source: 'SEC' },
    { id: 'unscoped-news', market: 'stocks', kind: 'news', title: 'unscoped', observedAt: '2026-09-29T06:00:00.000Z' },
  ];
  const result = buildMarketChangeDigest({ records, watchlist: ['stock:us:AAPL', 'crypto:binance:BTCUSDT'], since });
  assert.deepEqual(result.map(item => item.id), ['stock-outage', 'crypto-btc', 'news-aapl']);
  assert.equal(result[2].sourceUrl, 'https://www.sec.gov/x');
  assert.deepEqual(result[2].evidenceRefs, ['evidence-abc']);
  assert.ok(result.every(item => item.market === 'stocks' || item.market === 'crypto'));
});

test('source fetch failures remain visible only for the exact watched instrument', () => {
  const { buildMarketChangeDigest } = loadDigest();
  const result = buildMarketChangeDigest({ since: '2026-09-29T00:00:00Z', watchlist: ['stock:us:AAPL'], records: [
    { id: 'news-fail-aapl', market: 'stocks', instrument: 'stock:us:AAPL', kind: 'source-failure', title: 'Yahoo news request failed', observedAt: '2026-09-29T03:00:00Z', source: 'Yahoo Finance', summary: 'timeout' },
    { id: 'news-fail-msft', market: 'stocks', instrument: 'stock:us:MSFT', kind: 'source-failure', title: 'MSFT failed', observedAt: '2026-09-29T03:00:00Z' },
    { id: 'news-fail-unscoped', market: 'stocks', kind: 'source-failure', title: 'unscoped failure', observedAt: '2026-09-29T03:00:00Z' },
  ] });
  assert.deepEqual(result.map(item => item.id), ['news-fail-aapl']);
});

test('price digest compares only same-market, same-instrument and same-source evidence', () => {
  const { calculateEvidencePriceChanges } = loadDigest();
  const result = calculateEvidencePriceChanges([
    { id: 'a1', market: 'stocks', instrument: 'stock:us:AAPL', source: 'Yahoo', fetchedAt: '2026-09-28T00:00:00.000Z', price: 100 },
    { id: 'a2', market: 'stocks', instrument: 'stock:us:AAPL', source: 'Yahoo', fetchedAt: '2026-09-29T00:00:00.000Z', price: 103 },
    { id: 'b1', market: 'crypto', instrument: 'crypto:binance:AAPLUSDT', source: 'Binance', fetchedAt: '2026-09-28T00:00:00.000Z', price: 2 },
    { id: 'b2', market: 'crypto', instrument: 'crypto:binance:AAPLUSDT', source: 'Binance', fetchedAt: '2026-09-29T00:00:00.000Z', price: 5 },
    { id: 'a3', market: 'stocks', instrument: 'stock:us:AAPL', source: 'Other', fetchedAt: '2026-09-30T00:00:00.000Z', price: 999 },
  ], { since: '2026-09-28T12:00:00.000Z', watchlist: ['stock:us:AAPL'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].market, 'stocks');
  assert.equal(result[0].instrument, 'stock:us:AAPL');
  assert.equal(result[0].changePct, 3);
  assert.deepEqual(result[0].evidenceRefs, ['a1', 'a2']);
});

test('web and Telegram use one digest aggregator while web acknowledgement remains admin-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
  assert.match(source, /app\.get\(['"]\/api\/changes\/digest['"]/);
  assert.match(source, /app\.post\(['"]\/api\/changes\/digest\/ack['"]/);
  assert.match(source, /buildSharedMarketChangeDigest\(/);
  assert.match(source, /await buildSharedMarketChangeDigest\(ids, since\)/);
  assert.match(source, /adminOnly\(req, res\)/);
});

test('digest UI exposes acknowledgement and safe item links', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
  assert.match(html, /id="market-change-digest"/);
  assert.match(html, /function loadMarketChangeDigest\(/);
  assert.match(html, /function acknowledgeMarketChange\(/);
  assert.match(html, /x-csrf-token/);
});
