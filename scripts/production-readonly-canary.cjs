const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

function validatePublicBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('PUBLIC_WEB_BASE_URL must be a valid public HTTPS URL'); }
  if (url.protocol !== 'https:') throw new Error('PUBLIC_WEB_BASE_URL must use HTTPS');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (['localhost', 'localhost.localdomain', '127.0.0.1', '::', '::1', '0.0.0.0'].includes(host) || host.endsWith('.local') || /^f[cd][\da-f]{2}:/.test(host) || /^fe[89ab][\da-f]:/.test(host) || /^ff[\da-f]{2}:/.test(host)) {
    throw new Error('PUBLIC_WEB_BASE_URL must be publicly reachable');
  }
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a,b] = ip.slice(1).map(Number);
    if (ip.slice(1).some(part => Number(part) > 255) || isPrivateIpv4(a, b, Number(ip[3]), Number(ip[4]))) {
      throw new Error('PUBLIC_WEB_BASE_URL must be publicly reachable');
    }
  }
  const mapped = host.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (mapped) {
    const octets = mapped.slice(1).map(Number);
    if (octets.some(part => part > 255) || isPrivateIpv4(...octets)) throw new Error('PUBLIC_WEB_BASE_URL must be publicly reachable');
  }
  return url.toString().replace(/\/$/, '');
}

function isPrivateIpv4(a, b, c, d) {
  return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127 || a >= 224;
}

async function enterGuest(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (new URL(page.url()).pathname.startsWith('/login')) {
    await page.locator('#guestBtn').click({ timeout: 15_000 });
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  }
  await page.locator('#market-workspace-shell').waitFor({ state: 'visible', timeout: 20_000 });
}

async function selectMarket(page, market) {
  await page.evaluate(scope => window.setMarketScope(scope), market);
  await page.waitForFunction(scope => document.body.dataset.marketScope === scope, market, { timeout: 15_000 });
  const library = market === 'stocks' ? '#stock-instrument-library' : `[data-market-library="${market}"]`;
  await page.locator(library).waitFor({ state: 'visible', timeout: 15_000 });
}

async function selectAndCheckNonPopularStock(page) {
  await selectMarket(page, 'stocks');
  const search = page.locator('#stock-library-search-input');
  await search.fill('SNDK');
  await search.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#stock-library-search-results')?.textContent?.includes('搜索中'), null, { timeout: 25_000 });
  const rows = page.locator('#stock-library-search-results .stock-library-search-result');
  assert.ok(await rows.count(), 'non-popular stock SNDK should resolve to a selectable result or explicit empty-state row');
  await rows.first().click();
  await page.waitForFunction(() => /SNDK/i.test(document.querySelector('#stock-chart-title')?.textContent || ''), null, { timeout: 20_000 });
  const events = await page.evaluate(async () => {
    const response = await fetch('/api/events/entities?market=stocks&instrumentId=stock:us:SNDK');
    return { status: response.status, body: await response.json() };
  });
  assert.equal(events.status, 200);
  assert.ok(Array.isArray(events.body.data));
  assert.ok(events.body.data.length || events.body.reason, 'event panel must show evidence or a real empty/unavailable reason');
}

async function checkSettlementEvidence(page) {
  await page.evaluate(() => window.openWorkspace('prediction-radar'));
  const cards = page.locator('#radar-markets .radar-card');
  try { await cards.first().waitFor({ state: 'visible', timeout: 20_000 }); }
  catch {
    const emptyState = await page.locator('#radar-markets').innerText().catch(() => '');
    assert.match(emptyState, /暂无|不可用|失败|没有匹配|没有找到/, 'prediction radar must show markets or an explicit source/empty reason');
    return { status: 'empty', reason: emptyState.slice(0, 300) };
  }
  const card = cards.first();
  await card.getByRole('button', { name: /结算证据/ }).click();
  const panel = card.locator('[id^="radar-settlement-"]');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(element => element && !element.textContent.includes('正在读取官方结算规则与证据'), await panel.elementHandle(), { timeout: 15_000 });
  const text = await panel.innerText();
  assert.match(text, /结算规则与证据|结算证据不可用/);
  return { status: 'checked', summary: text.slice(0, 500) };
}

