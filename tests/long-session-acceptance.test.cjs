const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateContinuousSoak}=require('../scripts/lib/continuous-soak.cjs');
const fixture=()=>({measurementStartedAt:new Date(0).toISOString(),measuredElapsedMs:86400000,pageErrors:[],restarts:0,measurements:Array.from({length:1441},(_,i)=>({measuredMs:i*60000,nodes:100,listeners:10,heapBytes:100000,pendingRequests:1}))});
test('24 hours requires actual continuous observed time, not requested duration',()=>{
 const r=fixture();assert.equal(evaluateContinuousSoak(r,86400000).status,'passed');r.measuredElapsedMs=300000;r.measurements=r.measurements.slice(0,6);assert.equal(evaluateContinuousSoak(r,86400000).status,'failed');
});
test('a monitoring gap, restart or backwards clock rejects continuous acceptance',()=>{
 const r=fixture();r.measurements.splice(10,6);assert.match(evaluateContinuousSoak(r,86400000).reasons.join(),/gap/);
 const restarted=fixture();restarted.restarts=1;assert.match(evaluateContinuousSoak(restarted,86400000).reasons.join(),/restart/);
 const reversed=fixture();reversed.measurements[10].measuredMs=1;assert.equal(evaluateContinuousSoak(reversed,86400000).status,'failed');
});
test('rolling windows catch transient resource growth even if the last sample recovers',()=>{
 const r=fixture();r.measurements[30].listeners=100;const result=evaluateContinuousSoak(r,86400000);assert.equal(result.status,'failed');assert.match(result.reasons.join(),/listeners/);
});
