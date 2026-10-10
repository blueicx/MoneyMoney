const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_MARKER = /<script\b([^>]*)\bdata-build-inline="dashboard-runtime"([^>]*)><\/script>/gi;

function expandDashboardRuntime(html, sourceRoot) {
  const matches = [...html.matchAll(RUNTIME_MARKER)];
  if (matches.length !== 1) {
    throw new Error(`Expected one marked dashboard runtime script, found ${matches.length}`);
  }

  const runtimePath = path.join(sourceRoot, 'modules', 'dashboard-runtime.js');
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  if (!runtime.trim()) throw new Error('Dashboard runtime source is empty');

  return html.replace(matches[0][0], () => `<script>${runtime}</script>`);
}

module.exports = { expandDashboardRuntime };
