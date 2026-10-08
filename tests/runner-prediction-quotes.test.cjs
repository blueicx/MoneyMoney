const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
test('prediction read-only valuation selects an outcome quote while the execution gate remains separate',()=>{
 assert.ok(fs.existsSync('src/features/runner-prediction-quotes.ts'),'verified outcome selector missing');
 const {predictionOutcomeQuote,buildPredictFunExecutionQuote,predictionSettlementRulesGate}=require('../src/features/runner-prediction-quotes');
 const at='2026-10-08T00:00:00Z';const now=new Date(at);
 const market={id:42,status:'REGISTERED',tradingStatus:'OPEN',isVisible:true,conditionId:'condition-42',description:'Will the event happen?',decimalPrecision:2,outcomes:[{name:'YES',onChainId:'yes-42'},{name:'NO',onChainId:'no-42'}]};
 const book={marketId:42,updateTimestampMs:Date.parse(at),bids:[[.49,80]],asks:[[.51,100]]};
 const quote=buildPredictFunExecutionQuote(market,book,now,120000);
 const tamperedQuote={...quote,predictionContract:{...quote.predictionContract,outcomes:{...quote.predictionContract.outcomes,NO:{...quote.predictionContract.outcomes.NO,bestBid:.46,bestAsk:.48}}}};
 const coherentPriceTamper={...quote,predictionContract:{...quote.predictionContract,outcomes:{YES:{...quote.predictionContract.outcomes.YES,bestBid:.4,bestAsk:.42},NO:{...quote.predictionContract.outcomes.NO,bestBid:.58,bestAsk:.6}}}};
 const selected=predictionOutcomeQuote(quote,'NO',now);assert.equal(selected.price,.5);assert.equal(selected.bestBid,.49);assert.equal(selected.bestAsk,.51);assert.equal(selected.outcome,'NO');assert.equal(selected.tokenId,'no-42');assert.equal(selected.bestBidSize,100);assert.equal(selected.bestAskSize,80);
 const executionGate=predictionSettlementRulesGate(selected);assert.equal(executionGate.allowed,false);assert.match(executionGate.reason,/没有独立、可验证的结算规则/);
 assert.equal(predictionOutcomeQuote({...quote,predictionContract:undefined},'NO',new Date(at)).status,'unsupported');
 for(const contract of [{...quote.predictionContract,verified:false},{...quote.predictionContract,marketDescriptionEvidence:undefined},{...quote.predictionContract,instrumentId:'stock:us:AAPL'},{...quote.predictionContract,conditionId:'tampered-condition'},{...quote.predictionContract,decimalPrecision:3},{...quote.predictionContract,outcomes:{...quote.predictionContract.outcomes,NO:{...quote.predictionContract.outcomes.NO,tokenId:'tampered-no-token'}}},{...quote.predictionContract,marketDescriptionEvidence:{...quote.predictionContract.marketDescriptionEvidence,observedAt:'2026-10-09T00:00:00Z'}},{...quote.predictionContract,marketDescriptionEvidence:{...quote.predictionContract.marketDescriptionEvidence,descriptionHash:'0'.repeat(64)}}])assert.equal(predictionOutcomeQuote({...quote,predictionContract:contract},'NO',now).status,'unsupported');
 assert.equal(predictionOutcomeQuote(tamperedQuote,'NO',now).status,'unsupported');
 assert.equal(predictionOutcomeQuote(coherentPriceTamper,'NO',now).status,'unsupported');
 assert.equal(predictionOutcomeQuote({...quote,status:'failed'},'NO',now).status,'unsupported');
 const stale=predictionOutcomeQuote(quote,'YES',new Date('2026-10-09T00:00:00Z'));assert.equal(stale.status,'stale');assert.equal(stale.bestBid,undefined);
 const actualFetch={...quote,fetchedAt:'2026-10-08T00:00:10Z'};assert.equal(predictionOutcomeQuote(actualFetch,'NO',new Date(actualFetch.fetchedAt)).fetchedAt,actualFetch.fetchedAt);
 assert.equal(predictionOutcomeQuote({...quote,predictionContract:{...quote.predictionContract,marketDescriptionEvidence:{...quote.predictionContract.marketDescriptionEvidence,url:'https://evil.example/market/42'}}},'YES',now).status,'unsupported');
 assert.equal(predictionOutcomeQuote(quote,'LONG',now).status,'unsupported');
 const failed=predictionOutcomeQuote({...quote,status:'failed',dataStatus:'failed',reason:'upstream timeout'},'YES',now);assert.equal(failed.status,'failed');assert.equal(failed.reason,'upstream timeout');assert.equal(failed.bestAsk,undefined);
 const stock={market:'stocks',price:100};assert.equal(predictionOutcomeQuote(stock,'LONG'),stock);
});
test('server does not synthesize NO prices from a YES quote',()=>{
 const source=fs.readFileSync('src/web/server.ts','utf8');assert.ok(!source.includes('price: 1 - (yesBid + yesAsk) / 2'),'synthetic NO executable quote remains');
 assert.ok(source.includes('const executableQuote = predictionOutcomeQuote(quote'), 'unidentified market books must fail capability preflight before model requests');
 assert.ok(source.includes('buildPredictFunExecutionQuote(marketItem, book, fetchedAt, runner.policy.minFreshnessMs, config.apiBaseUrl)'), 'runner must construct outcome quotes from the exact fetched market and orderbook');
 assert.ok(source.includes('predictionSettlementRulesGate(executableQuote)'), 'Predict.fun execution must be separated from read-only quote valuation');
 assert.ok(source.includes("snapshot.market === 'prediction' && snapshot.executionStatus === 'unsupported'"), 'missing settlement rules must prevent AI model requests');
 assert.ok(source.includes("name: 'settlement-rule-evidence'"), 'decision history must record the missing rules gate');
});

