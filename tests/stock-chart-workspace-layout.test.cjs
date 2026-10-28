const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = require('./helpers/dashboard-source.cjs').readDashboardSource();

test('stock chart workspace B puts events, chart, and evidence into one themed responsive layout', () => {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const layout = document.querySelector('#stock-chart-workspace-b');
  assert.ok(layout, 'B layout wrapper should exist');
  assert.deepEqual(
    [...layout.querySelectorAll('[data-stock-chart-region]')].map(node => node.dataset.stockChartRegion),
    ['events', 'chart', 'evidence'],
  );
  assert.ok(layout.querySelector('#stock-chart-event-rail'));
  assert.ok(layout.querySelector('#stock-chart-evidence-detail'));
  assert.ok(layout.querySelector('#stock-chart-signals'));
  assert.ok(layout.querySelector('#stock-chart-signal-markers'), 'stock strategy points need direct, accessible chart hit targets');
  assert.ok(document.querySelector('#bn-chart-signal-markers'), 'crypto chart points need the same direct interaction surface');
  assert.ok(document.querySelector('#bn-chart-signal-detail'), 'crypto signal selection should reveal timestamp, price, OHLC, source and reason');
  const css = fs.readFileSync('src/web/public/modules/dashboard-base.css', 'utf8');
  assert.match(css, /#stock-chart-workspace-b\s*\{[^}]*grid-template-columns:\s*minmax\(170px,[^;]+\)\s+minmax\(420px,[^)]+\)\s+minmax\(250px,[^;]+\)/);
  assert.match(css, /#stock-chart-card\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(css, /@container\s+stock-chart-card\s*\(max-width:\s*\d+px\)[\s\S]*?#stock-chart-workspace-b[\s\S]*?grid-template-columns/);
  assert.match(css, /@container\s+stock-chart-card\s*\(max-width:\s*680px\)[\s\S]*?#stock-chart-workspace-b\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(css, /@media\s*\(max-width:\s*(?:900|768)px\)[\s\S]*?#stock-chart-workspace-b[\s\S]*?grid-template-columns/);
  const enhancementCss = fs.readFileSync('src/web/public/experience-enhancements.css', 'utf8');
  assert.match(enhancementCss, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.layout:not\(\.sidebar-collapsed\):not\(\.instrument-library-hidden\)\s*\{\s*display:\s*block/);
  assert.match(enhancementCss, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.market-workspace-shell\s*\{\s*grid-template-columns:\s*var\(--mm-left-width,224px\)\s+minmax\(0,1fr\)/);
  assert.match(enhancementCss, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.layout > #right-instrument-library\s*\{\s*display:\s*none/);
  assert.match(enhancementCss, /@media\s*\(max-width:\s*1100px\)[\s\S]*?body\.mm-library-drawer-open #right-instrument-library\s*\{[^}]*position:\s*fixed/);
  assert.match(enhancementCss, /@media\s*\(max-width:\s*1100px\)[\s\S]*?#mm-mobile-library-toggle\s*\{\s*display:\s*inline-flex/);
  assert.match(css, /#stock-chart-workspace-b[\s\S]*?var\(--bg-card\)/);
  assert.match(css, /#stock-chart-workspace-b[\s\S]*?var\(--border\)/);
  assert.match(css, /\.chart-signal-hit-layer\s*\{[^}]*pointer-events:none/);
  assert.match(css, /\.chart-signal-hit-target\s*\{[^}]*pointer-events:auto/);
  assert.match(css, /chart-signal-cluster-choices/);
  assert.match(css, /--bg-card/);
  dom.window.close();
});

test('chart event rail renderer escapes content and filters events after a historical as-of time', () => {
  const start = html.indexOf('function renderStockChartEventRail(');
  assert.ok(start >= 0, 'chart event renderer should exist');
  const end = html.indexOf('\n}', start) + 2;
  const source = html.slice(start, end);
  const dom = new JSDOM('<div id="stock-chart-event-status"></div><div id="stock-chart-event-rail"></div><div id="stock-chart-event-markers"></div><div id="stock-chart-evidence-status"></div><div id="stock-chart-evidence-detail"></div>', { runScripts: 'outside-only' });
  const window = dom.window;
  window.stockEscapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  window.formatChartTime = value => String(value);
  window.formatChartPrice = value => Number(value).toFixed(2);
  window.eval(`var stockChartAsOf='2026-10-05T23:59:59.999Z'; var stockChartExchangeTimezone='UTC'; var stockChartKlines=[{time:Date.parse('2026-10-04T00:00:00Z')}]; var focusedStockDate=''; function focusStockKlineDate(value){focusedStockDate=value;return value;}`);
  window.eval(source);
  for (const name of ['showStockChartEvidence', 'focusStockChartTimestamp']) {
    const functionStart = html.indexOf(`function ${name}(`);
    const functionEnd = html.indexOf('\n}', functionStart) + 2;
    window.eval(html.slice(functionStart, functionEnd));
  }
  window.renderStockChartEventRail({
    dataStatus: 'historical',
    data: [
      { id: 'past', title: '<script>bad</script>', occurredAt: '2026-10-04T12:00:00.000Z', publishedAt: '2026-10-04T13:00:00.000Z', source: { name: 'SEC', url: 'https://sec.gov/filing' } },
      { id: 'future', title: '未来事件', occurredAt: '2026-10-06T12:00:00.000Z', publishedAt: '2026-10-06T13:00:00.000Z', source: { name: 'SEC' } },
    ],
  });
  const rail = window.document.getElementById('stock-chart-event-rail');
  assert.match(rail.innerHTML, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(rail.innerHTML, /未来事件/);
  assert.match(rail.innerHTML, /data-chart-event-id="past"/);
  assert.match(rail.innerHTML, /https:\/\/sec\.gov\/filing/);
  rail.querySelector('[data-chart-event-index="0"]').click();
  assert.match(window.document.getElementById('stock-chart-evidence-detail').textContent, /SEC/);
  assert.equal(window.focusedStockDate, '2026-10-04', 'selecting a timeline item should focus its corresponding chart date');
  dom.window.close();
});

test('chart event identity remains scoped to the selected stock and preserves real US symbols beginning with US', () => {
  const start = html.indexOf('function stockChartEventInstrumentId(');
  assert.ok(start >= 0, 'stock event identity resolver should exist');
  const end = html.indexOf('\n}', start) + 2;
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  const window = dom.window;
  window.eval(`var currentStockSymbol='usAAPL';`);
  window.eval(html.slice(start, end));
  assert.equal(window.stockChartEventInstrumentId(), 'stock:us:AAPL');
  window.currentStockSymbol = 'sh600519';
  assert.equal(window.stockChartEventInstrumentId(), 'stock:cn:SH600519');
  window.currentStockSymbol = 'USAR';
  assert.equal(window.stockChartEventInstrumentId(), 'stock:us:USAR');
  dom.window.close();
});
