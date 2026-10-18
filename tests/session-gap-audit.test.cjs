const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const calendar=require('../src/features/exchange-session-context');
const api={auditStockSessionGaps:input=>calendar.auditStockSessionGaps(input,Date.parse('2026-12-02T00:00:00Z'))};
const at=s=>Date.parse(s),scope={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',asOf:at('2026-12-01T00:00:00Z')};
const gap=(from,to)=>({from:at(from),to:at(to)});

test('verified holiday and nominal off-session intervals do not masquerade as missing candles',()=>{
 const r=api.auditStockSessionGaps({...scope,gaps:[gap('2026-11-26T15:00:00Z','2026-11-26T16:00:00Z'),gap('2026-11-27T18:00:00Z','2026-11-27T19:00:00Z'),gap('2026-11-27T14:30:00Z','2026-11-27T15:30:00Z')]});
 assert.equal(r.gaps[0].verification,'calendar-closure');assert.match(r.gaps[0].sourceUrl,/theice/);
 assert.equal(r.gaps[1].verification,'outside-regular-session');assert.equal(r.gaps[2].verification,'unverified-trading-gap');
 assert.equal(r.gaps[2].missingBars,null);assert.ok(r.gaps[2].regularSlots>0);assert.equal(r.orderChanges,0);
});
test('calendar audit keeps market identity, asOf, daylight saving and request work bounds',()=>{
 const r=api.auditStockSessionGaps({...scope,gaps:[gap('2026-10-30T13:30:00Z','2026-10-30T14:00:00Z'),gap('2026-11-02T13:30:00Z','2026-11-02T14:00:00Z')]});
 assert.ok(r.gaps[0].regularSlots>0);assert.equal(r.gaps[1].regularSlots,0);assert.equal(r.instrument,scope.instrument);
 assert.throws(()=>api.auditStockSessionGaps({...scope,instrument:'crypto:binance:BTCUSDT',gaps:[]}),/身份/);
 assert.throws(()=>api.auditStockSessionGaps({...scope,asOf:at('2026-10-01'),gaps:[gap('2026-11-01','2026-11-02')]}),/时点/);
 assert.throws(()=>api.auditStockSessionGaps({...scope,gaps:Array(33).fill(gap('2026-11-01','2026-11-02'))}),/32/);
 assert.throws(()=>api.auditStockSessionGaps({...scope,timeframe:'1m',gaps:[gap('2026-10-01','2026-11-01')]}),/预算/);
});
test('unpublished calendar and unknown venues remain explicit, rather than proving missing data or trading suspension',()=>{
 const r=api.auditStockSessionGaps({...scope,asOf:at('2025-11-28'),gaps:[gap('2025-11-27T15:00:00Z','2025-11-27T16:00:00Z')]});
 assert.equal(r.gaps[0].verification,'unverified-trading-gap');assert.equal(r.gaps[0].sourceUrl,null);assert.match(r.gaps[0].reason,/停牌|漏数/);
 assert.throws(()=>api.auditStockSessionGaps({...scope,instrument:'stock:unknown:AAPL',gaps:[]}),/身份/);
});
