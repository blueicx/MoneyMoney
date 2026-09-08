const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');

test('renders market-first navigation with global actions after watchlist', () => {
  assert.match(html, /id="market-scope-bar"/);
  assert.match(html, /id="utility-nav-bar"/);
  assert.match(html, /MARKET_SCOPES/);
  assert.match(html, /自选/);
  assert.match(html, /搜索/);
  assert.match(html, /总设置/);
  assert.match(html, /自动化运营/);
});

test('bottom core navigation uses cross-market holdings instead of Binance', () => {
  assert.match(html, /\['positions', '💼 持仓'\]/);
  assert.doesNotMatch(html, /id="mobile-nav"[\s\S]*data-tab="binance"/);
});

test('market changes carry scope and guard stale responses', () => {
  assert.match(html, /setMarketScope/);
  assert.match(html, /marketScope/);
  assert.match(html, /scope=/);
  assert.match(html, /request !== globalSearchState\.request/);
});

test('market radar navigation never opens prediction radar for another market', () => {
  assert.match(html, /function marketRadarTab\(scope = activeMarketScope\)/);
  assert.match(html, /scope === 'stocks' \? 'stocks'/);
  assert.match(html, /scope === 'options' \? 'options'/);
  assert.match(html, /scope === 'crypto' \? 'binance'/);
  assert.match(html, /id="radar-tab" class="tab-content" data-market-scopes="overview prediction"/);
  assert.match(html, /const targetTab = tab === 'radar' \? marketRadarTab\(\) : tab/);
  assert.match(html, /saved !== 'radar' \|\| marketRadarTab\(\) === 'radar'/);
});

test('guest mode excludes global mutation entries', () => {
  assert.match(html, /window\.mm_isGuest/);
  assert.match(html, /GUEST_ADMIN_TABS/);
});

console.log('Market navigation wiring tests loaded');
