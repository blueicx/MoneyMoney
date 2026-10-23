const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('secondary chart respects its plot height and formats stock prices without changing source precision', () => {
  const dom = new JSDOM('<div><canvas></canvas></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, labels = [];
  w.HTMLElement.prototype.getClientRects = () => [{ width: 640, height: 440 }];
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({ fillText: text => labels.push(String(text)), measureText: () => ({ width: 70 }) }, { get: (target, key) => target[key] || (() => {}) });
  try {
    w.eval(fs.readFileSync('src/web/public/trading-chart.js', 'utf8'));
    const rows = Array.from({ length: 80 }, (_, i) => ({ time: 1792762200000 + i * 86400000, open: 1269.001953, high: 1299.98999, low: 1258.300029, close: 1286.880005, volume: 3349777 }));
    const original = JSON.stringify(rows), canvas = w.document.querySelector('canvas');
    const options = { identity: 'stock:us:SNDK|1d', interval: '1d', volumeUnit: '股', height: 260, paperLayer: false };
    w.MoneyTradingChart.render(canvas, rows, options);
    assert.equal(canvas.style.height, '260px');
    const text = w.document.querySelector('.mm-trading-readout').textContent;
    assert.match(text, /开 1,269\.00/);
    assert.match(text, /高 1,299\.99/);
    assert.match(text, /MA5: 1,286\.88/);
    assert.match(text, /成交量 3,349,777 股/);
    assert.ok(labels.includes('1,286.88'), 'latest-price label uses stock price precision too');
    assert.equal(JSON.stringify(rows), original, 'round display only, preserve OHLC and MA input');
    w.MoneyTradingChart.render(canvas, rows, { ...options, height: undefined });
    assert.equal(canvas.style.height, '440px', 'primary charts retain their default plot height');
    const tiny = rows.map(row => ({ ...row, open: 0.00000123, high: 0.00000125, low: 0.00000121, close: 0.00000124 }));
    w.MoneyTradingChart.render(canvas, tiny, { ...options, identity: 'tiny', volumeUnit: '枚' });
    assert.match(w.document.querySelector('.mm-trading-readout').textContent, /0\.00000124/, 'small crypto prices remain readable');
  } finally { w.close(); }
});
