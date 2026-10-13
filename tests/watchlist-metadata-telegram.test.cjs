const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
test('Telegram groups use the same administrator metadata and reject non-owner or cross-market changes',()=>{
 const {handleWatchlistMetadataCommand}=require('../src/features/watchlist-metadata-telegram');
 const {WatchlistMetadataStore}=require('../src/features/watchlist-metadata'),{SQLiteStateStore}=require('../src/storage/sqlite-state');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-watch-tg-')),db=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir);
 const ids=['stock:us:AAPL','crypto:binance:BTCUSDT'],store=new WatchlistMetadataStore(db,()=>ids);
 try{
 store.apply(0,{groups:[{id:'value',name:'<价值>'}],changes:[]});
 const execute=(args,owner=true)=>handleWatchlistMetadataCommand(store,{isOwner:owner,scope:'stocks',args});
 assert.match(execute([]),/&lt;价值&gt;/);assert.doesNotMatch(execute([]),/BTCUSDT/);
 assert.match(execute(['move','value',ids[0]],false),/管理员/);assert.equal(store.read().revision,1);
 assert.match(execute(['move','value',ids[1]]),/当前市场/);assert.equal(store.read().revision,1);
 assert.match(execute(['move','value',ids[0]]),/已同步/);assert.equal(store.read().items[ids[0]].groupId,'value');
 assert.match(execute(['tag','财报',ids[0]]),/已同步/);assert.deepEqual(store.read().items[ids[0]].tags,['财报']);
 }finally{db.close();}
});
