const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {forecastOperationQuality,compareFrozenForecastBaselines}=require('../src/features/ai-forecast-quality');
test('paired baselines require twenty pre-frozen mature results and never manufacture old baselines',()=>{
 const row={manifest:{capturedAt:1,baselines:{version:'fixed-baselines-v1',capturedAt:1,neutral:.5,lastCandleDirection:1}},output:{probability:.8},evaluation:{outcome:1}};
 assert.equal(compareFrozenForecastBaselines(Array(19).fill(row)).modelBrier,null);const result=compareFrozenForecastBaselines([...Array(20).fill(row),{...row,manifest:{capturedAt:1}}]);assert.equal(result.pairedSamples,20);assert.equal(result.missingFrozenBaseline,1);assert.ok(Math.abs(result.modelBrier-.04)<1e-10);assert.equal(result.neutralBrier,.25);assert.equal(result.lastCandleDirectionBrier,0);
});
test('failed or cancelled calls with unknown charges prevent complete per-result costs',()=>{
 const completed={status:'completed',callsReserved:1,costSource:'provider-response',actualCostCredits:0,manifest:{targetCloseAt:1},output:{probability:.5}};const result=forecastOperationQuality([completed,{status:'cancelled',callsReserved:1},{status:'failed',callsReserved:1}],2);assert.equal(result.costs.totalKnownCredits,0);assert.equal(result.costs.unknownCalls,2);assert.equal(result.costs.creditsPerValidResult,null);assert.equal(result.operations.awaitingEvidence,1);assert.equal(result.operations.cancelled,1);assert.equal(result.operations.failed,1);
});
