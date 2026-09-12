const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'src/web/public/index.html'), 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

test('market terminal has distinct left features, center workspace and right instrument library', () => {
  assert.ok(document.querySelector('#market-workspace-shell'));
  assert.ok(document.querySelector('#market-workspace-sidebar[data-region="market-features"]'));
  assert.ok(document.querySelector('#center-workspace'));
  assert.ok(document.querySelector('#right-instrument-library[data-region="instrument-library"]'));
  assert.equal(document.querySelector('#left-market-features'), null);
});

test('stock chart exposes user-selectable analysis overlays and replay controls', () => {
  assert.ok(document.querySelector('script[src="/chart-analysis.js"]'));
  assert.ok(document.querySelector('#stock-chart-overlays'));
  assert.ok(document.querySelector('[data-chart-overlay="signals"]'));
  assert.ok(document.querySelector('[data-chart-overlay="patterns"]'));
  assert.ok(document.querySelector('[data-chart-overlay="boll"]'));
  assert.ok(document.querySelector('[data-chart-replay="next"]'));
});

test('right library has market-specific entry point instead of generic event fallback', () => {
  const library = document.querySelector('#market-instrument-library');
  assert.ok(library);
  assert.ok(document.querySelector('#stock-instrument-library[data-market-library="stocks"]'));
  assert.ok(library.querySelector('[data-market-library="options"]'));
  assert.ok(library.querySelector('[data-market-library="crypto"]'));
  assert.ok(library.querySelector('[data-market-library="prediction"]'));
});

test('inline dashboard scripts remain syntactically valid after layout changes', () => {
  [...document.querySelectorAll('script:not([src])')].forEach(script => new Function(script.textContent));
});
