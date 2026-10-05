const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicRoot = path.join(__dirname, '../src/web/public');
const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const styles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
const contractsCss = fs.readFileSync(path.join(publicRoot, 'contracts-workspace.css'), 'utf8');
const formControlRuleStart = styles.indexOf(':where(input:not([type="checkbox"])');
const formControlRuleOpen = styles.indexOf('{', formControlRuleStart);
const formControlRuleClose = styles.indexOf('}', formControlRuleOpen);
const formControlRule = formControlRuleStart >= 0 ? styles.slice(formControlRuleOpen + 1, formControlRuleClose) : '';

test('native buttons, links, and form controls inherit the active MoneyMoney theme', () => {
  assert.ok(/(?:^|[}\n])\s*a\s*\{[^}]*color:\s*var\(--purple\)/s.test(styles), 'unclassed links should use the current theme accent, not browser blue');
  assert.ok(/(?:^|[}\n])\s*button\s*\{[^}]*color:\s*var\(--text\)/s.test(styles), 'plain buttons should use the current theme text');
  assert.ok(/(?:^|[}\n])\s*button\s*\{[^}]*border:[^;]*var\(--border\)/s.test(styles), 'plain buttons should use the current theme border');
  assert.ok(/(?:^|[}\n])\s*button\s*\{[^}]*background:[^;]*var\(--bg-(?:secondary|card)\)/s.test(styles), 'plain buttons should use a theme surface instead of the native white button');
  assert.ok(/color:\s*var\(--text\)/.test(formControlRule), 'text-entry controls should use theme foreground colors');
  assert.ok(/border-color:\s*var\(--border\)/.test(formControlRule), 'text-entry controls should use theme borders');
  assert.ok(/select\s+option\s*\{[^}]*color-scheme:\s*inherit/s.test(styles), 'select menus should follow the active light or dark color scheme');
});

test('news evidence and SEC manager controls have explicit themed component styles', () => {
  assert.ok(/\.source-evidence-card\s*\{[^}]*border:[^;]*var\(--border\)[^}]*background:[^;]*var\(--bg-card\)/s.test(styles), 'news evidence should render as a theme-aware card');
  assert.ok(/\.source-evidence-link\s*\{[^}]*color:\s*var\(--purple\)[^}]*text-decoration:\s*none/s.test(styles), 'news source links should be styled actions rather than raw blue underlined links');
  assert.ok(/\.event-research-actions\s+\.tab\s*\{[^}]*border:[^;]*var\(--border\)[^}]*background:\s*var\(--bg-secondary\)/s.test(styles), 'event actions should read as compact themed controls, not loose text labels');
  assert.ok(/\.link-button\s*\{[^}]*appearance:\s*none[^}]*background:\s*transparent[^}]*color:\s*var\(--purple\)/s.test(styles), 'SEC holder names should not render with a native white button background');
  assert.ok(/#mm-contract-library input,#mm-contract-library select\s*\{[^}]*width:\s*100%[^}]*color:\s*var\(--text\)[^}]*background:[^;]*var\(--bg-secondary\)/s.test(contractsCss), 'contract inputs should retain responsive sizing and theme-aware appearance');
  assert.ok(!/(?:background|color):\s*(?:#fff(?:fff)?\b|white\b|#000(?:000)?\b|black\b)/i.test(contractsCss), 'contract controls must inherit theme colors instead of hard-coded light colors');
});
