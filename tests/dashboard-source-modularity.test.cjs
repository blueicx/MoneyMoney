const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'src', 'web', 'public');
const htmlPath = path.join(publicRoot, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('source dashboard entry is at most 200 KiB and references extracted runtime and base styles', () => {
  const bytes = Buffer.byteLength(html);
  assert.ok(bytes <= 200 * 1024, `source index.html is ${bytes} bytes`);
  assert.match(html, /<script\b[^>]*data-build-inline="dashboard-runtime"[^>]*src="\/modules\/dashboard-runtime\.js"/);
  assert.match(html, /<link\b[^>]*href="\/modules\/dashboard-base\.css"/);
  assert.ok(fs.existsSync(path.join(publicRoot, 'modules', 'dashboard-runtime.js')));
  assert.ok(fs.existsSync(path.join(publicRoot, 'modules', 'dashboard-base.css')));
});

test('asset builder expands the marked classic runtime before applying workspace function splitting', () => {
  const builder = fs.readFileSync(path.join(root, 'scripts', 'copy-web-assets.js'), 'utf8');
  const transformPath = path.join(root, 'scripts', 'dashboard-source-transform.cjs');
  assert.ok(fs.existsSync(transformPath), 'dashboard source transform helper must exist');
  const transform = fs.readFileSync(transformPath, 'utf8');
  assert.match(transform, /dashboard-runtime\.js/);
  assert.match(transform, /data-build-inline/);
  assert.match(builder, /expandDashboardRuntime\(/);
  assert.match(builder, /splitWorkspaces\(code\)/);
  assert.match(builder, /workspace-loader/);
});

test('runtime expansion treats JavaScript replacement tokens as literal source', () => {
  const { expandDashboardRuntime } = require(path.join(root, 'scripts', 'dashboard-source-transform.cjs'));
  const runtimePath = path.join(publicRoot, 'modules', 'dashboard-runtime.js');
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  const marker = '<script data-build-inline="dashboard-runtime" src="/modules/dashboard-runtime.js"></script>';
  const expanded = expandDashboardRuntime(html, publicRoot);

  assert.ok(runtime.includes('$&'), 'fixture must exercise JavaScript replacement-token syntax');
  assert.equal(expanded.includes(marker), false, 'source marker must be replaced exactly once');
  assert.equal(
    Buffer.byteLength(expanded),
    Buffer.byteLength(html) - Buffer.byteLength(marker) + Buffer.byteLength('<script></script>') + Buffer.byteLength(runtime),
  );
});

test('legacy source assertions can inspect the complete entry without changing the shipped HTML', () => {
  const reconstructed = require('./helpers/dashboard-source.cjs').readDashboardSource();
  assert.match(reconstructed, /function translateStrategyName\(/);
  assert.match(reconstructed, /:root\s*\{[\s\S]*--bg:/);
  assert.ok(Buffer.byteLength(html) <= 200 * 1024);
});

test('extracted source files do not introduce trailing whitespace', () => {
  for (const name of ['dashboard-runtime.js', 'dashboard-base.css']) {
    const source = fs.readFileSync(path.join(publicRoot, 'modules', name), 'utf8');
    assert.doesNotMatch(source, /[\t ]+$/m, `${name} must pass git diff --check`);
  }
});
