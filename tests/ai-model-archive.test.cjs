const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
process.env.MONEYMONEY_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'mm-model-archive-'));require('ts-node/register/transpile-only');
const {requestAiRunnerIntent}=require('../src/features/ai-runner-model');
test('model archive contains hashes of exact sanitized input and bounded output, not the provider private reasoning or credentials',async()=>{
 const runner={model:'provider/fixed-v1',universe:{market:'stocks',instruments:[{venue:'Stocks',symbolOrMarketId:'AAPL'}]}};
 const runtime={configured:true,apiKey:'DO_NOT_ARCHIVE',apiUrl:'https://example.invalid/chat/completions'};
 const output={action:'HOLD',instrument:'AAPL',confidence:.5,rationale:'saved evidence',counterEvidence:[],riskNotes:[],market:'stocks'};
 let request,calls=0;
 const result=await requestAiRunnerIntent(runner,runtime,[{instrument:'AAPL',market:'stocks',dataStatus:'delayed',price:100}],async(_url,init)=>{calls++;request=JSON.parse(init.body);return {ok:true,json:async()=>({model:'provider/fixed-v1',choices:[{message:{content:JSON.stringify(output),reasoning:'PRIVATE_CHAIN_NOT_ARCHIVED'}}]})};});
 assert.equal(result.ok,true);assert.ok(result.evidence,'versioned original model evidence is retained');assert.equal(calls,1);
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 assert.equal(result.evidence.promptVersion,'ai-runner-intent-v1');assert.equal(result.evidence.promptHash,hash(request.messages[0].content));
 assert.equal(result.evidence.inputHash,hash(JSON.parse(request.messages[1].content)));assert.equal(result.evidence.inputHash,hash(result.evidence.input));
 assert.equal(result.evidence.outputHash,hash(result.intent));assert.deepEqual(result.evidence.output,result.intent);
 assert.doesNotMatch(JSON.stringify(result.evidence),/PRIVATE_CHAIN_NOT_ARCHIVED|DO_NOT_ARCHIVE|authorization/);
});
test('missing provider model identity is unknown in evidence, not silently asserted as the requested version',async()=>{
 const result=await requestAiRunnerIntent({model:'requested/fixed-v1',universe:{market:'stocks',instruments:[{venue:'Stocks',symbolOrMarketId:'AAPL'}]}},{configured:true,apiKey:'fixture',apiUrl:'https://example.invalid/chat'},[],async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'HOLD',instrument:'AAPL',confidence:.5,rationale:'fixture saved evidence',market:'stocks',counterEvidence:[],riskNotes:[]})}}]})}));
 assert.equal(result.ok,true);assert.equal(result.evidence.requestedModel,'requested/fixed-v1');assert.equal(result.evidence.returnedModel,'','provider identity must remain unverified');
});
