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
    await page.waitForFunction(() => window.mm_dashboardCoreReady === true && typeof window.loadAiRunners === 'function', null, { timeout: 15_000 });
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
    await page.evaluate(async () => {
      const host = document.createElement('div'); host.id = 'ai-runner-history-browser-quality'; document.body.append(host);
      const originalFetch = window.fetch;
      const fixtures = {
        '/api/ai-runners/browser-quality/history': { success: true, data: [
          { action: 'BUY', instrument: 'AAPL', dataStatus: 'live', source: '浏览器夹具', at: '2026-10-12T00:00:00.000Z', reason: '验收用入场记录', signals: ['fixture-signal'], snapshotHash: 'fixture-snapshot-hash', orderId: 'fixture-order-buy', evidence: [{ dataset: 'bars', status: 'live', source: 'fixture-bars', dataAt: '2026-10-12T00:00:00.000Z' }], riskChecks: [{ name: '预算', passed: true }] },
          { action: 'REJECTED', instrument: 'AAPL', dataStatus: 'failed', source: '浏览器夹具', at: '2026-10-12T00:01:00.000Z', reason: '验收用风控拒绝', signals: [], snapshotHash: null, orderId: null, evidence: [], riskChecks: [{ name: '报价新鲜度', passed: false, reason: '夹具过期' }] },
        ], attribution: { reason: '测试无成交' }, selectionAttribution: { status: 'unavailable', reason: '测试数据不足' } },
        '/api/ai-runners/browser-quality/quality': { success: true, dataStatus: 'partial', reason: '已成熟且明确关联的样本不足', data: { decisions: 2, modelCalls: 2, failedModelCalls: 1, skippedModelCalls: 0, unlinkedDecisions: 1, latency: { averageMs: 90, p95Ms: 150 }, matured: { count: 1, calibrationAvailable: false, reason: '已成熟且明确关联订单的样本 1 笔；至少 20 笔后才显示置信度校准和胜率', modelVersionGroups: [{ strategyVersion: 'strategy-fixture', modelVersion: 'model-fixture', count: 1, brierScore: null, winRate: null }] } } },
      };
      window.fetch = async (input, init) => {
        const pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
        const fixture = fixtures[pathname];
        if (!fixture) return originalFetch(input, init);
        return { ok: true, status: 200, json: async () => fixture };
      };
      try { await loadAiRunnerHistory('browser-quality'); }
      finally { window.fetch = originalFetch; }
    });
    const qualityPanel = page.locator('#ai-runner-history-browser-quality');
    assert.match(await qualityPanel.innerText(), /AI 质量与前向结果/);
    assert.match(await qualityPanel.innerText(), /至少 20 笔/);
    assert.match(await qualityPanel.innerText(), /strategy-fixture · model-fixture/);
    assert.doesNotMatch(await qualityPanel.innerText(), /Brier 0\.000 · 胜率 0\.0%/);
    const historyFilter = qualityPanel.locator('[data-runner-history-filter]');
    assert.equal(await historyFilter.count(), 1);
    assert.equal(await qualityPanel.locator('[data-runner-history-rows] > div').count(), 2);
    await historyFilter.selectOption('REJECTED');
    assert.equal(await qualityPanel.locator('[data-runner-history-rows] > div').count(), 1);
    assert.match(await qualityPanel.locator('[data-runner-history-rows]').innerText(), /验收用风控拒绝/);
    assert.doesNotMatch(await qualityPanel.locator('[data-runner-history-rows]').innerText(), /验收用入场记录/);
    await historyFilter.selectOption('BUY');
    const buyHistory = qualityPanel.locator('[data-runner-history-rows]');
    assert.match(await buyHistory.innerText(), /验收用入场记录/);
    assert.match(await buyHistory.innerText(), /fixture-snapshot/);
    assert.match(await buyHistory.innerText(), /fixture-order-buy/);
    assert.match(await buyHistory.innerText(), /fixture-bars/);
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
    await page.waitForFunction(() => document.getElementById('telegram-result-coverage')?.textContent?.includes('Telegram 结果跟踪诊断'), null, { timeout: 3_000 });
    assert.match(await page.locator('#telegram-result-coverage').innerText(), /尚无事件结果跟踪记录/);
    const inboxInteraction = await page.evaluate(async () => {
      const originalFetch = window.fetch;
      let actionRequest = null;
      const fixture = { success: true, dataStatus: 'partial', reason: '浏览器夹具', audit: { checkedAt: '2026-10-12T00:00:00Z', stuckCount: 1 }, data: {
        total: 2, waiting: 1, published: 1, revised: 1, unavailable: 1, failedDeliveries: 1, bySource: { BLS: 1 }, stuckCountdowns: [],
        recent: [
          { id: 'published-row', actionRef: 'a'.repeat(32), title: 'CPI actual', kind: 'macro', eventDate: '2026-10-12T00:00:00Z', deliveryStatus: 'sent', resultStatus: 'revised', actual: '3.1%', source: 'BLS', publishedAt: '2026-10-12T00:00:00Z', retrievedAt: '2026-10-12T00:01:00Z', nextCheckAt: null, hasOriginalReminder: true, resultUrl: 'https://www.bls.gov/news.release/cpi.nr0.htm', evidenceRefs: ['https://www.bls.gov/news.release/cpi.nr0.htm'] },
          { id: 'failed-row', actionRef: 'b'.repeat(32), title: 'GDP result', kind: 'macro', eventDate: '2026-10-12T00:00:00Z', deliveryStatus: 'failed', resultStatus: 'unavailable', actual: null, source: 'BEA', publishedAt: null, retrievedAt: null, nextCheckAt: '2026-10-12T01:00:00Z', reason: '来源不可用', error: '重试夹具错误', hasOriginalReminder: false, resultUrl: null, evidenceRefs: [] },
        ],
      } };
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname === '/api/telegram/results/coverage') return { ok: true, status: 200, json: async () => fixture };
        if (/^\/api\/telegram\/results\/[a-f0-9]{32}\/action$/.test(url.pathname)) {
          actionRequest = { pathname: url.pathname, body: JSON.parse(init.body || '{}') };
          return { ok: true, status: 200, json: async () => ({ success: true, action: actionRequest.body.action, status: 'acknowledged' }) };
        }
        return originalFetch(input, init);
      };
      try {
        await loadTelegramResultCoverage();
        document.querySelector('[data-result-action="ack"]')?.click();
        for (let i = 0; i < 30 && !actionRequest; i++) await new Promise(resolve => setTimeout(resolve, 10));
        return { text: document.getElementById('telegram-result-coverage').innerText, html: document.getElementById('telegram-result-coverage').innerHTML, actionRequest };
      } finally { window.fetch = originalFetch; }
    });
    assert.match(inboxInteraction.text, /结果收件箱/);
    assert.match(inboxInteraction.text, /原提醒已关联/);
    assert.match(inboxInteraction.text, /原提醒未关联/);
    assert.match(inboxInteraction.text, /来源不可用/);
    assert.match(inboxInteraction.html, /target="_blank" rel="noopener noreferrer"/);
    assert.equal(inboxInteraction.actionRequest.body.action, 'ack');
    assert.match(inboxInteraction.actionRequest.pathname, /\/api\/telegram\/results\/a{32}\/action$/);
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
    const lifecycle = await page.evaluate(() => fetch('/api/paper/accounts/main/lifecycle').then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(lifecycle.status, 200);
    assert.equal(lifecycle.body.data.accountId, 'main');
    const reconcile = await page.evaluate(csrf => fetch('/api/paper/accounts/main/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: '{}' }).then(async response => ({ status: response.status, body: await response.json() })), status.data.csrfToken);
    assert.equal(reconcile.status, 200, JSON.stringify(reconcile.body));
    const resultCoverage = await page.evaluate(() => fetch('/api/telegram/results/coverage').then(async response => ({ status: response.status, body: await response.json() })));
    assert.equal(resultCoverage.status, 200);
    assert.ok(Number.isFinite(resultCoverage.body.data.total));
    assert.ok(Array.isArray(resultCoverage.body.data.recent), 'admin diagnostics include recent waiting/published/revised result state');

    const missingCsrf = await page.request.post(`${baseUrl}/api/report/daily`, { data: {} });
    assert.equal(missingCsrf.status(), 403);
    assert.equal((await missingCsrf.json()).code, 'CSRF_INVALID');
    const missingResultActionCsrf = await page.request.post(`${baseUrl}/api/telegram/results/${'a'.repeat(32)}/action`, { data: { action: 'ack' } });
    assert.equal(missingResultActionCsrf.status(), 403);

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
    const guestLifecycle = await page.evaluate(async () => (await Promise.all([
      fetch('/api/paper/accounts/main/lifecycle'),
      fetch('/api/paper/accounts/main/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch('/api/telegram/results/coverage'),
      fetch('/api/telegram/results/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ack' }) }),
    ])).map(response => response.status));
    assert.deepEqual(guestLifecycle, [403, 403, 403, 403], 'paper lifecycle and Telegram result diagnostics stay private');
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
    const guestResearchAndData = await page.evaluate(async () => Promise.all([
      '/api/data/backfills/private-smoke-id',
      '/api/data/canaries/targets',
      '/api/research',
      '/api/research/private-note-smoke-id',
      '/api/research/daily-briefing?scope=stocks',
      '/api/research/candidates?market=stocks',
      '/api/research/experiments?market=stocks',
      '/api/research/jobs',
      '/api/research/jobs/private-smoke-id/events',
      '/api/research/artifacts/private-smoke-id',
    ].map(async url => ({ url, status: (await fetch(url)).status }))));
    assert.deepEqual(guestResearchAndData.map(item => item.status), Array(10).fill(403), JSON.stringify(guestResearchAndData));
    const guestPublicCatalog = await page.evaluate(async () => Promise.all([
      fetch('/api/data/canaries/summary').then(response => response.status),
      fetch('/api/research/factors/catalog?market=stocks').then(response => response.status),
    ]));
    assert.deepEqual(guestPublicCatalog, [200, 200], 'public coverage summary and factor catalog remain readable');
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
    console.log('Browser auth smoke passed: admin cookie, CSRF, Telegram/runner/research/data private guards, public catalog, logout, guest read-only, SLO');
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
