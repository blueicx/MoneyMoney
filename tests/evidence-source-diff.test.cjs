const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const {createEvidenceSnapshot,getEvidenceChanges,compareEvidenceSnapshots}=require('../src/features/decision-intelligence');
const snap=(source,time,price,status='historical')=>createEvidenceSnapshot({market:'stocks',instrument:'AAPL',workspace:'evidence',source:{id:source,name:source},dataStatus:status,observedAt:time,fetchedAt:time,fields:price==null?{}:{price},reason:status==='failed'?'来源超时':undefined});
test('different providers never become a price revision; baseline is last viewed evidence, not a later intermediate update',()=>{
 const a=snap('nasdaq','2026-10-01T00:00:00Z',100),b=snap('nasdaq','2026-10-01T01:00:00Z',101),c=snap('nasdaq','2026-10-01T02:00:00Z',103),other=snap('other','2026-10-01T02:01:00Z',500);
 assert.throws(()=>compareEvidenceSnapshots(a,other),/source|来源/i);
 const result=getEvidenceChanges([a,b,c,other],'stocks','AAPL','2026-10-01T00:30:00Z');
 const change=result.fieldComparisons.find(row=>row.status==='changed');assert.equal(change.before,100);assert.equal(change.after,103);assert.equal(change.source.id,'nasdaq');
 assert.equal(change.beforeSnapshotId,a.id);assert.equal(change.afterSnapshotId,c.id);assert.equal(change.beforeSourceTime,a.observedAt);assert.equal(change.afterSourceTime,c.observedAt);
});
test('provider failure is preserved as a state change, never interpreted as deletion of successful fields',()=>{
 const a=snap('nasdaq','2026-10-01T00:00:00Z',100),failed=snap('nasdaq','2026-10-01T01:00:00Z',null,'failed');
 const result=getEvidenceChanges([a,failed],'stocks','AAPL','2026-10-01T00:30:00Z');
 assert.equal(result.dataStatus,'partial');assert.equal(result.fieldChanges.length,0);assert.equal(result.sourceChanges[0].afterStatus,'failed');assert.match(result.sourceChanges[0].reason,/超时/);
});