async function selectRightLibraryItem(page, market) {
  const quick = page.locator(`#${market}-library-quick .stock-library-item`).first();
  await quick.waitFor({ state: 'visible', timeout: 20_000 });
  await quick.click();
  const symbolSelector = market === 'options' ? '#options-library-current-symbol' : market === 'crypto' ? '#crypto-library-current-symbol' : '#prediction-library-current-symbol';
  const symbol = (await page.locator(symbolSelector).innerText()).trim();
  assert.ok(symbol && symbol !== '--', `${market} selection should update the right-side context`);
  const center = await page.locator('#center-workspace').innerText();
  assert.ok(center.includes(symbol) || /暂无数据|来源不可用|请求失败|当前市场不支持|缓存数据/.test(center), `${market} center must show selected instrument or explicit data reason`);
  return symbol;
}

async function sendFailureNotice(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Telegram failure notification returned HTTP ${response.status}`);
}

async function runProductionCanary({ baseUrl, artifactDir } = {}) {
  const target = validatePublicBaseUrl(baseUrl || process.env.PUBLIC_WEB_BASE_URL);
  const outputDir = artifactDir || process.env.CANARY_ARTIFACT_DIR || path.join(os.tmpdir(), `moneymoney-canary-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const report = { target, startedAt: new Date().toISOString(), markets: [], errors: [] };
  const traceFile = path.join(outputDir, 'production-canary-trace.zip');
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    const health = await page.request.get(`${target}/api/health/live`, { timeout: 15_000 });
    assert.equal(health.status(), 200, 'production health endpoint must return 200');
    const healthBody = await health.json();
    assert.equal(healthBody.status, 'alive');
    await enterGuest(page, target);
    for (const market of ['stocks', 'options', 'crypto', 'prediction']) {
      await selectMarket(page, market);
      report.markets.push(market);
    }
    await selectAndCheckNonPopularStock(page);
    report.nonPopularStock = 'SNDK';
    for (const market of ['options', 'crypto', 'prediction']) {
      await selectMarket(page, market);
      await selectRightLibraryItem(page, market);
      if (market === 'prediction') report.settlementEvidence = await checkSettlementEvidence(page);
    }
    await page.evaluate(() => window.setMarketScope('stocks'));
    await page.waitForFunction(() => document.body.dataset.marketScope === 'stocks');
    await page.evaluate(() => window.toggleRightLibrary());
    await page.waitForFunction(() => document.querySelector('#market-workspace-shell')?.getAttribute('data-right-library') === 'collapsed');
    await page.evaluate(() => window.toggleRightLibrary());
    await page.waitForFunction(() => document.querySelector('#market-workspace-shell')?.getAttribute('data-right-library') !== 'collapsed');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#center-workspace').isVisible(), true, 'mobile center workspace must remain visible');
    assert.deepEqual(pageErrors, [], `browser runtime errors: ${pageErrors.join('; ')}`);
    report.finishedAt = new Date().toISOString();
    report.status = 'passed';
    await context.tracing.stop();
    await browser.close();
    return report;
  } catch (error) {
    report.finishedAt = new Date().toISOString();
    report.status = 'failed';
    report.errors.push(error.stack || error.message || String(error));
    try { await page.screenshot({ path: path.join(outputDir, 'production-canary-failure.png'), fullPage: true }); } catch {}
    try { await context.tracing.stop({ path: traceFile }); } catch {}
    await fs.writeFile(path.join(outputDir, 'production-canary-report.json'), JSON.stringify(report, null, 2), 'utf8');
    await browser.close();
    try { await sendFailureNotice(`MoneyMoney 生产只读巡检失败\n${target}\n${error.message || error}`); } catch { /* never hide the browser failure behind notification errors */ }
    throw Object.assign(new Error(error.message || 'production canary failed'), { report, artifactDir: outputDir });
  }
}

if (require.main === module) {
  runProductionCanary().then(report => {
    process.stdout.write(`Production read-only canary passed: ${report.markets.join(', ')}, ${report.nonPopularStock}\n`);
  }).catch(error => {
    process.stderr.write(`Production read-only canary failed: ${error.message}\nArtifacts: ${error.artifactDir || process.env.CANARY_ARTIFACT_DIR || 'temporary directory'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { validatePublicBaseUrl, runProductionCanary };
