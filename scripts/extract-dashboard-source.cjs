const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publicRoot = path.join(root, 'src', 'web', 'public');
const htmlPath = path.join(publicRoot, 'index.html');
const runtimePath = path.join(publicRoot, 'modules', 'dashboard-runtime.js');
const stylesPath = path.join(publicRoot, 'modules', 'dashboard-base.css');
const html = fs.readFileSync(htmlPath, 'utf8');

const runtimeMarker = /<script\b[^>]*\bdata-build-inline="dashboard-runtime"[^>]*><\/script>/i;
const stylesMarker = /<link\b[^>]*\bhref="\/modules\/dashboard-base\.css"[^>]*>/i;
const existingRuntime = fs.existsSync(runtimePath);
const existingStyles = fs.existsSync(stylesPath);

if (runtimeMarker.test(html) || stylesMarker.test(html) || existingRuntime || existingStyles) {
  if (runtimeMarker.test(html) && stylesMarker.test(html) && existingRuntime && existingStyles) {
    const runtime = fs.readFileSync(runtimePath, 'utf8');
    const styles = fs.readFileSync(stylesPath, 'utf8');
    if (runtime.length > 500 * 1024 && styles.length > 80 * 1024) {
      console.log('Dashboard source extraction already complete; verified runtime and stylesheet.');
      process.exit(0);
    }
  }
  throw new Error('Dashboard source extraction is partially present or destinations are not verified; refusing to overwrite.');
}

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter((match) => !/\bsrc\s*=/.test(match[1]) && Buffer.byteLength(match[2], 'utf8') > 500 * 1024);
const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)]
  .filter((match) => Buffer.byteLength(match[2], 'utf8') > 80 * 1024);

if (scripts.length !== 1 || styles.length !== 1) {
  throw new Error(`Expected one large inline runtime and stylesheet; found ${scripts.length} and ${styles.length}.`);
}
if (!fs.existsSync(path.dirname(runtimePath))) throw new Error('Dashboard modules directory is missing.');

const runtime = scripts[0][2].replace(/^[\t ]+(?=\r?$)/gm, '');
const stylesheet = styles[0][2].replace(/^[\t ]+(?=\r?$)/gm, '');
const nextHtml = html
  .replace(scripts[0][0], '<script data-build-inline="dashboard-runtime" src="/modules/dashboard-runtime.js"></script>')
  .replace(styles[0][0], '<link rel="stylesheet" href="/modules/dashboard-base.css">');

fs.writeFileSync(runtimePath, runtime, 'utf8');
fs.writeFileSync(stylesPath, stylesheet, 'utf8');
fs.writeFileSync(htmlPath, nextHtml, 'utf8');
console.log(`Extracted dashboard runtime (${Buffer.byteLength(runtime, 'utf8')} bytes) and styles (${Buffer.byteLength(stylesheet, 'utf8')} bytes).`);
