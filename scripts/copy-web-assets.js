#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'web', 'public');
const target = path.join(root, 'dist', 'web', 'public');

if (!fs.existsSync(source)) {
  console.error(`Missing web asset source: ${source}`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

const assets = path.join(target, 'assets');
fs.mkdirSync(assets, { recursive: true });
const manifest = {};
function emit(name, body, extension) {
  const content = Buffer.from(body);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const relative = `/assets/${name}.${hash.slice(0, 16)}.${extension}`;
  const file = path.join(target, relative);
  fs.writeFileSync(file, content);
  fs.writeFileSync(file + '.gz', zlib.gzipSync(content, { level: 9 }));
  fs.writeFileSync(file + '.br', zlib.brotliCompressSync(content));
  manifest[relative] = { sha256: hash, bytes: content.length };
  return relative;
}

// Extract declarations only, keeping state in its existing global scope. Classic
// scripts intentionally preserve legacy inline handlers and cross-module state.
const modules = { guru: [], research: [], ai: [] };
function splitWorkspaces(code) {
  const ast = ts.createSourceFile('dashboard.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const changes = [];
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name) continue;
    const name = node.name.text;
    const group = /guru/i.test(name) ? 'guru' : /aiRunner/i.test(name) ? 'ai'
      : /^(?:loadResearch|renderResearch|createResearch|addResearch|openEventResearch)/.test(name) ? 'research' : null;
    if (!group) continue;
    modules[group].push(code.slice(node.getStart(ast), node.end));
    changes.push({ start: node.getStart(ast), end: node.end, body: `function ${name}(...args) { return window.MoneyWorkspaceModules.invoke('${group}', '${name}', args); }` });
  }
  for (const change of changes.reverse()) code = code.slice(0, change.start) + change.body + code.slice(change.end);
  return code;
}

let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
let number = 0;
html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<link rel="stylesheet" href="${emit(`dashboard-style-${++number}`, css, 'css')}">`);
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attributes, code) => {
  if (/\bsrc\s*=/.test(attributes) || Buffer.byteLength(code) < 1500) return tag;
  return `<script${attributes} src="${emit(`dashboard-${++number}`, splitWorkspaces(code), 'js')}"></script>`;
});
modules.guru.push(fs.readFileSync(path.join(source, 'guru-replay.js'), 'utf8'));
modules.research.push(fs.readFileSync(path.join(source, 'action-research-workspace.js'), 'utf8'));
const moduleUrls = Object.fromEntries(Object.entries(modules).map(([group, code]) => [group, emit(`workspace-${group}`, code.join('\n'), 'js')]));
moduleUrls.contracts = emit('workspace-contracts', fs.readFileSync(path.join(source, 'contracts-workspace.js')), 'js');
html = html.replace(/<script\b[^>]*src="\/(?:guru-replay|action-research-workspace|contracts-workspace)\.js[^"\s]*"[^>]*><\/script>/g, '');

const fingerprinted = new Map();
html = html.replace(/(src|href)="(\/[^"?]+\.(?:js|css))(?:\?[^"\s]*)?"/g, (tag, attribute, url) => {
  if (url.startsWith('/assets/')) return tag;
  const file = path.join(source, url);
  if (!fs.existsSync(file)) throw new Error(`Unknown dashboard resource ${url}`);
  if (!fingerprinted.has(url)) fingerprinted.set(url, emit(path.basename(url).replace(/\.(js|css)$/, ''), fs.readFileSync(file), path.extname(url).slice(1)));
  return `${attribute}="${fingerprinted.get(url)}"`;
});
const loader = fs.readFileSync(path.join(source, 'modules', 'workspace-loader.js'), 'utf8').replace('__WORKSPACE_MANIFEST__', JSON.stringify(moduleUrls));
html = html.replace('</head>', `<script src="${emit('workspace-loader', loader, 'js')}"></script>\n</head>`);
fs.writeFileSync(path.join(target, 'index.html'), html);
fs.writeFileSync(path.join(target, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));
for (const page of ['index.html', 'login.html']) {
  const file = path.join(target, page);
  const content = fs.readFileSync(file);
  fs.writeFileSync(file + '.gz', zlib.gzipSync(content, { level: 9 }));
  fs.writeFileSync(file + '.br', zlib.brotliCompressSync(content));
}
console.log(`Web assets built: ${Object.keys(manifest).length} hashed/precompressed resources; guru, research, AI and contracts load on demand`);
