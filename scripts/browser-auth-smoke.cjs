const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const baseUrl = process.env.MONEYMONEY_SMOKE_URL || 'http://127.0.0.1:3017';
  const username = process.env.MONEYMONEY_SMOKE_USER || 'browser-owner';
  const password = process.env.MONEYMONEY_SMOKE_PASS || 'local-browser-test-only-92!';
  const browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
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
    assert.deepEqual(pageErrors, []);
    console.log('Browser auth smoke passed: admin cookie, CSRF, logout, guest read-only, SLO');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
