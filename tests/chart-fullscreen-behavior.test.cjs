const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

describe('Chart fullscreen behavior', () => {
  let dom;
  let document;
  let window;

  before(() => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'http://localhost/',
    });
    window = dom.window;
    document = window.document;
    window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
    const fullscreenScript = [...document.scripts].find(script => script.textContent.includes('chartFullscreenCards'));
    assert.ok(fullscreenScript, 'fullscreen implementation script should be present');
    window.eval(fullscreenScript.textContent);
  });

  it('provides fullscreen actions for stock and crypto charts', () => {
    assert.ok(document.querySelector('[data-chart-fullscreen="stocks"]'));
    assert.ok(document.querySelector('[data-chart-fullscreen="crypto"]'));
    assert.equal(typeof window.toggleChartFullscreen, 'function');
    const overlay = document.getElementById('chart-fullscreen-overlay');
    assert.match(document.querySelector('style').textContent + [...document.querySelectorAll('style')].map(node => node.textContent).join(''), /chart-fullscreen-overlay[\s\S]*position:\s*fixed/);
    assert.match(overlay.className, /chart-fullscreen-overlay/);
  });

  it('opens the selected chart in fullscreen and exits cleanly', () => {
    window.toggleChartFullscreen('stocks');
    assert.equal(document.body.dataset.chartFullscreen, 'stocks');
    assert.ok(document.getElementById('stock-chart-card').classList.contains('chart-card-fullscreen'));
    assert.equal(document.getElementById('stock-chart-card').parentElement.id, 'chart-fullscreen-overlay');
    assert.equal(document.getElementById('crypto-chart-card').classList.contains('chart-card-fullscreen'), false);

    window.toggleChartFullscreen('stocks');
    assert.equal(document.body.dataset.chartFullscreen, undefined);
    assert.equal(document.getElementById('stock-chart-card').classList.contains('chart-card-fullscreen'), false);
    assert.equal(document.getElementById('stock-chart-card').parentElement.classList.contains('collapse-body'), true);
  });

  it('Escape exits fullscreen without changing the selected layer settings', () => {
    window.toggleChartFullscreen('crypto');
    const patterns = document.querySelector('[data-crypto-overlay="patterns"]');
    assert.ok(patterns);
    patterns.checked = true;

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(document.body.dataset.chartFullscreen, undefined);
    assert.equal(patterns.checked, true);
  });
});