test('Predict.fun official YES book builds precision-safe read-only YES/NO evidence without claiming settlement rules',()=>{
 const {buildPredictFunExecutionQuote,predictionOutcomeQuote}=require('../src/features/runner-prediction-quotes');
 assert.equal(typeof buildPredictFunExecutionQuote,'function');
 const now=new Date('2026-10-09T00:00:10.000Z');
 const market={id:42,status:'REGISTERED',tradingStatus:'OPEN',isVisible:true,conditionId:'condition-42',description:'Will the event happen by the stated date?',decimalPrecision:2,outcomes:[{name:'YES',onChainId:'yes-42'},{name:'NO',onChainId:'no-42'}]};
 const book={marketId:42,updateTimestampMs:Date.parse('2026-10-09T00:00:08.000Z'),bids:[[0.49,80],[0.48,100]],asks:[[0.51,100],[0.52,50]]};
 const quote=buildPredictFunExecutionQuote(market,book,now,120000);
 assert.equal(quote.dataStatus,'live');assert.equal(quote.price,0.5);assert.equal(quote.predictionContract.instrumentId,'prediction:predictfun:42');
 assert.equal(quote.predictionContract.marketDescriptionEvidence.publishedAt,undefined);assert.equal(quote.predictionContract.marketDescriptionEvidence.observedAt,now.toISOString());assert.match(quote.predictionContract.marketDescriptionEvidence.descriptionHash,/^[a-f0-9]{64}$/);
 assert.equal(quote.predictionContract.settlementRules,undefined);
 const yes=predictionOutcomeQuote(quote,'YES',now,120000),no=predictionOutcomeQuote(quote,'NO',now,120000);
 assert.equal(yes.dataStatus,'live');assert.equal(no.dataStatus,'live');
 assert.deepEqual([quote.predictionContract.outcomes.YES.bestBid,quote.predictionContract.outcomes.YES.bestAsk,quote.predictionContract.outcomes.YES.quoteBasis],[0.49,0.51,'source-yes-orderbook']);
 assert.deepEqual([quote.predictionContract.outcomes.NO.bestBid,quote.predictionContract.outcomes.NO.bestAsk,quote.predictionContract.outcomes.NO.quoteBasis],[0.49,0.51,'complement-from-yes-orderbook']);
 for(const invalidMarket of [{...market,id:43},{...market,status:'RESOLVED'},{...market,tradingStatus:'CLOSED'},{...market,isVisible:false},{...market,isVisible:undefined},{...market,description:''},{...market,conditionId:''},{...market,outcomes:[market.outcomes[0],{name:'NO',onChainId:'yes-42'}]},{...market,outcomes:[market.outcomes[0]]}]) assert.equal(buildPredictFunExecutionQuote(invalidMarket,book,now,120000).dataStatus,'unsupported');
 assert.equal(buildPredictFunExecutionQuote(market,{...book,marketId:99},now,120000).dataStatus,'unsupported');
 assert.equal(buildPredictFunExecutionQuote(market,{...book,bids:[[0.491,80]]},now,120000).dataStatus,'unavailable');
 assert.equal(buildPredictFunExecutionQuote(market,{...book,bids:[[0.52,80]]},now,120000).dataStatus,'unavailable');
 assert.equal(buildPredictFunExecutionQuote(market,{...book,updateTimestampMs:now.getTime()+1},now,120000).dataStatus,'unavailable');
 assert.equal(buildPredictFunExecutionQuote(market,{...book,updateTimestampMs:0},now,120000).dataStatus,'unavailable');
 assert.equal(buildPredictFunExecutionQuote(market,{...book,updateTimestampMs:now.getTime()-120001},now,120000).dataStatus,'stale');
 const precision3=buildPredictFunExecutionQuote({...market,decimalPrecision:3},{...book,bids:[[.491,80]],asks:[[.493,100]]},now,120000,'https://api-testnet.predict.fun');
 assert.equal(precision3.dataStatus,'live');assert.equal(precision3.predictionContract.marketDescriptionEvidence.url,'https://api-testnet.predict.fun/v1/markets/42');
 assert.equal(precision3.predictionContract.outcomes.NO.bestBid,.507);
 assert.equal(predictionOutcomeQuote(precision3,'NO',now).dataStatus,'live');
 assert.equal(buildPredictFunExecutionQuote(market,book,now,120000,'https://evil.example').dataStatus,'unsupported');
});

