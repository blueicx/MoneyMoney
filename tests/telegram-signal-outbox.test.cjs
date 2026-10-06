const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('stock signal outbox persists before sending, deduplicates, respects pause, retries and ACK',async()=>{
 const {TelegramSignalOutbox}=require('../src/features/telegram-signal-outbox');const items=new Map(),leases=new Map();let now=10000,calls=0;
 const repository={getAlertDelivery:id=>structuredClone(items.get(id)||null),saveAlertDelivery:item=>{items.set(item.id,structuredClone(item));return item},listAlertDeliveries:()=>[...items.values()].map(item=>structuredClone(item))};
 const store={acquireLease:(key,owner)=>{if(leases.has(key))return false;leases.set(key,owner);return true},refreshLease:(key,owner)=>leases.get(key)===owner,releaseLease:(key,owner)=>{if(leases.get(key)===owner)leases.delete(key)}};
 const outbox=new TelegramSignalOutbox(repository,store,()=>now),id='stock-signal:test';outbox.enqueue({id,context:{market:'stocks',workspace:'signals'},alertId:'scan',channel:'telegram',status:'queued',payload:{chatId:'a',message:'test'},expiresAt:new Date(now+86400000).toISOString()});
 outbox.enqueue({...repository.getAlertDelivery(id),payload:{chatId:'a',message:'changed'}});assert.equal(items.get(id).payload.message,'test');
 await outbox.flush('a',()=>false,async()=>assert.fail('paused'));assert.equal(items.get(id).attempts,0);
 await outbox.flush('a',()=>true,async()=>{assert.equal(items.get(id).status,'queued');calls++;throw Error('network')});assert.equal(items.get(id).status,'failed');
 await outbox.flush('a',()=>true,async()=>calls++);assert.equal(calls,1);now+=60001;await outbox.flush('a',()=>true,async()=>calls++);assert.equal(calls,2);assert.equal(items.get(id).status,'sent');
 items.get(id).status='acknowledged';await outbox.flush('a',()=>true,async()=>assert.fail('ACK terminal'));
 outbox.enqueue({id:'stock-signal:expired',context:{market:'stocks',workspace:'signals'},alertId:'x',status:'queued',channel:'telegram',payload:{chatId:'a',message:'old'},expiresAt:new Date(now-1).toISOString()});await outbox.flush('a',()=>true,async()=>assert.fail('expired'));assert.match(items.get('stock-signal:expired').lastError,/过期/);
});
test('lost outbox lease blocks delivery before consuming an attempt',async()=>{
 const {TelegramSignalOutbox}=require('../src/features/telegram-signal-outbox');
 const item={id:'stock-signal:lost',context:{market:'stocks',workspace:'signals'},alertId:'scan',channel:'telegram',status:'queued',attempts:0,payload:{chatId:'a',message:'test'}};
 const repository={getAlertDelivery:()=>structuredClone(item),saveAlertDelivery:value=>{Object.assign(item,value);return value},listAlertDeliveries:()=>[structuredClone(item)]};
 const outbox=new TelegramSignalOutbox(repository,{acquireLease:()=>true,refreshLease:()=>false,releaseLease:()=>{}},()=>10000);
 let sends=0;await outbox.flush('a',()=>true,async()=>{sends++});assert.equal(sends,0);assert.equal(item.attempts,0);
});
