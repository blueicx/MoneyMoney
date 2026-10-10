const fs = require('node:fs');
const path = require('node:path');
const { expandDashboardRuntime } = require('../../scripts/dashboard-source-transform.cjs');

const publicRoot = path.join(__dirname, '..', '..', 'src', 'web', 'public');

function readDashboardSource() {
  const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
  const withRuntime = expandDashboardRuntime(html, publicRoot);
  const stylesheet = fs.readFileSync(path.join(publicRoot, 'modules', 'dashboard-base.css'), 'utf8');
  return withRuntime.replace(/<link\b[^>]*\bhref="\/modules\/dashboard-base\.css"[^>]*>/i, () => `<style>${stylesheet}</style>`);
}

module.exports = { readDashboardSource };
