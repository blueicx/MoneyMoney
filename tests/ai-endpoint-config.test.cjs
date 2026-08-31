const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveGroqApiUrl } = require('../dist/features/ai-social');
const { resolveOpenRouterApiUrl } = require('../dist/features/ai-commentary');

test('resolves Groq endpoint from a complete custom URL and trims slashes', () => {
  assert.equal(
    resolveGroqApiUrl('https://proxy.example/v1/chat/completions'),
    'https://proxy.example/v1/chat/completions',
  );
  assert.equal(
    resolveGroqApiUrl('', 'https://proxy.example/v1/'),
    'https://proxy.example/v1/chat/completions',
  );
});

test('resolves OpenRouter endpoint with custom URL, legacy base URL, and default', () => {
  assert.equal(
    resolveOpenRouterApiUrl('https://relay.example/api/chat/completions'),
    'https://relay.example/api/chat/completions',
  );
  assert.equal(
    resolveOpenRouterApiUrl('', 'https://relay.example/api/'),
    'https://relay.example/api/chat/completions',
  );
  assert.equal(
    resolveOpenRouterApiUrl('', ''),
    'https://openrouter.ai/api/v1/chat/completions',
  );
});
