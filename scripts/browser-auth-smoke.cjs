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
    const runnerState = await page.evaluate(async () => {
      await loadAiRunners();
      const response = await fetch('/api/ai-runners');
      return { response: await response.json(), createDisabled: document.querySelector('#ai-runner-create-btn')?.disabled, tickDisabled: document.querySelector('#ai-runner-tick-btn')?.disabled, disabledNoticeVisible: !document.querySelector('#ai-runner-feature-state')?.hidden };
    });
    assert.equal(runnerState.response.enabled, false, 'the AI paper-trading feature flag remains off in smoke environment');
    assert.equal(runnerState.createDisabled, true, 'UI must not offer a start action while the server feature flag is off');
    assert.equal(runnerState.tickDisabled, true, 'UI must not offer a manual tick while the server feature flag is off');
    assert.equal(runnerState.disabledNoticeVisible, true, 'UI must explain why the runner is disabled');
    const budget=await page.evaluate(()=>fetch('/api/ai-runners/comparisons/budget').then(r=>r.json()));
    assert.equal(budget.success,true);assert.equal(budget.data.limit,24);assert.equal(budget.data.issued,0);
    const streamResponse = await page.evaluate(async () => {
      const controller = new AbortController();
      const response = await fetch('/api/stream', { signal: controller.signal });
      controller.abort();
      return response.status;
    });
    assert.equal(streamResponse, 200, 'admin should be able to receive private runner updates');
    await page.evaluate(() => showTab('settings'));
    await page.waitForFunction(() => document.getElementById('settings-tab')?.textContent?.includes('手动发送测试消息'));
    assert.ok((await page.locator('#settings-tab').innerText()).includes('手动发送测试消息'), 'loaded settings expose an explicit Telegram test action');
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
    const guestRunnerList = await page.evaluate(() => fetch('/api/ai-runners').then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(guestRunnerList.status, 403, JSON.stringify(guestRunnerList.body));
    assert.equal(guestRunnerList.body.code, 'GUEST_READ_ONLY');
    assert.equal(await page.evaluate(()=>fetch('/api/ai-runners/comparisons/budget').then(r=>r.status)),403,'comparison quota remains private');
    assert.equal(await page.evaluate(()=>fetch('/api/paper/chart-markers?market=stocks&instrument=usAAPL').then(r=>r.status)),403,'paper markers and account lineage remain private');
    const guestPaperReads = await page.evaluate(async () => Promise.all([
      '/api/paper/ledger',
      '/api/paper/positions',
      '/api/paper/performance',
      '/api/paper/orders/private-smoke-id',
      '/api/paper/execution-evidence?market=stocks&instrument=stock%3Aus%3AAAPL&accountId=private&orderId=private&signalId=private&snapshotId=private',
    ].map(async url => ({ url, status: (await fetch(url)).status }))));
    assert.deepEqual(guestPaperReads.map(item => item.status), [403, 403, 403, 403, 403], JSON.stringify(guestPaperReads));
    const guestPaperWrite = await page.evaluate(() => fetch('/api/paper/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'guest-private-smoke-id' }) }).then(response => response.status));
    assert.equal(guestPaperWrite, 403, 'guests must not create or mutate private paper orders');
    assert.equal(await page.locator('[data-paper-chart-layer]').count(),0,'guest cannot see private paper chart controls');
    assert.equal(await page.evaluate(()=>fetch('/api/ai-runners/comparisons/automatic').then(r=>r.status)),403,'automatic groups and scheduling history remain private');
    const guestRunnerHistory = await page.evaluate(() => fetch('/api/ai-runners/private-runner/history').then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(guestRunnerHistory.status, 403, JSON.stringify(guestRunnerHistory.body));
    assert.equal(guestRunnerHistory.body.code, 'GUEST_READ_ONLY');
    const guestRunnerStream = await page.evaluate(async () => {
      const response = await fetch('/api/stream');
      return { status: response.status, body: await response.json() };
    });
    assert.equal(guestRunnerStream.status, 403, JSON.stringify(guestRunnerStream.body));
    assert.equal(guestRunnerStream.body.code, 'GUEST_READ_ONLY');
    const guestTelegramSend = await page.evaluate(() => fetch('/api/telegram/test-delivery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'guest-forbidden-0001' }) }).then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(guestTelegramSend.status, 403);
    assert.deepEqual(pageErrors, []);
    console.log('Browser auth smoke passed: admin cookie, CSRF, Telegram and AI runner private guards, logout, guest read-only, SLO');
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
