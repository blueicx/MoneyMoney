const test = require('node:test');
const assert = require('node:assert/strict');
const { 
  createArtifactManifest, createInstrumentRef, createDataSnapshot,
  createFeatureSpec, createOrderEvent, createPaperPosition,
  createEvidenceBundle, createLineageRef, createAlertDelivery,
  assertMarketContext
} = require('../dist/features/research-contracts.js');

test('createArtifactManifest works', () => {
  assert.equal(createArtifactManifest({id: '1', jobId: 'j1', uri: 'file://1', hash: 'h'}).id, '1');
});

test('createInstrumentRef binds to MarketContext', () => {
  const ctx = { market: 'stocks', workspace: 'w' };
  const ref = createInstrumentRef({ id: '1', symbol: 'AAPL', context: ctx });
  assert.equal(ref.id, '1');
  assert.equal(ref.symbol, 'AAPL');
  assert.deepEqual(ref.context, { market: 'stocks', workspace: 'w', instrument: undefined });
  
  assert.throws(() => createInstrumentRef({ id: '1', symbol: 'AAPL' }), /requires id, symbol, and context/);
});

test('createDataSnapshot binds to MarketContext', () => {
  const ctx = { market: 'crypto', workspace: 'w' };
  const snap = createDataSnapshot({ id: 's1', context: ctx, fromTime: 'a', toTime: 'b', hash: 'h' });
  assert.equal(snap.id, 's1');
  assert.equal(snap.hash, 'h');
  assert.equal(snap.context.market, 'crypto');
});

test('createFeatureSpec binds to MarketContext', () => {
  const ctx = { market: 'options', workspace: 'w' };
  const spec = createFeatureSpec({ id: 'f1', context: ctx, version: '1.0', parameters: { a: 1 } });
  assert.equal(spec.id, 'f1');
  assert.equal(spec.version, '1.0');
  assert.equal(spec.parameters.a, 1);
  assert.equal(spec.context.market, 'options');
});

test('createOrderEvent binds to MarketContext', () => {
  const ctx = { market: 'stocks', workspace: 'w' };
  const evt = createOrderEvent({ id: 'o1', context: ctx, orderType: 'limit', status: 'open', price: 100, amount: 10 });
  assert.equal(evt.id, 'o1');
  assert.equal(evt.orderType, 'limit');
  assert.equal(evt.price, 100);
  assert.equal(evt.context.market, 'stocks');
});

test('createPaperPosition binds to MarketContext', () => {
  const ctx = { market: 'prediction', workspace: 'w' };
  const pos = createPaperPosition({ id: 'p1', context: ctx, instrument: 'PRED', averagePrice: 0.5, amount: 100 });
  assert.equal(pos.id, 'p1');
  assert.equal(pos.averagePrice, 0.5);
  assert.equal(pos.context.market, 'prediction');
});

test('createEvidenceBundle binds to MarketContext', () => {
  const ctx = { market: 'stocks', workspace: 'w' };
  const bundle = createEvidenceBundle({ id: 'e1', context: ctx, artifacts: ['a.md'] });
  assert.equal(bundle.id, 'e1');
  assert.deepEqual(bundle.artifacts, ['a.md']);
  assert.equal(bundle.context.market, 'stocks');
});

test('createLineageRef binds to MarketContext', () => {
  const ctx = { market: 'stocks', workspace: 'w' };
  const lin = createLineageRef({ id: 'l1', context: ctx, sourceId: 's1', derivedId: 'd1', operation: 'map' });
  assert.equal(lin.id, 'l1');
  assert.equal(lin.operation, 'map');
  assert.equal(lin.context.market, 'stocks');
});

test('createAlertDelivery binds to MarketContext', () => {
  const ctx = { market: 'stocks', workspace: 'w' };
  const delivery = createAlertDelivery({ id: 'a1', context: ctx, alertId: 'alert1', status: 'delivered' });
  assert.equal(delivery.id, 'a1');
  assert.equal(delivery.status, 'delivered');
  assert.equal(delivery.context.market, 'stocks');
});
