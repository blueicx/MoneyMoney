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

function get(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 5000 }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('timeout')));
  });
}

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
    const realStatus = await get('/api/real-trading/status');
    if (realStatus.status !== 200 || JSON.parse(realStatus.body).data.enabled !== false) throw new Error(`real trading boundary failed: ${realStatus.status} ${realStatus.body}`);
    console.log('Web smoke passed: health probes and real-trading disabled boundary');
  } finally {
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 1000).unref();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
