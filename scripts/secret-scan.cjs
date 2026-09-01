const { execFileSync } = require('node:child_process');

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const patterns = [
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/, // Telegram Bot API token
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:API_KEY|API_SECRET|PRIVATE_KEY|BOT_TOKEN)[ \t]*[:=][ \t]*["']?(?!your_|test_|example|replace_with|process\.env|\$\{)(?![A-Za-z0-9_./:+=-]*replace_with)[A-Za-z0-9_./:+=-]{16,}/i,
];
const ignored = new Set(['.env', '.env.local']);
const fs = require('node:fs');
const findings = [];
for (const file of files) {
  if (ignored.has(file) || file.includes('node_modules/') || /\.(?:exe|png|jpg|jpeg|gif|zip|mp4|pdf)$/i.test(file) || !fs.existsSync(file)) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const pattern of patterns) if (pattern.test(text)) findings.push(file);
}
if (findings.length) {
  console.error(`Potential secrets found in tracked files:\n${[...new Set(findings)].join('\n')}`);
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} tracked files checked.`);
