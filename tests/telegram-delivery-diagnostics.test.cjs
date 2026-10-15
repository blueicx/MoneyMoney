const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('delivery diagnosis follows stock outbox expiry/backoff, preserves ACK and does not invent suppression history',()=>{
 const {diagnoseAlertDelivery}=require('../src/features/telegram-delivery-diagnostics'),now=Date.parse('2026-10-15T01:00:00Z');
 const row={id:'stock-signal:x',channel:'telegram',status:'failed',attempts:2,lastAttemptAt:'2026-10-15T00:59:00Z',context:{market:'stocks'}};
 assert.equal(diagnoseAlertDelivery(row,now).code,'retry_wait');assert.equal(diagnoseAlertDelivery(row,now).nextRetryAt,'2026-10-15T01:01:00.000Z');
 assert.equal(diagnoseAlertDelivery({...row,expiresAt:'2026-10-15T00:58:00Z'},now).code,'expired');
 assert.equal(diagnoseAlertDelivery({...row,status:'acknowledged'},now).code,'acknowledged');
 assert.equal(diagnoseAlertDelivery({...row,attempts:7},now).code,'exhausted');
 assert.equal(diagnoseAlertDelivery({...row,id:'other-delivery'},now).nextRetryAt,null);
 assert.equal(diagnoseAlertDelivery({...row,attempts:0,lastAttemptAt:undefined,lastError:'当前通知策略暂缓投递，未消耗次数'},now).code,'policy_deferred');
 assert.equal(diagnoseAlertDelivery({...row,attempts:0,lastAttemptAt:undefined,lastError:'silence? some unstructured text'},now).code,'queued');
 assert.match(diagnoseAlertDelivery({...row,status:'suppressed'},now).reason,/未记录/);
});
