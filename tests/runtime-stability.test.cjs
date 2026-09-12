const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('web server observes unhandled background rejections without exiting', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  assert.match(server, /process\.on\('unhandledRejection'/);
  assert.match(server, /logger\.error\('unhandled_promise_rejection'/);
  assert.match(server, /reason instanceof Error \? reason\.message : String\(reason\)/);
});
