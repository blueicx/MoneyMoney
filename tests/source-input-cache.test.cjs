const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('source caches and in-flight requests are isolated by full input, not just provider instance',async()=>{
 const {ResilientDataSourceAdapter}=require('../src/data/source-adapter');let calls=0;const adapter=new ResilientDataSourceAdapter({id:'isolated',group:'test',retries:0,fetcher:async input=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return input;}});
 const [a,b]=await Promise.all([adapter.fetch({symbol:'AAPL',before:10}),adapter.fetch({symbol:'AAPL',before:20})]);assert.equal(a.data.before,10);assert.equal(b.data.before,20);
 const [c,d]=await Promise.all([adapter.fetch({symbol:'MU',before:10}),adapter.fetch({symbol:'MU',before:10})]);assert.equal(c.data.symbol,'MU');assert.equal(d.data.symbol,'MU');assert.equal(calls,3);assert.equal((await adapter.fetch({symbol:'AAPL',before:10})).data.before,10);assert.equal(calls,3);
});
test('one failed input never returns another instrument or history window as stale fallback',async()=>{
 const {ResilientDataSourceAdapter}=require('../src/data/source-adapter');const adapter=new ResilientDataSourceAdapter({id:'isolated',group:'test',retries:0,fetcher:async input=>{if(input.symbol==='MU')throw Error('source failed');return [input.symbol];}});
 await adapter.fetch({symbol:'AAPL'});const failed=await adapter.fetch({symbol:'MU'});assert.equal(failed.data,null);assert.equal(failed.status,'unavailable');
});
