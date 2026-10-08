const test=require('node:test'),assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
const {selectRandomOpenRouterFreeModel,fetchRandomOpenRouterFreeModel}=require('../src/features/openrouter-random-model');

const row=(id,pricing={prompt:'0',completion:'0'})=>({id,pricing,architecture:{output_modalities:['text']}});

test('random model selection only considers concrete text models with zero pricing and freezes a catalog choice',()=>{
 const imageOnly=row('vendor/image:free',{prompt:'0',completion:'0',image:'0'});imageOnly.architecture.output_modalities=['image'];
 const rows=[row('vendor/z:free'),row('vendor/paid',{prompt:'0.1',completion:'0'}),row('openrouter/free'),imageOnly,row('vendor/a:free')];
 assert.equal(selectRandomOpenRouterFreeModel(rows,max=>max-1),'vendor/z:free');
 assert.equal(selectRandomOpenRouterFreeModel(rows,max=>0),'vendor/a:free');
});

test('random model selection fails closed for empty catalog and invalid random index',()=>{
 assert.throws(()=>selectRandomOpenRouterFreeModel([row('openrouter/free')]),/没有可用的具体免费文本模型/);
 assert.throws(()=>selectRandomOpenRouterFreeModel([row('vendor/unknown-price:free',{prompt:'',completion:'0'})]),/没有可用的具体免费文本模型/);
 assert.throws(()=>selectRandomOpenRouterFreeModel([row('vendor/a:free')],()=>-1),/随机模型索引无效/);
});

test('malformed OpenRouter pricing and output metadata cannot qualify as a free text model',()=>{
 const nullPrice=row('vendor/null-price:free',{prompt:null,completion:'0'});
 const booleanPrice=row('vendor/boolean-price:free',{prompt:false,completion:'0'});
 const malformedModalities=row('vendor/malformed-modalities:free');malformedModalities.architecture.output_modalities='text-only';
 for(const candidate of [nullPrice,booleanPrice,malformedModalities])assert.throws(()=>selectRandomOpenRouterFreeModel([candidate]),/没有可用的具体免费文本模型/);
});

test('OpenRouter catalog lookup uses the configured key without exposing it in errors',async()=>{
 let request;
 const model=await fetchRandomOpenRouterFreeModel('secret-fixture-key',async(url,options)=>{request={url,options};return {ok:true,json:async()=>({data:[row('vendor/a:free')]})};},()=>0);
 assert.equal(model,'vendor/a:free');assert.equal(request.url,'https://openrouter.ai/api/v1/models');
 assert.equal(request.options.headers.authorization,'Bearer secret-fixture-key');
 await assert.rejects(fetchRandomOpenRouterFreeModel('secret-fixture-key',async()=>({ok:false,status:503}),()=>0),error=>!error.message.includes('secret-fixture-key'));
});
