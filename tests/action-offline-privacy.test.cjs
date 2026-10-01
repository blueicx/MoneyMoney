const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('private signal, scenario and evidence responses never enter offline cache', async () => {
  const events = {}, stored=[];
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/web/public/sw.js'),'utf8'),{
    self:{ addEventListener:(event,fn)=>{ events[event]=fn; },registration:{ active:true } },URL,Response,
    fetch:async()=>new Response(JSON.stringify({ private:true }),{ status:200 }),
    caches:{ open:async()=>({ put:async request=>stored.push(request.url) }),match:async()=>null },
  });
  for (const endpoint of ['/api/signals/quality','/api/evidence','/api/evidence/changes','/api/scenarios','/api/watchlist/action-center','/api/research/experiments','/api/portfolio/analytics']) {
    let response;
    events.fetch({ request:{ method:'GET',url:'https://example.test'+endpoint,mode:'cors' },respondWith:promise=>{ response=promise; } });
    await response; await new Promise(resolve=>setImmediate(resolve));
  }
  assert.deepEqual(stored,[]);
});
