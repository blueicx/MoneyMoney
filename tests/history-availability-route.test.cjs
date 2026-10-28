const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const source = fs.readFileSync('src/web/server.ts','utf8');
const start = source.indexOf('async function readHistoricalBars('), end = source.indexOf("app.get('/api/data/history'",start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpile(source.slice(start,end), { target:ts.ScriptTarget.ES2022 });
test('historical route forwards explicit observed-time basis and rejects unknown values', async () => {
  let received;
  const ctx = {MARKET_IDS:['stocks'],dataLakeCatalog:{queryBarsAsOf:async input=>{received=input;return {rows:[],dataStatus:'unavailable',source:null,updatedAt:null};}}};
  vm.createContext(ctx);vm.runInContext(compiled,ctx);
  const run = async availability => {const out={};const res={status(code){out.code=code;return this;},json(body){out.body=body;return this;}};
    await ctx.readHistoricalBars({query:{market:'stocks',instrument:'AAPL',timeframe:'1d',asOf:'2026-01-01T00:00:00Z',availability}},res);return out;};
  const good=await run('observed');assert.equal(received.availability,'observed');assert.equal(good.body.availability,'observed');
  received=null;const bad=await run('other');assert.equal(bad.code,400);assert.equal(received,null);
  const legacy=await run(undefined);assert.equal(legacy.body.availability,'published');
});
