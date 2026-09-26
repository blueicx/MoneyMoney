const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
let commit = String(process.env.GITHUB_SHA || process.env.MONEYMONEY_BUILD_ID || '').trim();
if (!commit) {
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { commit = 'unknown'; }
}
const info = {
  version: require(path.join(root, 'package.json')).version,
  commit: /^[0-9a-f]{7,64}$/i.test(commit) ? commit.toLowerCase() : 'unknown',
  builtAt: new Date().toISOString(),
};
const output = path.join(root, 'dist', 'build-info.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
process.stdout.write(`Build identity written: ${info.commit}\n`);
