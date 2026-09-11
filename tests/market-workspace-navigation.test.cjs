const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveWorkspaceNavigation,
  isWorkspaceAllowed,
} = require('../dist/features/market-workspace.js');

function ids(scope) {
  return resolveWorkspaceNavigation(scope).flatMap(group => group.items.map(item => item.id));
}

test('股票左栏包含研究功能但不包含虚拟币和预测市场专属功能', () => {
  const stockIds = ids('stocks');

  assert.ok(stockIds.includes('insider'));
  assert.ok(stockIds.includes('backtest'));
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
});
