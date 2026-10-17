const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
test('runtime diagnostics labels build fixture drills separately from live-state recovery',()=>{
 const source=require('./helpers/dashboard-source.cjs').readDashboardSource();assert.match(source,/data-build-reliability-drill/);assert.match(source,/d\.reliabilityDrill/);assert.match(source,/隔离夹具/);
});
test('release drill reports cannot appear passed when skipped, stale, future dated or from a different build',()=>{
 assert.ok(fs.existsSync('src/features/reliability-acceptance.ts'),'release drill validation missing');
 const {validateReliabilityReport}=require('../src/features/reliability-acceptance'),at='2026-10-17T01:00:00Z',commit='a'.repeat(40),report={version:1,commit,status:'passed',isolated:true,network:'loopback-only',platform:'win32',completedAt:at,cases:[{name:'fixture',passed:2,failed:0,skipped:0,exitCode:0}],modelCalls:0,productionOrders:0};
 assert.equal(validateReliabilityReport(report,commit,at).dataStatus,'unavailable');
 report.cleanTree=true;
 assert.equal(validateReliabilityReport(report,commit,at).dataStatus,'historical');
 assert.equal(validateReliabilityReport({...report,commit:'b'.repeat(40)},commit,at).dataStatus,'unavailable');
 assert.equal(validateReliabilityReport({...report,cases:[{...report.cases[0],skipped:1}]},commit,at).dataStatus,'failed');
 assert.equal(validateReliabilityReport({...report,completedAt:'2999-01-01T00:00:00Z'},commit,at).dataStatus,'unavailable');
 assert.equal(validateReliabilityReport(report,commit,'2027-01-01T00:00:00Z').dataStatus,'stale');
});
