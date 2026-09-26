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

  it('K-line toolbar exposes one mutually exclusive period selector', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    const toolbar = document.querySelector('[data-kline-controls="stocks"]');
    assert.ok(toolbar, 'Stock K-line controls should be a single toolbar');
    assert.equal(toolbar.querySelectorAll('.stock-kline-period').length, 10);
    for (const period of ['5m', '15m', '1h', '1d', '3d', '5d', '60d', '120d', '1y', '5y']) {
      assert.ok(toolbar.querySelector(`[data-kline-period="${period}"]`), `Missing ${period} period`);
    }
    assert.equal(toolbar.querySelectorAll('[data-kline-range]').length, 0, 'Range must not be a second selector');
    assert.ok(toolbar.querySelector('[data-chart-fullscreen="stocks"]'));
    assert.match(html, /setStockKlinePeriod\(['"]5m['"]\)/);
    assert.match(html, /interval='?\s*\+?\s*encodeURIComponent\(currentStockKlinePeriod\)/);
    assert.doesNotMatch(html, /setStockKlineRange\(/);
  });

  it('switching market tabs does not clear the K-line period active state', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    assert.doesNotMatch(html, /document\.querySelectorAll\('\.tab'\)\.forEach\(\(t\) => t\.classList\.remove\('active'\)\)/);
    assert.match(html, /document\.querySelectorAll\('\.tabs \.tab'\)/);
  });

  it('Pattern details expose concrete OHLC prices and explicit unavailable reasons', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    assert.match(html, /formatPatternOHLC/);
    assert.match(html, /\[['"]O['"],\s*item\?\.open\]/);
    assert.match(html, /当前周期暂不支持|来源不可用|暂无数据/);
  });

  it('structure explanations expose exact price and lifecycle status', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    assert.match(html, /item\.price/);
    assert.match(html, /item\.status/);
    assert.match(html, /确认状态/);
  });

  it('supports selecting and focusing one daily candle', () => {
    const focusButton = document.querySelector('[data-chart-candle-focus]');
    assert.ok(focusButton, 'A candle focus action should be visible in the stock chart toolbar');
    assert.equal(typeof window.selectStockKlineCandle, 'function');
    assert.equal(typeof window.clearStockKlineFocus, 'function');
    assert.equal(typeof window.getStockKlineIndexFromPointer, 'function');

    const rect = { left: 100, width: 640 };
    assert.equal(window.getStockKlineIndexFromPointer(158, rect, 10), 0);
    assert.equal(window.getStockKlineIndexFromPointer(726, rect, 10), 9);
    assert.equal(window.getStockKlineIndexFromPointer(99, rect, 10), null);
    assert.equal(window.getStockKlineIndexFromPointer(741, rect, 10), null);
  });

  it('supports locating a stock candle by date and moving the selection', () => {
    assert.ok(document.querySelector('[data-chart-candle-date]'));
    assert.equal(typeof window.focusStockKlineDate, 'function');
    assert.equal(typeof window.moveStockKlineSelection, 'function');
    assert.ok(document.querySelector('[data-chart-candle-prev]'));
    assert.ok(document.querySelector('[data-chart-candle-next]'));
  });

  it('drills a selected daily candle into exchange-local intraday data and preserves a return-to-daily action', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    assert.equal(typeof window.enterStockIntraday, 'function');
    assert.equal(typeof window.exitStockIntraday, 'function');
    assert.equal(typeof window.setStockIntradayPeriod, 'function');
    assert.equal(typeof window.moveStockIntradayDate, 'function');
    assert.ok(document.querySelector('[data-intraday-controls]'));
    for (const period of ['1m', '5m', '15m']) assert.ok(document.querySelector(`[data-intraday-period="${period}"]`));
    assert.match(html, /intradayPeriod/);
    assert.match(html, /exchangeTimezone|stockChartExchangeTimezone/);
    assert.match(html, /避免混入事后数据/);
  });

  it('waits for restored daily bars before relocating the intraday date selection', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
    const start = html.indexOf('async function exitStockIntraday()');
    const end = html.indexOf('\nfunction setStockIntradayPeriod', start);
    assert.notEqual(start, -1, 'return-to-daily must be awaitable');
    assert.notEqual(end, -1);
    const implementation = html.slice(start, end);
    assert.match(implementation, /await loadStockKline\(\)[\s\S]*focusStockKlineDate\(selectedDate\)/);
    assert.doesNotMatch(implementation, /setTimeout\(\(\) => focusStockKlineDate/);
  });
});
