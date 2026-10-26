// Isolated Chromium comparison: use the real local application and providers;
// do not patch the page's fetch implementation or disable the browser cache.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { summarizeCpuProfile, summarizeTimeline } = require('./benchmark-profile.cjs');
const {summarizeLoadingPhases}=require('./lib/loading-phases.cjs');
const {installLongTaskDiagnostics}=require('./lib/loading-long-tasks.cjs');
const profileCpu = process.env.MONEYMONEY_BENCHMARK_PROFILE === '1';
const traceLayout = process.env.MONEYMONEY_BENCHMARK_LAYOUT === '1';
const assert = require('node:assert/strict');
const port = 3198;
const base = `http://127.0.0.1:${port}`;
const appRoot = path.resolve(process.env.MONEYMONEY_BENCHMARK_ROOT || path.join(__dirname, '..'));
const benchmarkRunCount = Number(process.env.MONEYMONEY_BENCHMARK_RUNS || 3);
if (!Number.isInteger(benchmarkRunCount) || benchmarkRunCount < 1 || benchmarkRunCount > 3) throw new Error('MONEYMONEY_BENCHMARK_RUNS must be an integer from 1 to 3');
const cpuRate = process.env.MONEYMONEY_BENCHMARK_CPU_RATE === undefined ? 4 : Number(process.env.MONEYMONEY_BENCHMARK_CPU_RATE);
if (!Number.isFinite(cpuRate) || cpuRate < 0 || cpuRate > 8) throw new Error('MONEYMONEY_BENCHMARK_CPU_RATE must be a number from 0 to 8; 0 disables CPU throttling');
const networkProfile = process.env.MONEYMONEY_BENCHMARK_NETWORK || 'weak';
if (!['weak', 'none'].includes(networkProfile)) throw new Error('MONEYMONEY_BENCHMARK_NETWORK must be weak or none');
const gateAuxiliaryRequests = process.env.MONEYMONEY_BENCHMARK_GATE_AUX === '1';
const auxiliaryPaths = ['/api/stock/indices', '/api/watchlist', '/api/paper/positions'];
const allViewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const requestedViewport = process.env.MONEYMONEY_BENCHMARK_VIEWPORT;
const benchmarkViewports = requestedViewport === 'desktop' ? [allViewports[0]]
  : requestedViewport === 'mobile' ? [allViewports[1]]
      : requestedViewport ? (() => { throw new Error('MONEYMONEY_BENCHMARK_VIEWPORT must be desktop or mobile'); })()
      : allViewports;
