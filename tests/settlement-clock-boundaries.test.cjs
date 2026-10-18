const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeSettlementEvidence,buildSettlementTimeline}=require('../dist/features/prediction-settlement');
const record=at=>normalizeSettlementEvidence({platform:'Kalshi',marketId:'KXTEST-26',capturedAt:at,payload:{status:'settled',result:'yes',close_time:'2026-10-01T00:00:00Z',settlement_ts:'2026-10-02T00:00:00Z'}});
test('announcement clock pins the first saved same-result observation without treating an oracle transaction as account release',()=>{
 const early=record('2026-10-02T02:00:00Z'),latest=record('2026-10-04T00:00:00Z');
 const timeline=buildSettlementTimeline(latest,[{...early,instrument:'prediction:kalshi:OTHER',capturedAt:'2026-10-01T01:00:00Z'},early,{...early,capturedAt:'2026-10-06T00:00:00Z'}]);
 assert.equal(timeline.stages[1].at,'2026-10-02T02:00:00.000Z');assert.equal(timeline.stages[1].evidenceHash,early.evidenceHash);
 const funds=timeline.stages.find(row=>row.key==='capital-release');assert.ok(funds);assert.equal(funds.status,'unknown');assert.equal(funds.at,null);assert.match(funds.detail,/账户|到账/);
 assert.equal(timeline.clocks.closeToPlatformSettlementMs,86400000);assert.equal(timeline.clocks.closeToAnnouncementObservedMs,93600000);assert.equal(timeline.clocks.settlementToCapitalReleaseMs,null);
});
test('future settlement timestamps cannot become completed clocks as of the captured snapshot',()=>{
 const e=record('2026-10-01T12:00:00Z'),t=buildSettlementTimeline(e,[]);assert.equal(t.stages[3].at,null);assert.equal(t.clocks.closeToPlatformSettlementMs,null);assert.equal(t.clocks.settlementToCapitalReleaseMs,null);
});
