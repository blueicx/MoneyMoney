const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveWorkspaceNavigation,
  isWorkspaceAllowed,
  defaultWorkspace,
} = require('../dist/features/market-workspace.js');

function ids(scope) {
  return resolveWorkspaceNavigation(scope).flatMap(group => group.items.map(item => item.id));
}

test('股票左栏包含研究功能但不包含虚拟币和预测市场专属功能', () => {
  const stockIds = ids('stocks');

  assert.ok(stockIds.includes('insider'));
  assert.ok(stockIds.includes('backtest'));
  assert.equal(stockIds.includes('search'), false);
  assert.equal(stockIds.includes('watchlist'), false);
  assert.equal(stockIds.includes('positions'), false);
  assert.equal(stockIds.includes('funding-rate'), false);
  assert.equal(stockIds.includes('prediction-radar'), false);
});

test('虚拟币左栏使用虚拟币功能，宏观不进入市场侧栏', () => {
  const cryptoIds = ids('crypto');

  assert.ok(cryptoIds.includes('funding-rate'));
  assert.equal(cryptoIds.includes('macro'), false);
  assert.equal(isWorkspaceAllowed('crypto', 'insider'), false);
});

test('各市场保留自己的专属工作区边界', () => {
  assert.equal(isWorkspaceAllowed('stocks', 'insider'), true);
  assert.equal(isWorkspaceAllowed('options', 'insider'), false);
  assert.equal(isWorkspaceAllowed('prediction', 'prediction-radar'), true);
  assert.equal(isWorkspaceAllowed('stocks', 'funding-rate'), false);
  assert.equal(isWorkspaceAllowed('stocks', 'watchlist'), true);
  assert.equal(isWorkspaceAllowed('stocks', 'positions'), true);
});

test('股票和虚拟币把行情及事件放入左侧，虚拟币不包含预测雷达', () => {
  const stockIds = ids('stocks');
  const cryptoIds = ids('crypto');

  assert.ok(stockIds.includes('stock-quotes'));
  assert.ok(stockIds.includes('events'));
  assert.ok(cryptoIds.includes('crypto-quotes'));
  assert.equal(cryptoIds.includes('prediction-radar'), false);
  assert.equal(isWorkspaceAllowed('crypto', 'prediction-radar'), false);
});

test('股票和虚拟币进入市场时默认打开各自行情工作区', () => {
  assert.equal(defaultWorkspace('stocks'), 'stock-quotes');
  assert.equal(defaultWorkspace('crypto'), 'crypto-quotes');
});
