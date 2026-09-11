const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '../src/web/server.ts'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '../src/web/auth.ts'), 'utf8');

test('workspace navigation API is registered with scope validation', () => {
  assert.match(serverSource, /app\.get\(['"]\/api\/workspace\/navigation['"]/);
  assert.match(serverSource, /MARKET_SCOPES\.includes\(rawScope as MarketScope\)/);
  assert.match(serverSource, /resolveWorkspaceNavigation\(scope\)/);
  assert.match(authSource, /['"]\/workspace['"]/);
});

test('workspace context API validates workspace against the requested scope', () => {
  assert.match(serverSource, /app\.get\(['"]\/api\/workspace\/context['"]/);
  assert.match(serverSource, /isWorkspaceAllowed\(scope, workspace\)/);
  assert.match(serverSource, /当前市场不支持该工作区/);
});

test('workspace context response carries scope, workspace and instrument', () => {
  assert.match(serverSource, /scope, workspace, instrument: instrument \|\| null/);
});
