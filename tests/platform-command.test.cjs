const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sources = [
  'src/web/server.ts',
  'src/features/analyst-consensus.ts',
  'src/features/cftc-positioning.ts',
  'src/features/institutional-ownership.ts',
  'src/features/market-breadth.ts',
  'src/features/short-interest.ts',
  'src/features/telegram-bot.ts',
  'src/features/telegram.ts',
];

test('external curl fallbacks do not hard-code the Windows executable', () => {
  for (const relativePath of sources) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(
      source,
      /(?:execFileAsync|execFile)\(\s*['"]curl\.exe['"]/, 
      `${relativePath} must select curl by platform`,
    );
  }
});
