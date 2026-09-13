const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'src/web/public/index.html'), 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

test('Phase 0: layout contract - left nav, center workspace, right library exist', () => {
  const sidebar = document.querySelector('#market-workspace-sidebar');
  const main = document.querySelector('#center-workspace');
  const library = document.querySelector('#right-instrument-library');

  assert.ok(sidebar, 'Left nav exists');
  assert.ok(main, 'Central workspace exists');
  assert.ok(library, 'Right library exists');
});

test('Phase 0: workspace context overrides old rendering paths', () => {
  // Find indicators of context bindings in script.
  assert.match(html, /activeMarketScope = scope/, 'Updates market scope');
  assert.match(html, /activeWorkspaceId = defaultWorkspaceForMarketScope/, 'Updates workspace id');
  assert.match(html, /currentInstrumentId = null/, 'Resets instrument id');
  assert.match(html, /marketScopeRequestEpoch/, 'Increments epoch for cancellation');
});

test('Phase 0: old intermediate instrument list is not rendered in center', () => {
  // Check that the center workspace doesn't hold the old instrument selections
  const stockLib = document.querySelector('#stock-instrument-library');
  assert.equal(stockLib?.parentElement?.parentElement?.id, 'right-instrument-library', 'Stock library must be in right sidebar');
});

test('news timeline renders safe source evidence links', () => {
  assert.match(html, /function formatSourceEvidence\(item = \{\}\)/, 'Source evidence renderer exists');
  assert.match(html, /payload\.data\.map\(item => formatSourceEvidence\(item\)/, 'Timeline uses source evidence renderer');
  assert.match(html, /target="_blank" rel="noopener noreferrer"/, 'External links use safe target attributes');
  assert.match(html, /https\?:\\\/\\\//, 'Only HTTP(S) source links are eligible');
});

test('screener is an explicit workspace instead of a stock-card fallback', () => {
  assert.match(html, /id="market-research-tools"[^>]*data-workspace-ids="screener"/, 'Screener has its own workspace');
  assert.match(html, /screener: \['⌕', '筛选与比较'\]/, 'Screener is reachable from the left feature area');
  assert.match(html, /if \(activeWorkspaceId === 'screener'\) loadMarketResearch\(\)/, 'Screener only loads when selected');
});

test('screener keeps requested stock identities under concurrent quote fallback', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'src/web/server.ts'), 'utf8');
  assert.match(server, /settled\.flatMap\(\(result, index\) =>/, 'Screener retains request index');
  assert.match(server, /const symbol = SCREENER_STOCK_SYMBOLS\[index\]/, 'Row identity comes from requested symbol');
  assert.match(server, /id: `stock:us:\$\{symbol\}`/, 'Canonical row ID uses requested symbol');
});

test('candlestick annotations are accessible, touch-friendly, and share one pattern dataset', () => {
  assert.match(html, /id="stock-chart-pattern-list"/, 'Pattern explanation list exists');
  assert.match(html, /function renderChartPatternList\(targetId, patterns, emptyText\)/, 'Pattern list renderer exists');
  assert.match(html, /renderChartPatternList\('stock-chart-pattern-list', overlays\.patterns/, 'List uses rendered overlay patterns');
  assert.match(html, /marker\.type = 'button'/, 'Chart markers are non-submitting buttons');
  assert.match(html, /role = 'tooltip'/, 'Tooltip has an accessible role');
  assert.match(html, /aria-describedby/, 'Marker describes its tooltip');
  assert.match(html, /is-open \.chart-pattern-tooltip/, 'Touch/click can keep the explanation open');
  assert.match(html, /overflow:visible/, 'Tooltip is not clipped by the chart layer');
  assert.match(html, /if \(!klines\.length\) \{[\s\S]*renderChartPatternMarkers\('stock-chart-patterns', \[\]/, 'Empty stock data clears stale pattern markers');
  assert.match(html, /const cryptoPatterns = cryptoChartOverlayConfig\.patterns/, 'Crypto patterns use the same analysis dataset');
  assert.match(html, /renderChartPatternMarkers\('bn-chart-patterns', cryptoPatterns/, 'Crypto chart renders selectable pattern markers');
  assert.match(html, /renderChartPatternList\('bn-chart-pattern-list', cryptoPatterns/, 'Crypto chart renders pattern explanations');
});
