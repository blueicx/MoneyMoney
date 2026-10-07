const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('container template runs non-root, preserves data and requires owner secrets, with loopback host networking',()=>{
 const docker=fs.readFileSync('Dockerfile','utf8'),compose=fs.readFileSync('compose.yaml','utf8'),ignore=fs.readFileSync('.dockerignore','utf8');
 assert.match(docker,/FROM node:24-bookworm-slim AS build/);assert.match(docker,/npm ci/);assert.match(docker,/npm prune --omit=dev/);assert.match(docker,/USER node/);
 assert.match(docker,/HEALTHCHECK/);assert.match(docker,/CMD \["node", "dist\/web\/server.js"\]/);assert.doesNotMatch(docker,/COPY \. /);
 assert.match(ignore,/^\*\*$/m);assert.doesNotMatch(ignore,/!\.env|!data|!\.git/);
 assert.match(compose,/network_mode: host/);assert.match(compose,/APP_HOST: 127\.0\.0\.1/);assert.match(compose,/moneymoney-data:\/app\/data/);
 for(const field of ['MONEYMONEY_LOGIN_USER','MONEYMONEY_LOGIN_PASS','MONEYMONEY_JWT_SECRET','MONEYMONEY_BUILD_ID'])assert.match(compose,new RegExp(field+':.*\\$\\{'+field+':\\?'));
 assert.match(compose,/AI_PAPER_TRADING_ENABLED: "false"/);assert.match(compose,/TELEGRAM_POLLING_ENABLED: "false"/);
});
