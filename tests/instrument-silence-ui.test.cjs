const test=require('node:test'),assert=require('node:assert/strict');
test('private silence controls are wired only to alert workspace and guard guest access',()=>{
 const source=require('./helpers/dashboard-source.cjs').readDashboardSource();assert.ok(/function loadInstrumentSilences\(/.test(source));const fn=source.match(/async function loadInstrumentSilences\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(fn);assert.ok(fn.includes('mm_isGuest'));assert.ok(fn.includes('mm_isLoggedIn'));assert.ok(fn.includes('isCurrentMarketScopeToken'));assert.ok(fn.includes('/api/alerts/instrument-silences'));
 assert.ok(!fn.includes('currentInstrumentFilterId()'),'quiet preview must not guess the venue of a legacy sh/us/BTC code');
});