function waitForPageCondition(page, predicate, phase) {
  let watchdog;
  const pageWait = page.waitForFunction(predicate, null, { timeout: 15_000 });
  pageWait.catch(() => {});
  const nodeWait = new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new Error(`${phase} exceeded 14s Node watchdog; renderer may be blocked`)), 14_000);
  });
  return Promise.race([pageWait, nodeWait]).finally(() => clearTimeout(watchdog));
}
function stopBenchmarkChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    let hardKill;
    const finish = () => {
      clearTimeout(hardKill);
      resolve();
    };
    child.once('exit', finish);
    child.kill('SIGINT');
    hardKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 1500);
    hardKill.unref();
  });
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-load-benchmark-'));
const child = spawn(process.execPath, [path.join(appRoot, 'dist', 'web', 'server.js')], {
  cwd: appRoot, stdio: 'ignore',
  env: { ...process.env, MONEYMONEY_DATA_DIR: root, APP_HOST: '127.0.0.1', APP_PORT: String(port), TELEGRAM_POLLING_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', AI_PAPER_TRADING_ENABLED: 'false', MONEYMONEY_DISABLE_GURU_REFRESH: 'true', PRIVATE_KEY: '', API_KEY: '', MONEYMONEY_LOGIN_USER: 'benchmark-owner', MONEYMONEY_LOGIN_PASS: 'benchmark-only-92!', MONEYMONEY_JWT_SECRET: 'benchmark-only-secret-0123456789abcdef' },
});
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
(async () => {
  let browser;
  const pendingAuxiliaryReleases = new Set();
  const releaseAuxiliaryRequests = async () => {
    const pending = [...pendingAuxiliaryReleases];
    await Promise.allSettled(pending.map(async gate => {
      try { await gate.release(); } finally { pendingAuxiliaryReleases.delete(gate); }
    }));
  };
  try {
    let healthy = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/api/health/live')).ok) { healthy = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!healthy) throw new Error('isolated benchmark server did not become healthy within 16 seconds');
    browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
    const authContext = await browser.newContext();
    const login = await authContext.request.post(base + '/api/auth/login', { data: { username: 'benchmark-owner', password: 'benchmark-only-92!' } });
    if (!login.ok()) throw new Error(`benchmark login failed (${login.status()})`);
    const navigationProbeStartedAt = Date.now();
    const navigationProbeResponse = await authContext.request.get(base + '/api/workspace/navigation?scope=stocks', { timeout: 3_000 });
    const navigationStatusProbe = { status: navigationProbeResponse.status(), durationMs: Date.now() - navigationProbeStartedAt };
    const storageState = await authContext.storageState();
    await authContext.close();
    await browser.close();
    browser = null;
    const samples = [];
    for (const viewport of benchmarkViewports) {
      for (let run = 0; run < benchmarkRunCount; run++) {
        // Keep the cold/warm pair together for cache measurement, but isolate
        // each pair in a fresh browser process to prevent renderer memory from
        // one throttled sample contaminating the next.
        browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', storageState });
        const page = await context.newPage();
        const requests = [];
        const apiTimings = [];
        const apiRequestStartedAt = new WeakMap();
        const pageErrors = [];
        const responses = [];
        const assetResponses = [];
        const klineResponseMetadata = [];
        const klineResponseTasks = [];
        const failedRequests = [];
        await page.addInitScript(() => { window.__MM_PERFORMANCE_TRACE__=true; });
        if(profileCpu)await page.addInitScript(installLongTaskDiagnostics);
        if (gateAuxiliaryRequests) {
          for (const pathname of auxiliaryPaths) {
            await page.route(`**${pathname}*`, route => new Promise(resolve => {
              let released = false;
              const gate = {
                pathname,
                release: async () => {
                  if (released) return;
                  released = true;
                  try { await route.continue(); } finally { resolve(); }
                },
              };
              pendingAuxiliaryReleases.add(gate);
            }));
          }
        }
        const reportWaitFailure = async (phase, error) => {
          let authStatusProbe = null;
          const controller = new AbortController();
          const probeTimeout = setTimeout(() => controller.abort(), 2_000);
          try {
            const response = await fetch(base + '/api/auth/status', { signal: controller.signal });
            authStatusProbe = { status: response.status, contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length') };
          } catch (probeError) {
            authStatusProbe = { error: probeError.name === 'AbortError' ? 'timed out' : probeError.message };
          } finally { clearTimeout(probeTimeout); }
          console.error(JSON.stringify({ phase, error: error.message, authStatusProbe, navigationStatusProbe, apiRequests: requests, apiTimings, responses, pageErrors, failedRequests }));
          throw error;
        };
        page.on('request', request => {
          const url = new URL(request.url());
          if (url.pathname.startsWith('/api/')) {
            requests.push({ pathname: url.pathname, method: request.method(), url: `${url.pathname}${url.search}` });
            apiRequestStartedAt.set(request, Date.now());
          }
        });
        page.on('requestfinished', async request => {
          const startedAt = apiRequestStartedAt.get(request);
          if (startedAt === undefined) return;
          const response = await request.response().catch(() => null);
          apiTimings.push({ pathname: new URL(request.url()).pathname, status: response?.status() || null, durationMs: Date.now() - startedAt });
        });
        page.on('response', response => {
          const url = new URL(response.url());
          if (url.pathname.startsWith('/assets/')) assetResponses.push({ path:url.pathname, encoding:response.headers()['content-encoding'] || 'identity' });
          if (url.pathname.startsWith('/api/')) responses.push({ pathname: url.pathname, status: response.status() });
          if (url.pathname === '/api/stock/kline') {
            klineResponseTasks.push(response.json().then(body => klineResponseMetadata.push({
              status: response.status(),
              dataStatus: body?.dataStatus || null,
              source: body?.source || null,
              reason: body?.reason || body?.error || null,
              updatedAt: body?.updatedAt || null,
              recordCount: Array.isArray(body?.data) ? body.data.length : 0,
            })).catch(() => klineResponseMetadata.push({ status: response.status(), dataStatus: 'unreadable', recordCount: 0 })));
          }
        });
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));
        const cdp = await context.newCDPSession(page);
        const timeline = [];
        if (traceLayout) cdp.on('Tracing.dataCollected', event => timeline.push(...event.value.filter(row => ['Layout', 'UpdateLayoutTree', 'ParseHTML', 'EvaluateScript', 'FunctionCall'].includes(row.name))));
        await cdp.send('Network.enable');
        if (networkProfile === 'weak') {
          await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 750 * 1024 / 8, uploadThroughput: 250 * 1024 / 8 });
        }
        if (cpuRate > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        for (const temperature of ['cold', 'warm']) {
          if (traceLayout) {
            timeline.length = 0;
            await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.stack', transferMode: 'ReportEvents' });
          }
          if (profileCpu) {
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 2000 });
            await cdp.send('Performance.enable');
            await cdp.send('Profiler.start');
          }
          console.log(`benchmark sample start: viewport=${viewport.width} run=${run + 1} mode=${temperature}`);
          requests.length = 0;
          assetResponses.length = 0;
          apiTimings.length = 0;
          klineResponseMetadata.length = 0;
          klineResponseTasks.length = 0;
          await page.goto(base + '/?market=stocks&workspace=stock-quotes&instrument=AAPL&timeframe=1d', { waitUntil: 'commit' });
          console.log(`benchmark navigation committed: viewport=${viewport.width} run=${run + 1} mode=${temperature}`);
          await waitForPageCondition(page, () => !!window.mm_authReady && window.mm_isLoggedIn === true
            && document.getElementById('market-workspace-shell')?.dataset.marketScope === 'stocks'
            && document.getElementById('market-workspace-shell')?.dataset.workspace === 'stock-quotes', 'workspace-ready')
            .catch(error => reportWaitFailure('workspace-ready', error));
          const shellReadyMs = await page.evaluate(() => performance.now());
          const paintedShellReadyTask = page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
          paintedShellReadyTask.catch(() => {});
          console.log(`benchmark workspace ready: viewport=${viewport.width} run=${run + 1} mode=${temperature} shell=${Math.round(shellReadyMs)}ms`);
          await waitForPageCondition(page, () => ['ready', 'empty', 'failed'].includes(document.getElementById('stock-chart-card')?.dataset.klineState)
            && document.getElementById('stock-chart-card')?.getAttribute('aria-busy') !== 'true'
            && !!window.MoneyTradingChart, 'chart-settled')
            .catch(error => reportWaitFailure('chart-settled', error));
          const chartReadyMs = await page.evaluate(() => performance.now());
          const paintedShellReadyMs = await paintedShellReadyTask;
          let layoutDiagnostics;
          if (traceLayout) {
            const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
            await cdp.send('Tracing.end');
            await complete;
            layoutDiagnostics = summarizeTimeline(timeline);
          }
          let cpuDiagnostics;
          if (profileCpu) {
            const { profile } = await cdp.send('Profiler.stop');
            const { metrics } = await cdp.send('Performance.getMetrics');
            cpuDiagnostics = { ...summarizeCpuProfile(profile), metrics: metrics.filter(row => ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'Nodes'].includes(row.name)) };
          }
          await Promise.allSettled(klineResponseTasks);
          const auxiliaryPendingAtChart = auxiliaryPaths.map(pathname => ({
            pathname,
            requestStarted: requests.some(request => request.pathname === pathname),
            responsePending: [...pendingAuxiliaryReleases].some(gate => gate.pathname === pathname),
          }));
          if (gateAuxiliaryRequests) {
            assert.ok(auxiliaryPendingAtChart.some(row => row.responsePending),
              'chart must settle while at least one stock auxiliary response is still held');
          }
          const chartResult = await page.evaluate(() => {
            const resources = performance.getEntriesByType('resource');
            return {
              phaseMarks: performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('moneymoney:'))
                .map(entry => ({ name: entry.name, atMs: Math.round(entry.startTime * 100) / 100 })),
              chartBundleResources: resources.filter(row => new URL(row.name).pathname.includes('/workspace-charts.'))
                .map(row => ({ startTime: row.startTime, responseEnd: row.responseEnd, duration: row.duration, transferSize: row.transferSize })),
            };
          });
          await releaseAuxiliaryRequests();
          if (requests.some(request => request.pathname === '/api/stock/indices')) {
            await waitForPageCondition(page, () => performance.getEntriesByType('resource').some(row => {
              try { return new URL(row.name).pathname === '/api/stock/indices' && row.responseEnd > 0; } catch { return false; }
            }), 'stock-indices-settled').catch(error => reportWaitFailure('stock-indices-settled', error));
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
          }
          const result = await page.evaluate(({ shellReadyMs, paintedShellReadyMs, chartReadyMs }) => {
            const resources = performance.getEntriesByType('resource');
            const js = resources.filter(row => /\.js(?:\?|$)/.test(row.name));
            const startupCompatibility = js.filter(row => {
              const pathname = new URL(row.name).pathname;
              return pathname.includes('/dashboard-startup-') && !pathname.includes('dashboard-startup-bootstrap.')
                && !pathname.includes('dashboard-startup-runtime.');
            });
            const startupStarts = startupCompatibility.map(row => row.startTime);
            const startupEnds = startupCompatibility.map(row => row.responseEnd);
            const navigation = performance.getEntriesByType('navigation')[0];
            return { shellReadyMs, paintedShellReadyMs, chartReadyMs, chartState: document.getElementById('stock-chart-card')?.dataset.klineState,
              chartMessage: document.getElementById('stock-chart-card')?.innerText.slice(0, 500) || '',
              bytes: resources.reduce((sum, row) => sum + row.transferSize, 0), jsBytes: js.reduce((sum, row) => sum + row.transferSize, 0),
              jsResources: js.map(row => ({ path: new URL(row.name).pathname, startTime: row.startTime, duration: row.duration, transferSize: row.transferSize })),
              dashboardStartupCompatibility: {
                resourceCount: startupCompatibility.length,
                transferBytes: startupCompatibility.reduce((sum, row) => sum + row.transferSize, 0),
                requestStartSpreadMs: startupStarts.length > 1 ? Math.max(...startupStarts) - Math.min(...startupStarts) : 0,
                downloadSpanMs: startupStarts.length ? Math.max(...startupEnds) - Math.min(...startupStarts) : 0,
              },
              domContentLoadedMs: navigation?.domContentLoadedEventEnd || null,
              navigationTiming: navigation ? { responseStart: navigation.responseStart, responseEnd: navigation.responseEnd, domInteractive: navigation.domInteractive, domContentLoadedEventEnd: navigation.domContentLoadedEventEnd } : null,
              startupResources: resources.filter(row => ['script', 'link', 'fetch'].includes(row.initiatorType)).map(row => ({ path:new URL(row.name).pathname, startTime:row.startTime, responseStart:row.responseStart, responseEnd:row.responseEnd, transferSize:row.transferSize })),
              };
          }, { shellReadyMs, paintedShellReadyMs, chartReadyMs });
          result.phaseMarks = chartResult.phaseMarks;
          const taskObservations=await page.evaluate(()=>({longTaskSupported:window.__MM_LOADING_LONG_TASK_SUPPORTED__===true,longTasks:window.__MM_LOADING_LONG_TASKS__||null}));Object.assign(result,taskObservations);
          if (cpuDiagnostics) result.cpuDiagnostics = cpuDiagnostics;
          if (layoutDiagnostics) result.layoutDiagnostics = layoutDiagnostics;
          result.loadingPhases=summarizeLoadingPhases(result);
          result.chartBundleResources = chartResult.chartBundleResources;
          result.klineResponseMetadata = [...klineResponseMetadata];
          result.auxiliaryPendingAtChart = auxiliaryPendingAtChart;
          result.apiRequestDetails = [...requests];
          result.assetResponses = [...assetResponses];
          result.apiTimings = [...apiTimings];
          result.apiRequests = requests.map(request => request.pathname);
          result.apiRequestCounts = Object.fromEntries([...new Set(result.apiRequests)].map(path => [path, result.apiRequests.filter(request => request === path).length]));
          assert.deepEqual(pageErrors, [], 'stock chart navigation must not hide browser runtime errors');
          assert.ok(result.apiRequests.includes('/api/stock/kline'), 'chart readiness must follow the scoped K-line request');
          const prefetchStart = result.phaseMarks.find(mark => mark.name === 'moneymoney:stock-kline-prefetch-start');
          const coreReady = result.phaseMarks.find(mark => mark.name === 'moneymoney:dashboard-core-ready');
          assert.ok(prefetchStart && coreReady && prefetchStart.atMs < coreReady.atMs,
            'the authenticated K-line request must start before dashboard core readiness');
          const chartRequest = requests.find(request => request.pathname === '/api/stock/kline');
          assert.equal(new URL(chartRequest.url, base).searchParams.get('period'), '1d',
            'the prefetched request must match the deep-linked chart timeframe');
          result.prefetchStartedBeforeCore = true;
          console.log(`benchmark sample ready: viewport=${viewport.width} run=${run + 1} mode=${temperature} chart=${Math.round(result.chartReadyMs)}ms`);
          samples.push({ viewport: viewport.width, run, temperature, ...result });
        }
        await context.close();
        await browser.close();
        browser = null;
      }
    }
    for (const viewport of benchmarkViewports.map(item => item.width)) for (let run = 0; run < benchmarkRunCount; run++) {
      const cold = samples.find(row => row.viewport === viewport && row.run === run && row.temperature === 'cold');
      const warm = samples.find(row => row.viewport === viewport && row.run === run && row.temperature === 'warm');
      if (!gateAuxiliaryRequests) assert.ok(warm.jsBytes < cold.jsBytes * .2, 'warm hashed scripts must hit browser cache');
      for (const sample of [cold, warm]) for (const pathname of ['/api/auth/status', '/api/stock/kline', '/api/watchlist', '/api/paper/positions']) {
        assert.equal(sample.apiRequestCounts[pathname], 1,
          `${pathname} must be requested once during ${sample.temperature} stock-chart navigation; observed: ${JSON.stringify(sample.apiRequestDetails.filter(request => request.pathname === pathname))}`);
      }
    }
    const loadingBudget=require('./lib/loading-budget.cjs').assessLoadingBudget(samples);
    console.log(JSON.stringify({ data: 'real application providers; source status and reason captured per sample', loadingBudget, gateAuxiliaryRequests, cpuRate, networkProfile, latencyMs: networkProfile === 'weak' ? 80 : 0, downloadKbps: networkProfile === 'weak' ? 750 : null, samples, medians: benchmarkViewports.flatMap(viewport => ['cold', 'warm'].map(temperature => { const group = samples.filter(row => row.viewport === viewport.width && row.temperature === temperature); return { viewport: viewport.width, temperature, shellReadyMs: median(group.map(row => row.shellReadyMs)), chartReadyMs: median(group.map(row => row.chartReadyMs)), jsBytes: median(group.map(row => row.jsBytes)), compatibilityRequestStartSpreadMs: median(group.map(row => row.dashboardStartupCompatibility.requestStartSpreadMs)), compatibilityDownloadSpanMs: median(group.map(row => row.dashboardStartupCompatibility.downloadSpanMs)) }; })) }, null, 2));
    if(process.env.MONEYMONEY_ENFORCE_LOADING_BUDGET==='true')assert.equal(loadingBudget.status,'passed','loading budget exceeded or missing sufficient samples; review source latency and browser trace');
  } finally {
    await releaseAuxiliaryRequests();
    try {
      if (browser) await browser.close();
    } finally {
      try {
        await stopBenchmarkChild(child);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
