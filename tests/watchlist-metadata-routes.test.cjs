const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
test('private watchlist metadata API validates writes, conflicts and undo without changing legacy IDs', async()=>{
  const {createWatchlistMetadataRouter}=require('../src/web/watchlist-metadata-routes');
  const {WatchlistMetadataStore}=require('../src/features/watchlist-metadata');
  const {SQLiteStateStore}=require('../src/storage/sqlite-state');
  const express=require('express'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-watch-api-'));
  const db=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir),ids=['stock:us:AAPL'];
  const store=new WatchlistMetadataStore(db,()=>ids),app=express();app.use(express.json());
  app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest'};next();});
  app.use('/api/watchlist/metadata',createWatchlistMetadataRouter(store));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/watchlist/metadata',headers={'x-role':'admin','content-type':'application/json'};
  const post=(url,body,h=headers)=>fetch(base+url,{method:'POST',headers:h,body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base)).status,403);
    assert.equal((await post('',{revision:0,changes:[]},{'content-type':'application/json'})).status,403);
    const read=await fetch(base,{headers});assert.match(read.headers.get('cache-control'),/no-store/);
    const saved=await post('',{revision:0,groups:[{id:'value',name:'价值'}],changes:[{instrument:ids[0],groupId:'value',tags:['长期']}]});
    assert.equal(saved.status,200);const {data}=await saved.json();assert.ok(data.operationId);
    assert.equal((await post('',{revision:0,changes:[{instrument:ids[0],reason:'迟到'}]})).status,409);
    assert.equal((await post('',{revision:1,changes:[{instrument:ids[0],budgetUsd:500}]})).status,400);
    assert.equal((await post('/undo',{revision:1,operationId:data.operationId})).status,200);
    assert.equal((await fetch(base,{headers}).then(r=>r.json())).data.items[ids[0]].groupId,null);
    assert.deepEqual(ids,['stock:us:AAPL']);
  } finally {await new Promise(r=>server.close(r));db.close();}
});
