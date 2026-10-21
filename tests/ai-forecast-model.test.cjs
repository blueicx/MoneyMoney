const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('forecast adapter uses only fixed target inputs and requires actual returned model identity',async()=>{
 const {requestResearchForecast}=require('../src/features/ai-forecast-lab'),runtime={configured:true,apiKey:'isolated-test-token',apiUrl:'https://openrouter.ai/api/v1/chat/completions'},model='fixture/model';let sent;
 const output={model,probability:.6,rationale:'Saved bar',counterEvidence:['Could fall'],citations:[]};
 const fetch=async(url,options)=>{assert.equal(url,runtime.apiUrl);sent=JSON.parse(options.body);return {ok:true,json:async()=>({model,choices:[{message:{content:JSON.stringify(output)}}]})};};
 const value=await requestResearchForecast(runtime,model,{target:'close-above-reference',targetCloseAt:123},fetch);assert.deepEqual(value,output);assert.equal(sent.model,model);assert.match(sent.messages[0].content,/no actions, orders/);assert.doesNotMatch(JSON.stringify(sent),/isolated-test-token/);
 await assert.rejects(requestResearchForecast({...runtime,apiUrl:'https://untrusted.example'},model,{},fetch),/端点/);await assert.rejects(requestResearchForecast(runtime,model,{},async()=>({ok:true,json:async()=>({model:'other',choices:[]})})),/身份/);
});
