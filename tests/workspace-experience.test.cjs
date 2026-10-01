const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  diffScreenerMembership,
  normalizePeerPrices,
  buildGuruHoldingsMatrix,
} = require('../dist/features/workspace-experience.js');
const publicHtml = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
const publicEnhancements = fs.readFileSync(path.join(__dirname, '../src/web/public/experience-enhancements.js'), 'utf8');
const publicStyles = fs.readFileSync(path.join(__dirname, '../src/web/public/experience-enhancements.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');

test('saved screener membership reports deterministic entries and exits without treating duplicates as changes', () => {
  assert.deepEqual(diffScreenerMembership(['A', 'B', 'B'], ['B', 'C', 'C']), {
    entered: ['C'], exited: ['A'], unchanged: ['B'],
  });
});

test('peer normalization uses only valid same-scope prices and keeps unavailable rows explicit', () => {
  const rows = normalizePeerPrices([
    { id: 'stock:us:A', symbol: 'A', quote: { price: 110 } },
    { id: 'stock:us:B', symbol: 'B', quote: { price: 90 } },
    { id: 'stock:us:C', symbol: 'C', quote: { price: null } },
  ]);
  assert.deepEqual(rows.map(row => row.relativePct), [0, -18.18, null]);
  assert.equal(rows[2].reason, '价格不可用，未参与归一化比较');
});

test('guru holdings matrix keeps institution rows separate and preserves unavailable report mapping', () => {
  const matrix = buildGuruHoldingsMatrix([
    { symbol: 'AAPL', dataStatus: 'delayed', holders: [{ cik: '1', managerName: 'Fund A', change: 'increased', shareDelta: 10, reportPeriod: '2025-12-31', sourceUrl: 'https://sec.gov/a' }] },
    { symbol: 'MU', dataStatus: 'unavailable', reason: 'CUSIP 映射缺失', holders: [] },
  ]);
  assert.deepEqual(matrix.symbols, ['AAPL', 'MU']);
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0].cells.AAPL.change, 'increased');
  assert.equal(matrix.status.MU.reason, 'CUSIP 映射缺失');
  assert.equal(matrix.totalShares, undefined);
});

test('workspace improvements are loaded by the real dashboard and chart bridge uses exchange-local dates', () => {
  assert.match(publicHtml, /<script src="\/experience-enhancements\.js\?v=/);
  assert.match(publicHtml, /<link rel="stylesheet" href="\/experience-enhancements\.css\?v=/);
  assert.match(publicHtml, /window\.MoneyMoneyChartBridge = \{/);
  assert.match(publicHtml, /timeZone: stockChartExchangeTimezone/);
  assert.match(publicEnhancements, /installLayoutControls\(\); installCommandPaletteActions\(\); installMobileLibraryDrawer\(\);/);
  assert.match(publicStyles, /body\.mm-library-drawer-open #right-instrument-library/);
  assert.match(publicHtml, /data-digest-kind="\$\{digestKind\}"/);
});

test('historical price-alert preview is reachable from the alert form', () => {
  assert.match(publicHtml, /data-mm-alert-history-preview/);
  assert.match(publicHtml, /id="mm-alert-history-preview"/);
  assert.match(publicEnhancements, /installAlertHistoryPreview\(\);/);
});

test('enhancement write actions attach the same-origin CSRF token', () => {
  assert.match(publicEnhancements, /function csrfHeaders\(/);
  assert.equal((publicEnhancements.match(/headers: csrfHeaders\(/g) || []).length, 5);
});

test('mobile library control inserts beside the layout wrapper rather than a nested search button', () => {
  assert.match(publicEnhancements, /header\.insertBefore\(button, header\.querySelector\('\.mm-layout-menu-wrap'\) \|\| header\.querySelector\('\.refresh-btn'\)\)/);
});

test('multi-period chart starts hidden so the first toggle opens it', () => {
  assert.match(publicEnhancements, /multi\.id = 'mm-stock-multi-chart'[\s\S]*?multi\.hidden = true;[\s\S]*?multi\.hidden = !multi\.hidden/);
});

test('watchlist observer only reorders rows when the order actually changes', () => {
  assert.match(publicEnhancements, /const existingItems = \[\.\.\.selector\.querySelectorAll\('tr\.workspace-watchlist-row, \.workspace-watchlist-card'\)\][\s\S]*?if \(items\.some\(\(item, index\) => item !== existingItems\[index\]\)\) items\.forEach\(item => selector\.appendChild\(item\)\)/);
});

test('watchlist collapse observer does not rewrite an unchanged toggle label', () => {
  assert.match(publicEnhancements, /const label = collapsed \? '展开' : '折叠';[\s\S]*?if \(button\.textContent !== label\) button\.textContent = label/);
});

test('watchlist decoration ignores nested action buttons and only decorates rows/cards', () => {
  assert.match(publicEnhancements, /group\.querySelectorAll\('tr\.workspace-watchlist-row\[data-watchlist-instrument\], \.workspace-watchlist-card\[data-watchlist-instrument\]'\)/);
});

test('layout enhancement preserves the native right-library collapse action', () => {
  assert.match(publicEnhancements, /if \(typeof window\.toggleRightLibrary !== 'function'\) window\.toggleRightLibrary = \(\) => window\.toggleSidebar\?\.\(\)/);
});

test('screener monitoring retains the last valid baseline on empty/failure and alerts only on real changes', () => {
  assert.match(serverSource, /当前筛选来源返回零条原始记录；为避免误报全部退出，保留上次有效基线/);
  assert.match(serverSource, /筛选来源请求失败；保留上次有效基线/);
  assert.match(serverSource, /result\.record\.lastStatus === 'updated' && \(result\.record\.entered\.length \|\| result\.record\.exited\.length\)/);
  assert.match(serverSource, /筛选监控「\$\{result\.record\.name\}」/);
});
