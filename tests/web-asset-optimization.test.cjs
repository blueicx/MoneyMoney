const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { optimizeWebAsset } = require('../scripts/optimize-web-assets.cjs');

test('independently optimized classic scripts preserve global state, handlers, and dynamic function lookup', () => {
  const one = `// source comment\nlet currentSymbol = 'AAPL'; function chooseSymbol(symbol) { currentSymbol = symbol; return currentSymbol; } window.handler = chooseSymbol;`;
  const two = `function currentQuote() { return currentSymbol; } window.lookup = name => window[name]();`;
  const context = vm.createContext({}); context.window = context;
  vm.runInContext(optimizeWebAsset(one, 'js'), context);
  vm.runInContext(optimizeWebAsset(two, 'js'), context);
  assert.equal(context.handler('SNDK'), 'SNDK');
  assert.equal(context.lookup('currentQuote'), 'SNDK');
  assert.ok(optimizeWebAsset(one, 'js').length < one.length);
});

test('CSS optimization preserves three-theme custom property overrides', () => {
  const css = ':root { --accent: purple; } [data-theme="money"] { --accent: gold; } .row { color: var(--accent); }';
  const output = optimizeWebAsset(css, 'css');
  const dom = new JSDOM(`<style>${output}</style><div class="row"></div>`);
  assert.equal(dom.window.getComputedStyle(dom.window.document.documentElement).getPropertyValue('--accent').trim(), 'purple');
  dom.window.document.documentElement.dataset.theme = 'money';
  assert.equal(dom.window.getComputedStyle(dom.window.document.documentElement).getPropertyValue('--accent').trim(), 'gold');
  dom.window.close();
});
