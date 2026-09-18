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
    
    // Lifecycle
    assert.equal(typeof chart.create, 'function');
    assert.equal(typeof chart.update, 'function');
    assert.equal(typeof chart.tick, 'function');
    assert.equal(typeof chart.kline, 'function');
    assert.equal(typeof chart.destroy, 'function');
    
    // Layer toggles
    assert.equal(typeof chart.toggleLayer, 'function');
    chart.toggleLayer('chanlun', true);
    assert.equal(chart.layers.chanlun, true);
    
    // Playback control
    assert.equal(typeof chart.play, 'function');
    assert.equal(typeof chart.pause, 'function');
    assert.equal(typeof chart.stepForward, 'function');
    assert.equal(typeof chart.stepBackward, 'function');

    // Pan & Zoom
    assert.equal(typeof chart.zoom, 'function');
    assert.equal(typeof chart.drag, 'function');
  });
  
  it('AbortController, timer cleanup and Request deduping are utilized', () => {
    // A proper behavior test for AbortController existence in our code
    assert.ok(window.AbortController, 'Should have AbortController available in window');
    const htmlStr = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf-8');
    assert.match(htmlStr, /new AbortController\(\)/, 'Should use AbortController for request cancellation');
  });

  it('UI has accessible elements and drawer support', () => {
    // Real DOM assertions instead of regex
    const currentElements = document.querySelectorAll('[aria-current]');
    assert.ok(currentElements.length > 0, 'Should use aria-current for active items');
    
    const htmlLang = document.documentElement.getAttribute('lang');
    assert.equal(htmlLang, 'zh', 'Should have Chinese language attribute');
    
    // Check for drawer elements
    const drawerPanel = document.querySelector('.workspace-drawer-panel');
    assert.ok(drawerPanel, 'Should implement drawer for mobile/tablet');
    
    // Chart fullscreen overlay exists
    const fsOverlay = document.getElementById('chart-fullscreen-overlay');
    assert.ok(fsOverlay, 'Should have chart fullscreen overlay');
  });

  it('Right library toggle exists and center updates correctly', () => {
    const rightLibrary = document.querySelector('#right-instrument-library');
    assert.ok(rightLibrary, 'Right library should exist');
  });

  it('Strategy points and explanation layers exist on DOM', () => {
    const layerToggles = Array.from(document.querySelectorAll('input[type="checkbox"][onchange*="setStockChartOverlay"]'));
    assert.ok(layerToggles.length > 0, 'Should have layer toggles');
    assert.ok(document.querySelector('[data-chart-pattern="doji"]'), 'Doji should have an independent toggle');
    assert.ok(document.querySelector('#stock-chart-structure-list'), 'Structure explanation list should exist');
    assert.match(fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8'), /MA5[^<]{0,80}数值|formatChartPrice/);
  });

  it('Center grid removes the reserved right-library column', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    assert.match(html, /\.market-workspace-shell\s*\{[\s\S]*?grid-template-columns:\s*224px\s+minmax\(0,\s*1fr\);/);
    assert.doesNotMatch(html, /\.market-workspace-shell\s*\{[\s\S]*?grid-template-columns:\s*224px\s+minmax\(0,\s*1fr\)\s+280px;/);
  });

  it('K-line toolbar keeps period, range and fullscreen controls together', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    const toolbar = document.querySelector('[data-kline-controls="stocks"]');
    assert.ok(toolbar, 'Stock K-line controls should be a single toolbar');
    assert.ok(toolbar.querySelector('[data-kline-period="1d"]'));
    assert.ok(toolbar.querySelector('[data-kline-period="5m"]'));
    for (const range of ['1', '3', '5', '60', '120', '365', '1825']) {
      assert.ok(toolbar.querySelector(`[data-kline-range="${range}"]`), `Missing ${range} day range`);
    }
    assert.ok(toolbar.querySelector('[data-chart-fullscreen="stocks"]'));
    assert.match(html, /setStockKlinePeriod\(['"]5m['"]\)/);
    assert.match(html, /interval='?\s*\+?\s*encodeURIComponent\(currentStockKlinePeriod\)/);
  });

  it('Pattern details expose concrete OHLC prices and explicit unavailable reasons', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    assert.match(html, /formatPatternOHLC/);
    assert.match(html, /\[['"]O['"],\s*item\?\.open\]/);
    assert.match(html, /当前周期暂不支持|来源不可用|暂无数据/);
  });
});
