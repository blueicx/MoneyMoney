const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('session context separates nominal pre/regular/post hours from evidence of holidays and early close',()=>{
 const {exchangeSessionContext}=require('../src/features/exchange-session-context');
 assert.equal(exchangeSessionContext('us',Date.parse('2026-10-15T12:00:00Z')).phase,'pre');
 assert.equal(exchangeSessionContext('us',Date.parse('2026-10-15T15:00:00Z')).phase,'regular');
 const at=Date.parse('2026-10-15T18:00:00Z'),base=exchangeSessionContext('us',at);assert.equal(base.verifiedClosed,false);
 const evidence={venue:'us',date:'2026-10-15',source:'Exchange calendar',sourceUrl:'https://exchange.example/calendar',publishedAt:'2026-10-14T00:00:00Z',regularCloseMinute:780};
 assert.equal(exchangeSessionContext('us',at,evidence).phase,'post');assert.equal(exchangeSessionContext('us',at,evidence).earlyClose,true);
 assert.equal(exchangeSessionContext('us',at,{...evidence,closed:true}).verifiedClosed,true);
 assert.equal(exchangeSessionContext('us',at,{...evidence,closed:true,publishedAt:'2026-10-16T00:00:00Z'}).verifiedClosed,false);
 assert.equal(exchangeSessionContext('hk',at,{...evidence,closed:true}).verifiedClosed,false);
});
test('published NYSE cash calendar closes holidays and regular session at 13:00 ET on verified early-close dates',()=>{
 const {exchangeSessionContext}=require('../src/features/exchange-session-context'),{stockExchangeSession}=require('../src/features/stock-signal-schedule');
 assert.equal(exchangeSessionContext('us',Date.parse('2026-11-26T16:00:00Z')).verifiedClosed,true);
 assert.equal(exchangeSessionContext('us',Date.parse('2026-11-27T18:01:00Z')).earlyClose,true);
 assert.equal(stockExchangeSession('us',Date.parse('2026-11-27T18:01:00Z')).open,false);
 assert.equal(stockExchangeSession('us',Date.parse('2026-11-26T16:00:00Z')).open,false);
 assert.equal(exchangeSessionContext('us',Date.parse('2029-11-23T16:00:00Z')).verifiedClosed,false);
 assert.equal(exchangeSessionContext('hk',Date.parse('2026-11-26T03:00:00Z')).verifiedClosed,false);
});
