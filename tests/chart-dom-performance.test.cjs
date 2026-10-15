const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function install(window, names) {
  for (const name of names) {
    const node = ast.statements.find(row => ts.isFunctionDeclaration(row) && row.name?.text === name);
    assert.ok(node, name);
    window.eval(source.slice(node.getStart(ast), node.end));
  }
}
function markers() {
  const dom = new JSDOM('<div><canvas id="stock-kline"></canvas><div id="stock-chart-patterns"><button>old</button></div></div>', { runScripts:'outside-only' });
  const w = dom.window, layer = w.document.getElementById('stock-chart-patterns'), order = [];
  for (const key of ['clientWidth', 'clientHeight']) Object.defineProperty(layer, key, { get() { order.push('read'); return key === 'clientWidth' ? 640 : 340; } });
  for (const node of [layer, w.document.getElementById('stock-kline')]) node.getBoundingClientRect = () => { order.push('read'); return { left:0, top:0 }; };
  const descriptor = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML');
  Object.defineProperty(layer, 'innerHTML', { get() { return descriptor.get.call(this); }, set(value) { order.push('write'); descriptor.set.call(this, value); } });
  const replace = layer.replaceChildren.bind(layer);
  layer.replaceChildren = (...args) => { order.push('write'); return replace(...args); };
  w.stockEscapeHtml = value => String(value);
  w.formatStockKlineTime = () => '2026-10-16'; w.formatChartTime = w.formatStockKlineTime;
  w.formatPatternOHLC = () => 'O 10 · H 12 · L 9 · C 11';
  install(w, ['renderChartPatternMarkers']);
  return { dom, w, layer, order };
}
test('empty and unpositionable pattern layers clear stale markers without measuring layout', () => {
  const { dom, w, layer, order } = markers();
  try {
    w.renderChartPatternMarkers(layer.id, [], () => { throw new Error('no points to position'); });
    assert.equal(layer.children.length, 0);
    assert.equal(order.filter(value => value === 'read').length, 0);
    w.renderChartPatternMarkers(layer.id, [{ label:'outside' }], () => null);
    assert.equal(order.filter(value => value === 'read').length, 0);
  } finally { dom.window.close(); }
});
test('pattern geometry is read before mutations and click explanations remain available', () => {
  const { dom, w, layer, order } = markers();
  try {
    w.renderChartPatternMarkers(layer.id, [{ index:1, label:'锤头线', direction:'bullish', time:1, condition:'长下影', meaning:'观察反转' }], () => ({ x:100, y:100 }));
    assert.ok(order.includes('read'));
    assert.ok(order.indexOf('write') > order.lastIndexOf('read'), 'measure existing geometry before clearing DOM');
    const button = layer.querySelector('button'); button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.match(button.textContent, /O 10.*C 11/);
    assert.match(button.textContent, /长下影/);
  } finally { dom.window.close(); }
});
test('unchanged pattern catalog preserves control nodes, focus and updated preferences', () => {
  const dom = new JSDOM('<div id="stock-chart-pattern-controls"></div><div id="crypto-chart-pattern-controls"></div>', { runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  w.catalog = [['hammer','锤头线']]; w.candlePatternCatalog = () => w.catalog;
  w.stockChartOverlayConfig = { patternTypes:{ hammer:false } }; w.cryptoChartOverlayConfig = { patternTypes:{} };
  install(w, ['renderChartPatternControls', 'syncChartPatternControls']);
  try {
    w.renderChartPatternControls();
    const input = w.document.querySelector('[data-chart-pattern-scope="stock"]');
    input.focus(); assert.equal(input.checked, false);
    w.stockChartOverlayConfig.patternTypes.hammer = true;
    w.renderChartPatternControls();
    assert.equal(w.document.querySelector('[data-chart-pattern-scope="stock"]'), input);
    assert.equal(w.document.activeElement, input);
    assert.equal(input.checked, true);
    w.catalog = [['hammer','锤头线'], ['doji','十字星']];
    w.renderChartPatternControls();
    assert.equal(w.document.querySelectorAll('[data-chart-pattern-scope="stock"]').length, 2);
    assert.equal(w.document.querySelectorAll('[data-chart-pattern-scope="crypto"]').length, 2);
  } finally { dom.window.close(); }
});