test('Predict.fun market description alone is not sufficient settlement-rules evidence for paper matching',()=>{
 const {buildPredictFunExecutionQuote,predictionOutcomeQuote,predictionSettlementRulesGate}=require('../src/features/runner-prediction-quotes');
 const {resolveRunnerFill}=require('../src/features/ai-paper-runner');
 const now=new Date('2026-10-09T00:00:10.000Z');
 const market={id:42,status:'REGISTERED',tradingStatus:'OPEN',isVisible:true,conditionId:'condition-42',description:'Rules',decimalPrecision:2,outcomes:[{name:'YES',onChainId:'yes-42'},{name:'NO',onChainId:'no-42'}]};
 const quote=buildPredictFunExecutionQuote(market,{marketId:42,updateTimestampMs:now.getTime(),bids:[[.49,80]],asks:[[.51,100]]},now);
 assert.equal(quote.dataStatus,'live','the verified top-of-book remains usable as read-only evidence');
 const selected=predictionOutcomeQuote(quote,'YES',now);
 assert.equal(selected.dataStatus,'live','fresh prices remain available for marking existing paper positions');
 assert.equal(selected.bestBid,.49);assert.equal(selected.bestAsk,.51);
 const gate=predictionSettlementRulesGate(selected);assert.equal(gate.allowed,false);
 assert.match(gate.reason,/没有独立、可验证的结算规则/);
 assert.equal(resolveRunnerFill({minFreshnessMs:120000},selected,'BUY',now,1).allowed,false);
});

test('prediction runner requires settlement rules for new entries and keeps exits inside visible top-level liquidity',()=>{
 const {resolveRunnerFill}=require('../src/features/ai-paper-runner');
 const {buildPredictFunExecutionQuote,predictionOutcomeQuote}=require('../src/features/runner-prediction-quotes');
 const now=new Date('2026-10-09T00:00:10.000Z');
 const market={id:42,status:'REGISTERED',tradingStatus:'OPEN',isVisible:true,conditionId:'condition-42',description:'Rules',decimalPrecision:2,outcomes:[{name:'YES',onChainId:'yes-42'},{name:'NO',onChainId:'no-42'}]};
 const quote=predictionOutcomeQuote(buildPredictFunExecutionQuote(market,{marketId:42,updateTimestampMs:now.getTime(),bids:[[.49,2]],asks:[[.51,3]]},now),'YES',now);
 const policy={minFreshnessMs:120000};
 assert.equal(resolveRunnerFill(policy,quote,'BUY',now,3).allowed,false);
 assert.match(resolveRunnerFill(policy,quote,'BUY',now,3).reason,/没有独立、可验证的结算规则/);
 assert.equal(resolveRunnerFill(policy,{...quote,predictionContract:undefined},'BUY',now,1).allowed,false);
 const insufficient=resolveRunnerFill(policy,quote,'BUY',now,3.01);assert.equal(insufficient.allowed,false);assert.match(insufficient.reason,/没有独立、可验证的结算规则/);
 const missingContract={...quote,predictionContract:{...quote.predictionContract,outcomes:{...quote.predictionContract.outcomes,YES:{...quote.predictionContract.outcomes.YES,bestAskSize:undefined}}}};
 const missing=resolveRunnerFill(policy,missingContract,'BUY',now,1);assert.equal(missing.allowed,false);
 assert.equal(resolveRunnerFill(policy,quote,'SELL',now,1).allowed,true,'risk-reducing exit remains possible with the verified selected-outcome book');
 assert.equal(resolveRunnerFill(policy,quote,'SELL',now,2.01).allowed,false,'exits still cannot exceed visible top-level depth');
});

test('Predict.fun GraphQL fallback never replaces a missing source timestamp with retrieval time',async()=>{
 const {api}=require('../src/api');const originalFetch=global.fetch;let calls=0;
 global.fetch=async(url)=>{calls+=1;if(String(url).includes('/orderbook'))return new Response('unauthorized',{status:403});return new Response(JSON.stringify({data:{market:{orderbook:{marketId:42,asks:[[0.51,2]],bids:[[0.49,3]],updateTimestampMs:0}}}}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{const response=await api.getOrderbook(42);assert.equal(response.success,true);assert.equal(response.data.updateTimestampMs,0);assert.equal(calls,2);}finally{global.fetch=originalFetch;}
});
