const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-paper-default-'));
test.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

function enabled(value) {
  const env = { ...process.env, MONEYMONEY_JWT_SECRET: 'test_feature_default_only_1234567890' };
  if (value === undefined) delete env.AI_PAPER_TRADING_ENABLED;
  else env.AI_PAPER_TRADING_ENABLED = value;
  const file = path.resolve(__dirname, '../dist/config.js');
  return JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require(process.argv[1]).config.aiPaperTradingEnabled))', file], { cwd, env, encoding: 'utf8' }).trim().split(/\r?\n/).at(-1));
}

test('AI paper runner capability is enabled when no flag is configured', () => assert.equal(enabled(undefined), true));
test('explicit false disables paper runners', () => assert.equal(enabled('false'), false));
test('explicit true enables paper runners', () => assert.equal(enabled('true'), true));
test('invalid feature flag fails closed', () => { for (const value of ['', 'FALSE', 'invalid']) assert.equal(enabled(value), false); });
test('runner workspace explains the enabled default without claiming automatic startup', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../src/web/public/index.html'), 'utf8');
  assert.match(html, /AI 跑单默认开启模拟能力，不自动创建或恢复跑单/);
  assert.doesNotMatch(html, /AI 跑单开关默认关闭|服务端开关默认关闭/);
});
