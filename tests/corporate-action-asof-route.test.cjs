const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
test('corporate action API keeps default response and offers explicit bounded historical versions',()=>{
 const source=fs.readFileSync('src/web/server.ts','utf8'),start=source.indexOf("app.get('/api/data/corporate-actions'"),end=source.indexOf("app.get('/api/data/providers'",start);let handler,received;
 const code=ts.transpile(source.slice(start,end),{target:ts.ScriptTarget.ES2020});
 vm.runInNewContext(code,{app:{get(_p,h){handler=h;}},dataLakeCatalog:{listCorporateActions:()=>[{id:'legacy'}],listCorporateActionsAsOf:i=>(received=i,{records:[],coverage:'partial',reason:'历史不完整'})},Date});
 const run=query=>{const output={},res={status(n){output.status=n;return this;},json(data){output.body=data;return this;}};handler({query},res);return output;};
 assert.equal(run({market:'stocks'}).body.data[0].id,'legacy');
 const out=run({market:'stocks',instrument:'AAPL',asOf:'2026-01-01T00:00:00Z'});assert.equal(received.instrument,'AAPL');assert.equal(out.body.dataStatus,'partial');assert.equal(out.body.reason,'历史不完整');
 assert.equal(run({market:'stocks',asOf:'2026-01-01T00:00:00Z'}).status,400);
});
