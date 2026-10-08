const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const port = 3187;
const child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'web', 'server.js')], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    APP_HOST: '127.0.0.1',
    APP_PORT: String(port),
    MONEYMONEY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(),'mm-web-smoke-')),
    TELEGRAM_POLLING_ENABLED: 'false',
    AI_PAPER_TRADING_ENABLED: 'false',
    PRIVATE_KEY: '',
    API_KEY: '',
    MONEYMONEY_LOGIN_USER: 'smoke-owner',
    MONEYMONEY_LOGIN_PASS: 'smoke-test-password-only',
    MONEYMONEY_JWT_SECRET: 'smoke-test-jwt-secret-0123456789abcdef',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => { output += data.toString(); });
child.stderr.on('data', data => { output += data.toString(); });

function request(method, pathname, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, timeout: 5000, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('timeout')));
    if (body) request.write(body);
    request.end();
  });
}

const get = pathname => request('GET', pathname);

(async () => {
  try {
    let live;
    for (let i = 0; i < 30; i += 1) {
      try { live = await get('/api/health/live'); if (live.status === 200) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!live || live.status !== 200) throw new Error(`server did not start\n${output}`);
    const health = await get('/api/health');
    if (health.status !== 200 || !JSON.parse(health.body).ok) throw new Error(`health failed: ${health.status} ${health.body}`);
    const unauthHome = await get('/');
    if (unauthHome.status !== 302 || !String(unauthHome.body).includes('/login?next=')) throw new Error(`login gate redirect failed: ${unauthHome.status}`);
    const unauthSettings = await get('/api/settings');
    if (unauthSettings.status !== 401) throw new Error(`unauthenticated API was not rejected: ${unauthSettings.status}`);
    const login = await request('POST', '/api/auth/login', { username: 'smoke-owner', password: 'smoke-test-password-only' });
    const loginBody = JSON.parse(login.body);
    if (login.status !== 200 || !loginBody.success || !loginBody.token) throw new Error(`login failed: ${login.status} ${login.body}`);
    const authHeaders = { Authorization: `Bearer ${loginBody.token}` };
    const authedGet = pathname => request('GET', pathname, null, authHeaders);
    const authedRequest = (method, pathname, payload) => request(method, pathname, payload, authHeaders);
    const confirmed=await authedRequest('POST','/api/data/instruments/confirm',{market:'stocks',type:'stock',venue:'us',symbol:'AAPL'});
    if(confirmed.status!==200)throw Error('isolated instrument registration failed');
    const markerResponse=await authedGet('/api/paper/chart-markers?market=stocks&instrument=usAAPL');
    const markerEnvelope=JSON.parse(markerResponse.body);
    if(markerResponse.status!==200||markerEnvelope.instrument!=='stock:us:AAPL'||markerEnvelope.market!=='stocks'||!Array.isArray(markerEnvelope.data.unlinked))throw Error('paper chart canonical identity projection failed');
    if((await get('/api/paper/chart-markers?market=stocks&instrument=usAAPL')).status!==401)throw Error('private paper marker API exposed');
    const unsupportedAdjustment=await authedGet('/api/stock/kline?symbol=usAAPL&period=1d&adjustment=forward');
    if(unsupportedAdjustment.status!==422||JSON.parse(unsupportedAdjustment.body).data!==null)throw Error('unverified adjustment must not return transformed prices');
    const unsupportedSettlement=await authedGet('/api/prediction/settlement/Manifold/example');
    const settlementEnvelope=JSON.parse(unsupportedSettlement.body);
    if(unsupportedSettlement.status!==422 || settlementEnvelope.instrument!=='prediction:manifold:example' || settlementEnvelope.source!=='Manifold' || !Number.isFinite(Date.parse(settlementEnvelope.updatedAt)))throw Error('unsupported settlement lost stable identity/source/time envelope');
    const home = await authedGet('/');
    if (home.status !== 200 || !home.body.includes('id="settings-tab"') || !home.body.includes('/assets/auth-client.')) throw new Error(`authenticated dashboard shell missing: ${home.status}`);
    const settings = await authedGet('/api/settings');
    const settingsBody = JSON.parse(settings.body);
    if (settings.status !== 200 || !settingsBody.ai?.openrouter || !settingsBody.ai?.groq) throw new Error(`AI settings status failed: ${settings.status} ${settings.body}`);
    if ('apiKey' in settingsBody.ai.openrouter || 'apiKey' in settingsBody.ai.groq) throw new Error('AI settings leaked an API key');
    const secretAttempt = await authedRequest('POST', '/api/settings', { openRouterApiKey: 'smoke-secret', groqApiKey: 'smoke-secret' });
    if (secretAttempt.status !== 200) throw new Error(`AI settings whitelist failed: ${secretAttempt.status} ${secretAttempt.body}`);
    const settingsAfterSecretAttempt = JSON.parse((await authedGet('/api/settings')).body);
    if ('openRouterApiKey' in settingsAfterSecretAttempt.data || 'groqApiKey' in settingsAfterSecretAttempt.data) throw new Error('AI settings persisted an API key');
    const invalidAiTest = await authedRequest('POST', '/api/ai/test', { chain: 'invalid' });
    if (invalidAiTest.status !== 400) throw new Error(`AI test validation failed: ${invalidAiTest.status} ${invalidAiTest.body}`);
    const realStatus = await authedGet('/api/real-trading/status');
    if (realStatus.status !== 200 || JSON.parse(realStatus.body).data.enabled !== false) throw new Error(`real trading boundary failed: ${realStatus.status} ${realStatus.body}`);
    console.log('Web smoke passed: health, AI settings redaction, AI test validation, and real-trading disabled boundary');
  } finally {
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 1000).unref();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
