const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeStockDisclosureTimeline } = require('../dist/features/stock-disclosure-timeline');

const now = '2026-10-01T00:00:00.000Z';

test('Form 4 timeline events are positioned at public filing time and keep transaction date as detail', () => {
  const result = mergeStockDisclosureTimeline({
    market: 'stocks', instrument: 'stock:us:MU', retrievedAt: now, baseItems: [],
    form4: [{ filedAt: '2026-09-28', transactionDate: '2026-09-24', ownerName: 'Jane Doe', ownerTitleZh: '高管·CFO', action: 'BUY', shares: 1200, priceUsd: 118.25, sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/0001/form4.xml' }],
    form4Status: 'ok', form4Reason: null, form13f: [], form13fStatus: 'ok', form13fReason: null,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].at, '2026-09-28T00:00:00.000Z');
  assert.equal(result.items[0].publishedAt, result.items[0].at);
  assert.match(result.items[0].title, /交易日 2026-09-24/);
  assert.equal(result.items[0].source, 'SEC EDGAR Form 4');
  assert.equal(result.items[0].url, 'https://www.sec.gov/Archives/edgar/data/1/0001/form4.xml');
  assert.equal(result.sourceStatus.secForm4, 'ok');
});

test('13F changes remain per-manager disclosures and never imply that non-disclosure means liquidation', () => {
  const result = mergeStockDisclosureTimeline({
    market: 'stocks', instrument: 'stock:us:AAPL', retrievedAt: now, baseItems: [], form4: [], form4Status: 'ok', form4Reason: null,
    form13f: [
      { mapped: true, managerName: 'Fund A', reportPeriod: '2026-06-30', filedAt: '2026-08-14', previousReportPeriod: '2026-03-31', previousShares: 100, shares: 140, shareDelta: 40, change: 'increased', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/2/0002/info.htm' },
      { mapped: true, managerName: 'Fund B', reportPeriod: '2026-06-30', filedAt: '2026-08-14', previousReportPeriod: '2026-03-31', previousShares: 20, shares: null, shareDelta: null, change: 'not-disclosed', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/3/0003/info.htm' },
    ], form13fStatus: 'cached', form13fReason: '季度披露，数据有延迟',
  });
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every(item => item.at === '2026-08-14T00:00:00.000Z'));
  assert.match(result.items.find(item => item.title.includes('Fund A')).title, /增持 \+40 股/);
  assert.match(result.items.find(item => item.title.includes('Fund B')).title, /本期未披露/);
  assert.doesNotMatch(result.items.find(item => item.title.includes('Fund B')).title, /已清仓/);
  assert.equal(result.sourceStatus.sec13f, 'stale');
});

test('timeline merge rejects cross-market, future, unsafe-source and unmapped/unchanged disclosure rows but preserves base events', () => {
  const result = mergeStockDisclosureTimeline({
    market: 'stocks', instrument: 'stock:us:SPY', retrievedAt: now,
    baseItems: [{ kind: 'news', at: '2026-09-30', title: 'Base news', source: 'Publisher', url: 'https://example.com/a', scope: 'stocks', instrumentId: 'stock:us:SPY' }, { kind: 'news', at: now, title: 'Wrong instrument', scope: 'stocks', instrumentId: 'stock:us:AAPL' }],
    form4: [
      { filedAt: '2026-10-02', transactionDate: '2026-09-29', ownerName: 'Future', action: 'BUY', shares: 1, priceUsd: 10, sourceUrl: 'https://www.sec.gov/Archives/future.xml' },
      { filedAt: '2026-09-30', transactionDate: '2026-09-29', ownerName: 'Bad URL', action: 'BUY', shares: 1, priceUsd: 10, sourceUrl: 'javascript:alert(1)' },
    ], form4Status: 'unavailable', form4Reason: 'SEC 请求失败',
    form13f: [{ mapped: false, managerName: 'Unchanged', reportPeriod: '2026-06-30', filedAt: '2026-08-14', change: 'unchanged', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/4/0004/info.htm' }],
    form13fStatus: 'ok', form13fReason: null,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Base news');
  assert.equal(result.items[0].instrumentId, 'stock:us:SPY');
  assert.equal(result.sourceStatus.secForm4, 'unavailable');
  assert.equal(result.sectionReasons.secForm4, 'SEC 请求失败');
  assert.throws(() => mergeStockDisclosureTimeline({ market: 'crypto', instrument: 'crypto:binance:BTCUSDT', retrievedAt: now, baseItems: [], form4: [], form4Status: 'ok', form13f: [], form13fStatus: 'empty' }), /only be merged/);
});

test('partial Form 4 failures keep their provider reason visible even when no filing row parsed', () => {
  const result = mergeStockDisclosureTimeline({ market: 'stocks', instrument: 'stock:us:MU', retrievedAt: now, baseItems: [], form4: [], form4Status: 'partial', form4Reason: 'SEC Form 4 原文 2/5 下载失败', form13f: [], form13fStatus: 'empty' });
  assert.equal(result.sourceStatus.secForm4, 'partial');
  assert.equal(result.sectionReasons.secForm4, 'SEC Form 4 原文 2/5 下载失败');
});
