const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const port = 3187;
const child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'web', 'server.js')], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, APP_HOST: '127.0.0.1', APP_PORT: String(port), TELEGRAM_POLLING_ENABLED: 'false', AI_PAPER_TRADING_ENABLED: 'false', PRIVATE_KEY: '', API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => { output += data.toString(); });
child.stderr.on('data', data => { output += data.toString(); });

function request(method, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, timeout: 5000, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, response => {
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
    const home = await get('/');
    if (home.status !== 200 || !home.body.includes('AI 模型接口') || !home.body.includes('testAiProvider')) throw new Error(`AI settings UI missing: ${home.status}`);
    const settings = await get('/api/settings');
    const settingsBody = JSON.parse(settings.body);
    if (settings.status !== 200 || !settingsBody.ai?.openrouter || !settingsBody.ai?.groq) throw new Error(`AI settings status failed: ${settings.status} ${settings.body}`);
    if ('apiKey' in settingsBody.ai.openrouter || 'apiKey' in settingsBody.ai.groq) throw new Error('AI settings leaked an API key');
    const secretAttempt = await request('POST', '/api/settings', { openRouterApiKey: 'smoke-secret', groqApiKey: 'smoke-secret' });
    if (secretAttempt.status !== 200) throw new Error(`AI settings whitelist failed: ${secretAttempt.status} ${secretAttempt.body}`);
    const settingsAfterSecretAttempt = JSON.parse((await get('/api/settings')).body);
    if ('openRouterApiKey' in settingsAfterSecretAttempt.data || 'groqApiKey' in settingsAfterSecretAttempt.data) throw new Error('AI settings persisted an API key');
    const invalidAiTest = await request('POST', '/api/ai/test', { chain: 'invalid' });
    if (invalidAiTest.status !== 400) throw new Error(`AI test validation failed: ${invalidAiTest.status} ${invalidAiTest.body}`);
    const realStatus = await get('/api/real-trading/status');
    if (realStatus.status !== 200 || JSON.parse(realStatus.body).data.enabled !== false) throw new Error(`real trading boundary failed: ${realStatus.status} ${realStatus.body}`);
    console.log('Web smoke passed: health, AI settings redaction, AI test validation, and real-trading disabled boundary');
  } finally {
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 1000).unref();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
