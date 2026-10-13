const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-watch-meta-')); process.env.MONEYMONEY_DATA_DIR = root;
const { SQLiteStateStore } = require('../dist/storage/sqlite-state');
const { WatchlistMetadataStore } = require('../dist/features/watchlist-metadata');
test('metadata persists across connections, refuses stale writes and undo cannot overwrite a subsequent edit', () => {
  const database = path.join(root, 'shared.sqlite'), first = new SQLiteStateStore(database, root), second = new SQLiteStateStore(database, root);
  const ids = ['stock:us:AAPL', 'crypto:binance:BTCUSDT'];
  const a = new WatchlistMetadataStore(first, () => ids), b = new WatchlistMetadataStore(second, () => ids);
  try {
    const saved = a.apply(0, {groups:[{id:'research',name:'研究'}], changes:[{instrument:ids[0],groupId:'research',tags:['财报'],reason:'观察现金流',observeOn:'2026-11-01'}]});
    assert.equal(b.read().items[ids[0]].reason, '观察现金流');
    assert.throws(() => b.apply(0,{changes:[{instrument:ids[1],pinned:true}]}), /版本/);
    b.apply(1,{changes:[{instrument:ids[1],pinned:true}]});
    assert.throws(() => a.undo(saved.operationId, 2), /后续/);
    const last = b.apply(2,{changes:[{instrument:ids[0],reason:'修改理由'}]});
    a.undo(last.operationId, 3); assert.equal(b.read().items[ids[0]].reason, '观察现金流');
    assert.deepEqual(ids, ['stock:us:AAPL','crypto:binance:BTCUSDT']);
    assert.throws(() => a.apply(4,{changes:[{instrument:'stock:us:SNDK',pinned:true}]}), /自选/);
    assert.throws(() => a.apply(4,{changes:[{instrument:ids[0],observeOn:'2026-02-30'}]}), /日期/);
  } finally {first.close();second.close();}
});

test('removing a group is reversible without mutating the saved before-image', () => {
  const db = new SQLiteStateStore(path.join(root, 'undo.sqlite'), root);
  const id = 'stock:us:AAPL', store = new WatchlistMetadataStore(db, () => [id]);
  try {
    store.apply(0,{groups:[{id:'earnings',name:'财报'}],changes:[{instrument:id,groupId:'earnings'}]});
    const removed = store.apply(1,{groups:[],changes:[]});
    assert.equal(store.read().items[id].groupId,null);
    store.undo(removed.operationId,2);
    assert.equal(store.read().items[id].groupId,'earnings');
  } finally {db.close();}
});
