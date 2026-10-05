const assert = require('node:assert/strict');
const test = require('node:test');
const { requestAiRunnerIntent } = require('../dist/features/ai-runner-model');

const runner = { model: 'model-v1', universe: { market: 'stocks', instruments: [{ venue: 'Stocks', symbolOrMarketId: 'AAPL' }] } };
const runtime = { configured: true, apiKey: 'not-a-real-secret', apiUrl: 'https://example.invalid/chat/completions', model: 'fallback-model' };
const body = { action: 'HOLD', instrument: 'AAPL', confidence: 0.6, rationale: '等待价格重新站上均线', counterEvidence: ['成交量偏弱'], riskNotes: ['数据为延迟行情'], market: 'stocks' };

test('AI runner model request uses one configured model and validates a bounded JSON intent', async () => {
  let request;
  const result = await requestAiRunnerIntent(runner, runtime, [{ instrument: 'AAPL', dataStatus: 'delayed', close: 10 }], async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }) };
  });

  assert.equal(result.ok, true);
  assert.equal(result.intent.action, 'HOLD');
  assert.equal(request.body.model, 'model-v1');
  assert.match(request.body.messages[0].content, /不得输出思维链/);
  assert.equal(request.body.max_tokens <= 1000, true);
});

test('AI runner model request fails closed on missing configuration, timeout, HTTP errors, and invalid intent', async () => {
  assert.equal((await requestAiRunnerIntent(runner, { ...runtime, configured: false }, [], async () => { throw new Error('must not call'); })).reason, '未配置 OpenRouter，AI 跑单不可用');
  assert.equal((await requestAiRunnerIntent(runner, runtime, [], async () => { throw new Error('private network detail'); })).reason, 'AI 请求失败或超时');
  assert.equal((await requestAiRunnerIntent(runner, runtime, [], async () => ({ ok: false, status: 429, json: async () => ({}) }))).reason, 'AI 接口返回 HTTP 429');
  assert.equal((await requestAiRunnerIntent(runner, runtime, [], async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{bad' } }] }) }))).reason, 'AI 意图格式无效');
});
