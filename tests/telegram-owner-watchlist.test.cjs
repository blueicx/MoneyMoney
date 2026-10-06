const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-owner-watchlist-'));
process.env.MONEYMONEY_DATA_DIR=root;
const {TelegramCommandCenterStore}=require('../dist/features/telegram-command-center');
const {UnifiedAlertStore}=require('../dist/features/unified-alerts');
const {stateStore}=require('../dist/storage/sqlite-state');
test.after(()=>{stateStore.close();fs.rmSync(root,{recursive:true,force:true});});
const normalize=id=>/^us[A-Z]+$/.test(id)?'stock:us:'+id.slice(2):/^(stock|crypto|option|prediction):[^:]+:.+$/.test(id)?id:null;
test('owner Telegram and web share additions and removals; migration does not resurrect deleted legacy records',()=>{
  const file=path.join(root,'owner.json'),web=new UnifiedAlertStore({keyPrefix:'sync-test'}),tg=new TelegramCommandCenterStore(file);
  tg.addWatchlistMarket('123','usAAPL');web.addWatchlist('stock:us:MU');
  assert.equal(typeof tg.bindOwnerWatchlist,'function');
  const binding={isOwnerChat:id=>id==='123',normalize,list:()=>web.listWatchlist(),add:id=>web.addWatchlist(id),remove:id=>web.removeWatchlist(id)};
  tg.bindOwnerWatchlist(binding);
  assert.deepEqual(tg.listWatchlist('123').sort(),['stock:us:AAPL','stock:us:MU']);
  assert.equal(tg.addWatchlistMarket('123','usAAPL'),false);
  tg.addWatchlistMarket('123','stock:us:SNDK');assert(web.listWatchlist().includes('stock:us:SNDK'));
  web.removeWatchlist('stock:us:MU');assert(!tg.listWatchlist('123').includes('stock:us:MU'));
  assert.equal(tg.removeWatchlistMarket('123','usAAPL'),true);assert(!web.listWatchlist().includes('stock:us:AAPL'));
  const restarted=new TelegramCommandCenterStore(file);restarted.bindOwnerWatchlist(binding);
  assert.deepEqual(restarted.listWatchlist('123'),['stock:us:SNDK']);
});
test('non-owner and group chats never inherit or mutate the owner web watchlist',()=>{
  const web=new UnifiedAlertStore({keyPrefix:'private-test'}),tg=new TelegramCommandCenterStore(path.join(root,'private.json'));
  web.addWatchlist('stock:us:MU');assert.equal(typeof tg.bindOwnerWatchlist,'function');
  tg.bindOwnerWatchlist({isOwnerChat:()=>false,normalize,list:()=>web.listWatchlist(),add:id=>web.addWatchlist(id),remove:id=>web.removeWatchlist(id)});
  assert.deepEqual(tg.listWatchlist('456'),[]);tg.addWatchlistMarket('456','stock:us:SNDK');tg.addWatchlistMarket('-123','stock:us:AAPL');
  assert.deepEqual(web.listWatchlist(),['stock:us:MU']);
});
test('server uses current-chat store exclusively, without copying private web watches to arbitrary Telegram chats',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/web/server.ts'),'utf8');
  const scoped=source.slice(source.indexOf('function telegramScopedWatchIds('),source.indexOf('function telegramPendingReply('));
  assert(!scoped.includes('unifiedAlertStore.listWatchlist()'));
  assert.match(source,/telegramCommandCenterStore\.bindOwnerWatchlist\(/);
});
