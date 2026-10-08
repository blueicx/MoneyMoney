const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
test('prediction execution selects actual outcome book, not the complement of YES',()=>{
 assert.ok(fs.existsSync('src/features/runner-prediction-quotes.ts'),'verified outcome selector missing');
 const {predictionOutcomeQuote}=require('../src/features/runner-prediction-quotes');
 const at='2026-10-08T00:00:00Z';
 const quote={market:'prediction',price:.5,status:'live',fetchedAt:at,bestBid:.49,bestAsk:.51,predictionContract:{instrumentId:'prediction:predictfun:42',verified:true,rules:{url:'https://predict.fun/market/42',source:'Predict.fun',evidenceId:'rules-42',publishedAt:at},outcomes:{YES:{tokenId:'yes-42',bestBid:.49,bestAsk:.51,updatedAt:at},NO:{tokenId:'no-42',bestBid:.46,bestAsk:.48,updatedAt:at}}}};
 const selected=predictionOutcomeQuote(quote,'NO',new Date(at));assert.equal(selected.price,.47);assert.equal(selected.bestBid,.46);assert.equal(selected.bestAsk,.48);assert.equal(selected.outcome,'NO');assert.equal(selected.tokenId,'no-42');
 assert.equal(predictionOutcomeQuote({...quote,predictionContract:undefined},'NO',new Date(at)).status,'unsupported');
 for(const contract of [{...quote.predictionContract,verified:false},{...quote.predictionContract,rules:undefined},{...quote.predictionContract,instrumentId:'stock:us:AAPL'},{...quote.predictionContract,outcomes:{...quote.predictionContract.outcomes,NO:{...quote.predictionContract.outcomes.NO,tokenId:'yes-42'}}},{...quote.predictionContract,rules:{...quote.predictionContract.rules,publishedAt:'2026-10-09T00:00:00Z'}}])assert.equal(predictionOutcomeQuote({...quote,predictionContract:contract},'NO',new Date(at)).status,'unsupported');
 const stale=predictionOutcomeQuote(quote,'YES',new Date('2026-10-09T00:00:00Z'));assert.equal(stale.status,'stale');assert.equal(stale.bestBid,undefined);
 const actualFetch={...quote,fetchedAt:'2026-10-08T00:00:10Z'};assert.equal(predictionOutcomeQuote(actualFetch,'NO',new Date(actualFetch.fetchedAt)).fetchedAt,actualFetch.fetchedAt);
 assert.equal(predictionOutcomeQuote({...quote,predictionContract:{...quote.predictionContract,rules:{...quote.predictionContract.rules,url:'https://evil.example/market/42'}}},'YES',new Date(at)).status,'unsupported');
 assert.equal(predictionOutcomeQuote(quote,'LONG',new Date(at)).status,'unsupported');
 const failed=predictionOutcomeQuote({...quote,status:'failed',dataStatus:'failed',reason:'upstream timeout'},'YES',new Date(at));assert.equal(failed.status,'failed');assert.equal(failed.reason,'upstream timeout');assert.equal(failed.bestAsk,undefined);
 const stock={market:'stocks',price:100};assert.equal(predictionOutcomeQuote(stock,'LONG'),stock);
});
test('server does not synthesize NO prices from a YES quote',()=>{
 const source=fs.readFileSync('src/web/server.ts','utf8');assert.ok(!source.includes('price: 1 - (yesBid + yesAsk) / 2'),'synthetic NO executable quote remains');
 assert.ok(source.includes('const executableQuote = predictionOutcomeQuote(quote'), 'unidentified market books must fail capability preflight before model requests');
});
