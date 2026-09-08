const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');
const runner = fs.readFileSync('src/features/ai-paper-runner.ts', 'utf8');

assert.match(html, /<option value="Predict\.fun">[^<]*Predict\.fun/);
assert.match(html, /<option value="Stocks">[^<]*(?:美股|Stocks)/);
assert.match(html, /startAiRunnerFromInstrument/);
assert.match(html, /id="ai-runners-summary"/);
assert.match(html, /syncAiRunnerVenueHint/);
assert.doesNotMatch(html, /<option value="Predict\.fun" disabled>/);
assert.match(server, /runner\.venue === 'Stocks'/);
assert.match(server, /runner\.venue === 'Predict\.fun'/);
assert.match(server, /modelProbability|yesPrice/);
assert.match(server, /getCachedPredictionRadarSlice\('', 240\)/);
assert.match(server, /runnerOpenPosition\(runner\.id, price, qty, 'YES'/);
assert.match(server, /getRunnerStockKlineAdapter/);
assert.match(runner, /AiRunnerVenue = 'Binance' \| 'Predict\.fun' \| 'Stocks'/);

assert.match(html, /venue === 'Stocks'/);
assert.match(html, /venue === 'Predict\.fun'/);
assert.match(html, /如 AAPL \/ NVDA/);
assert.match(html, /如 12345/);
assert.match(html, /如 BTCUSDT \/ ETHUSDT/);
assert.match(html, /ai-runner-desc/);
assert.match(html, /选择美股标的/);
assert.match(html, /预测市场/);
assert.match(html, /Predict\.fun 的市场 ID/);
assert.match(html, /币安交易对/);
console.log('AI runner market selection: all assertions passed');
