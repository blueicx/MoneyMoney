const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 3192;
const baseUrl = process.env.MONEYMONEY_SMOKE_URL || `http://127.0.0.1:${port}`;
const username = process.env.MONEYMONEY_SMOKE_USER || 'browser-owner';
const password = process.env.MONEYMONEY_SMOKE_PASS || 'local-browser-test-only-92!';
const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-auth-smoke-'));
const child = process.env.MONEYMONEY_SMOKE_URL ? null : spawn(process.execPath, [path.join(__dirname, '../dist/web/server.js')], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, MONEYMONEY_DATA_DIR: isolatedDataDir, APP_HOST: '127.0.0.1', APP_PORT: String(port), TELEGRAM_NETWORK_ENABLED: 'false', TELEGRAM_POLLING_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', TELEGRAM_ALLOWED_CHAT_IDS: '', TELEGRAM_ADMIN_CHAT_IDS: '', TELEGRAM_PROXY_URL: '', WECOM_WEBHOOK_URL: '', BARK_DEVICE_KEY: '', AI_PAPER_TRADING_ENABLED: 'false', PRIVATE_KEY: '', API_KEY: '', MONEYMONEY_LOGIN_USER: username, MONEYMONEY_LOGIN_PASS: password, MONEYMONEY_JWT_SECRET: 'local-auth-smoke-jwt-secret-0123456789abcdef' },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/live`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('isolated auth-smoke server did not become healthy');
}

async function main() {
  let browser;
  try {
    if (child) await waitForServer();
    browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const unauthTelegramStatus = await fetch(`${baseUrl}/api/telegram/status`);
    assert.equal(unauthTelegramStatus.status, 401);
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('#username', username);
    await page.fill('#password', password);
    await Promise.all([
      page.waitForURL(url => url.pathname === '/', { timeout: 15_000 }),
      page.click('#submitBtn'),
    ]);
    await page.waitForLoadState('domcontentloaded');
    const status = await page.evaluate(() => fetch('/api/auth/status').then(response => response.json()));
    assert.equal(status.data.loggedIn, true);
    assert.equal(status.data.role, 'admin');
    assert.ok(status.data.csrfToken);
    const html = await page.content();
    assert.ok(html.includes('手动发送测试消息'), 'settings expose an explicit Telegram test action');
    const telegramStatus = await page.evaluate(() => fetch('/api/telegram/status').then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(telegramStatus.status, 200);
    assert.ok(Array.isArray(telegramStatus.body.data.testDeliveryHistory));
    assert.ok(!JSON.stringify(telegramStatus.body).includes('smoke-test-chat'));
    const missingTelegramCsrf = await page.request.post(`${baseUrl}/api/telegram/test-delivery`, { data: { idempotencyKey: 'smoke-no-csrf-0001' } });
    assert.equal(missingTelegramCsrf.status(), 403);
    const noTelegramConfigured = await page.evaluate(() => fetch('/api/telegram/test-delivery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'smoke-no-token-0001' }) }).then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(noTelegramConfigured.status, 503);
    assert.equal(noTelegramConfigured.body.data.status, 'unavailable');

    const slo = await page.evaluate(() => fetch('/api/ops/slo').then(response => response.json()));
    assert.equal(slo.success, true);
    assert.ok(slo.data.runtime.http.requests >= 1);

    const missingCsrf = await page.request.post(`${baseUrl}/api/report/daily`, { data: {} });
    assert.equal(missingCsrf.status(), 403);
    assert.equal((await missingCsrf.json()).code, 'CSRF_INVALID');

    page.once('dialog', dialog => dialog.accept());
    await page.click('button[title="退出登录"]');
    await page.waitForURL(url => url.pathname === '/login', { timeout: 10_000 });
    await page.click('#guestBtn');
    await page.waitForURL(url => url.pathname === '/', { timeout: 10_000 });
    const guestWrite = await page.evaluate(() => fetch('/api/report/daily', { method: 'POST' }).then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(guestWrite.status, 403);
    assert.equal(guestWrite.body.code, 'GUEST_READ_ONLY');
    const guestTelegramStatus = await page.evaluate(() => fetch('/api/telegram/status').then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(guestTelegramStatus.status, 403, JSON.stringify(guestTelegramStatus.body));
    const guestTelegramSend = await page.evaluate(() => fetch('/api/telegram/test-delivery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'guest-forbidden-0001' }) }).then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(guestTelegramSend.status, 403);
    assert.deepEqual(pageErrors, []);
    console.log('Browser auth smoke passed: admin cookie, CSRF, Telegram private delivery guard, logout, guest read-only, SLO');
  } finally {
    if (browser) await browser.close();
    if (child) {
      child.kill('SIGINT');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
