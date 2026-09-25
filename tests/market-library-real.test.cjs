const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('right libraries offer scoped options and real prediction entries or explicit source failure', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
  assert.doesNotMatch(html, /期权市场实盘级标的库开发中，暂不可用/);
  assert.doesNotMatch(html, /预测市场标的需通过中心区发现进入，快捷库未挂载/);
  assert.match(html, /function selectPredictionLibraryEvent\(/);
  assert.match(html, /id="prediction-selected-event"/);
  assert.match(html, /\/api\/prediction-radar\?limit=/);
});
