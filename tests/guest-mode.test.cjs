const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const auth = require('../dist/web/auth');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'server.ts'), 'utf8');
const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'login.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'index.html'), 'utf8');

test('guest token is signed and carries the guest role', () => {
  const token = auth.createLoginToken('guest', 'guest', 60_000);
  const payload = auth.verifyLoginToken(token);
  assert.ok(payload);
  assert.equal(payload.user, 'guest');
  assert.equal(payload.role, 'guest');
  assert.ok(payload.exp > Date.now());
  assert.ok(payload.exp - Date.now() <= 60_000);
});

test('normal login tokens remain admin tokens', () => {
  const payload = auth.verifyLoginToken(auth.createLoginToken('admin'));
  assert.ok(payload);
  assert.equal(payload.role, 'admin');
});

test('guest access only permits explicit read-only GET paths', () => {
  assert.equal(auth.isGuestRequestAllowed('GET', '/markets'), true);
  assert.equal(auth.isGuestRequestAllowed('GET', '/stock/quotes'), true);
  assert.equal(auth.isGuestRequestAllowed('GET', '/news'), true);
  assert.equal(auth.isGuestRequestAllowed('GET', '/events/calendar'), true);
  assert.equal(auth.isGuestRequestAllowed('GET', '/settings'), false);
  assert.equal(auth.isGuestRequestAllowed('GET', '/telegram/status'), false);
  assert.equal(auth.isGuestRequestAllowed('GET', '/paper/portfolio'), false);
  assert.equal(auth.isGuestRequestAllowed('POST', '/markets'), false);
  assert.equal(auth.isGuestRequestAllowed('DELETE', '/watchlist/item'), false);
});

test('server exposes guest login and enforces guest read-only middleware', () => {
  assert.match(serverSrc, /app\.post\(['"]\/api\/auth\/guest['"]/, 'guest login endpoint exists');
  assert.match(serverSrc, /role:\s*['"]guest['"]/, 'guest response identifies role');
  assert.match(serverSrc, /isGuestRequestAllowed/, 'API middleware checks the guest allowlist');
  assert.match(serverSrc, /GUEST_TOKEN_EXPIRY_MS/, 'guest expiry is explicit');
});

test('login and dashboard expose the guest read-only state', () => {
  assert.match(loginHtml, /访客进入/, 'login page has guest entry');
  assert.match(loginHtml, /\/api\/auth\/guest/, 'guest button calls guest endpoint');
  assert.match(indexHtml, /mm_isGuest/, 'dashboard tracks guest state');
  assert.match(indexHtml, /访客模式/, 'dashboard labels guest mode');
});
