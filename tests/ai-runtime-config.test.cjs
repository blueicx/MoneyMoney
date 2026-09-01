const assert = require('node:assert/strict');
const test = require('node:test');
const { getAiRuntimeConfig, getAiConfigurationStatus, testAiConnection } = require('../dist/features/ai-runtime-config');

const env = {
  OPENROUTER_API_KEY: 'test_key',
  OPENROUTER_API_URL: 'https://env.example/v1/chat/completions',
  OPENROUTER_MODEL: 'env-model',
  GROQ_API_KEY: 'test_key',
  GROQ_API_URL: 'https://groq.example/v1',
  GROQ_MODEL: 'groq-env-model',
};

test('runtime AI config prefers saved URL/model overrides and normalizes endpoints', () => {
  const settings = {
    openRouterApiUrl: 'https://custom.example/v1',
    openRouterModel: 'custom-model',
    groqApiUrl: '',
    groqModel: '',
  };
  const openRouter = getAiRuntimeConfig('openrouter', settings, env);
  const groq = getAiRuntimeConfig('groq', settings, env);

  assert.equal(openRouter.apiUrl, 'https://custom.example/v1/chat/completions');
  assert.equal(openRouter.model, 'custom-model');
  assert.equal(openRouter.apiKey, 'test_key');
  assert.equal(groq.apiUrl, 'https://groq.example/v1/chat/completions');
  assert.equal(groq.model, 'groq-env-model');
});

test('configuration status reports readiness without exposing API keys', () => {
  const status = getAiConfigurationStatus({
    openRouterApiUrl: 'https://custom.example/v1/chat/completions',
    openRouterModel: 'custom-model',
    groqApiUrl: '',
    groqModel: '',
  }, env);

  assert.equal(status.openrouter.configured, true);
  assert.equal(status.openrouter.model, 'custom-model');
  assert.equal(status.groq.configured, true);
  assert.equal(status.groq.model, 'groq-env-model');
  assert.equal(Object.hasOwn(status.openrouter, 'apiKey'), false);
  assert.equal(Object.hasOwn(status.groq, 'apiKey'), false);
});

test('blank overrides fall back to safe official defaults when env is empty', () => {
  const emptyEnv = {};
  const openRouter = getAiRuntimeConfig('openrouter', {}, emptyEnv);
  const groq = getAiRuntimeConfig('groq', {}, emptyEnv);

  assert.equal(openRouter.apiUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(openRouter.model, 'minimax/minimax-m3:free');
  assert.equal(groq.apiUrl, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(groq.model, 'llama-3.3-70b-versatile');
  assert.equal(openRouter.configured, false);
  assert.equal(groq.configured, false);
});

test('connection test never returns the API key and sends it only in the request header', async () => {
  let request;
  const result = await testAiConnection('groq', { groqModel: 'test-model' }, env, async (url, init) => {
    request = { url, init };
    return new Response('{}', { status: 200 });
  });

  assert.equal(result.success, true);
  assert.equal(result.model, 'test-model');
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
  assert.equal(request.init.headers.authorization, 'Bearer test_key');
  assert.equal(request.url, 'https://groq.example/v1/chat/completions');
});
