const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { buildAiMarketPrompt } = require('../dist/features/ai-commentary');
const server = fs.readFileSync('src/web/server.ts', 'utf8');
const commentary = fs.readFileSync('src/features/ai-commentary.ts', 'utf8');

const report = {
  stockActions: [{ title: 'AAPL earnings', reason: 'profit growth' }],
  sectorActions: [{ title: 'Technology breadth', reason: 'leaders improving' }],
  optionActions: [{ title: 'AAPL call spread', reason: 'implied volatility' }],
  cryptoActions: [{ title: 'BTC funding', reason: 'funding is elevated' }],
  predictionPicks: [{ title: 'Election market', reason: 'probability divergence' }],
};

const radar = {
  markets: [{ platform: 'Polymarket', id: 'p1', title: 'Election market', titleZh: '选举预测', group: 'politics', yesPrice: 0.55, consensusProbability: 0.52, volume24h: 1000, endDate: null }],
};

test('stock AI context excludes crypto, option and prediction sections', () => {
  const prompt = buildAiMarketPrompt('stocks', radar, report);
  assert.match(prompt, /股票/);
  assert.match(prompt, /AAPL earnings/);
  assert.doesNotMatch(prompt, /BTC funding/);
  assert.doesNotMatch(prompt, /AAPL call spread/);
  assert.doesNotMatch(prompt, /选举预测/);
});

test('AI prompt includes the selected instrument without widening market scope', () => {
  const prompt = buildAiMarketPrompt('stocks', radar, report, 'stock:us:AAPL');
  assert.match(prompt, /当前标的：stock:us:AAPL/);
  assert.match(prompt, /只分析“股票”作用域/);
  assert.doesNotMatch(prompt, /BTC funding/);
});

test('crypto AI context excludes stock, option and prediction sections', () => {
  const prompt = buildAiMarketPrompt('crypto', radar, report);
  assert.match(prompt, /虚拟币/);
  assert.match(prompt, /BTC funding/);
  assert.doesNotMatch(prompt, /AAPL earnings/);
  assert.doesNotMatch(prompt, /AAPL call spread/);
  assert.doesNotMatch(prompt, /选举预测/);
});

test('prediction AI context uses radar only for prediction scope', () => {
  const prompt = buildAiMarketPrompt('prediction', radar, report);
  assert.match(prompt, /预测市场/);
  assert.match(prompt, /选举预测/);
  assert.doesNotMatch(prompt, /AAPL earnings/);
  assert.doesNotMatch(prompt, /BTC funding/);
});

test('AI commentary route forwards the selected scope and avoids prediction fetches elsewhere', () => {
  assert.match(server, /const scope = requestedMarketScope\(req\.body\?\.scope\) \|\| 'prediction'/);
  assert.match(server, /getAiMarketCommentary\(radar, force, scope, report, instrumentRef\)/);
  assert.match(server, /scope === 'prediction' \|\| scope === 'overview'/);
});

test('frontend sends the active instrument for stock, option and crypto AI commentary', () => {
  assert.match(fs.readFileSync('src/web/public/index.html', 'utf8'), /activeMarketScope === 'stocks'[\s\S]*currentStockSymbol/);
  assert.match(fs.readFileSync('src/web/public/index.html', 'utf8'), /activeMarketScope === 'options'[\s\S]*option-symbol/);
  assert.match(fs.readFileSync('src/web/public/index.html', 'utf8'), /activeMarketScope === 'crypto'[\s\S]*bnCurrentSymbol/);
});

test('AI commentary pending requests are isolated by scope signature', () => {
  assert.match(commentary, /let pendingSignature: string \| null = null/);
  assert.match(commentary, /pendingSignature === signature/);
  assert.match(commentary, /pendingSignature = signature/);
});
