const fs = require('node:fs');
const { Buffer } = require('node:buffer');
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
// Embed the same public identity in the document; diagnostics need no extra API call.
const htmlPath=path.join(root,'dist','web','public','index.html');
if(fs.existsSync(htmlPath)){
  const zlib=require('node:zlib'),existing=fs.readFileSync(htmlPath,'utf8').replace(/<meta\s+name="moneymoney-build"\s+content="[^"]*"\s*\/?\s*>/g,'');
  const html=Buffer.from(existing.replace(/<head>/i,`<head><meta name="moneymoney-build" content="${info.commit}">`));
  fs.writeFileSync(htmlPath,html);fs.writeFileSync(htmlPath+'.gz',zlib.gzipSync(html,{level:9}));fs.writeFileSync(htmlPath+'.br',zlib.brotliCompressSync(html));
}
process.stdout.write(`Build identity written: ${info.commit}\n`);
