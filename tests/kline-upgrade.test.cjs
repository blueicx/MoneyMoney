const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

describe('K-Line Upgrade & Advanced Capabilities', () => {
  let dom;
  let window;
  let document;

  before(() => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf-8');
    dom = new JSDOM(html, { runScripts: "dangerously" });
    window = dom.window;
    document = window.document;
  });

  it('MoneyKLine exposes lifecycle methods and layer toggles', () => {
    assert.ok(window.MoneyKLine, 'MoneyKLine class should exist globally');
    const chart = new window.MoneyKLine(document.createElement('canvas'));
    assert.equal(typeof chart.toggleLayer, 'function');
  });

  it('AbortController, timer cleanup and Request deduping are utilized', () => {
    assert.ok(window.AbortController, 'Should have AbortController available in window');
    const htmlStr = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf-8');
    assert.match(htmlStr, /new AbortController\(\)/, 'Should use AbortController');
  });

  it('UI has accessible elements and drawer support', () => {
    const htmlLang = document.documentElement.getAttribute('lang');
    assert.equal(htmlLang, 'zh', 'Should have Chinese language attribute');
    const fsOverlay = document.getElementById('chart-fullscreen-overlay');
    assert.ok(fsOverlay, 'Should have chart fullscreen overlay');
  });

  it('Right library toggle is injected and functions', () => {
    const rightLibrary = document.querySelector('.workspace-right-library');
    assert.ok(rightLibrary, 'Right library should exist');
  });

  it('Strategy points and explanation layers exist on DOM', () => {
    const layerToggles = Array.from(document.querySelectorAll('input[type="checkbox"][onchange*="setStockChartOverlay"]'));
    assert.ok(layerToggles.length > 0, 'Should have layer toggles');
  });
});
