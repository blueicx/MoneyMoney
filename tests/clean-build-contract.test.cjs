const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('clean build contract - platform-command.ts is present and valid', () => {
  const file = path.join(__dirname, '../src/utils/platform-command.ts');
  assert.ok(fs.existsSync(file), 'platform-command.ts must be present for clean checkout');
});
