const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('CI uses the verified production-compatible Node line and the lockfile-producing npm version',()=>{
 for(const file of ['.github/workflows/ci.yml','.github/workflows/production-canary.yml']){const workflow=fs.readFileSync(file,'utf8');assert.match(workflow,/node-version:\s*['"]?22\.22\.1\b/,file+' must support jsdom/undici and match the verified VPS Node runtime');assert.match(workflow,/npm install --global npm@11\.17\.0/,file+' must not reinterpret an npm11 lock with npm10');assert.ok(workflow.indexOf('npm install --global npm@11.17.0')<workflow.indexOf('npm ci'),file+' npm pin precedes installation');}
});
