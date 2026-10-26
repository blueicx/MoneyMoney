'use strict';
const test=require('node:test');
const {performance}=require('node:perf_hooks');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const state=require('../scripts/lib/soak-run-state.cjs');

test('a live child with matching OS start identity and fresh signed heartbeat is running',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soak-state-'));
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 try {
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
  const identity=state.processIdentity(child.pid);
  assert.ok(identity);
  const run=state.createRun({runId:'30000000-0000-4000-8000-000000000010',pid:child.pid,processIdentity:identity,startedAt:Date.now()-1000,heartbeatAt:Date.now()-1000,logPath:path.join(dir,'run-a.ndjson')});
  state.writeRun(dir,run);
  assert.equal(state.inspectRun(dir,'30000000-0000-4000-8000-000000000010').status,'running');
  assert.equal(state.inspectRun(dir,'30000000-0000-4000-8000-000000000010').runId,'30000000-0000-4000-8000-000000000010');
 } finally {child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});

test('dead child and stale heartbeat are interrupted; elapsed wall time cannot be resumed',()=>{
 const now=Date.now();
 const dead=state.createRun({runId:'30000000-0000-4000-8000-000000000011',pid:2147483647,processIdentity:'missing',startedAt:now-1200000,heartbeatAt:now-1200000,logPath:'x'});
 assert.equal(state.classifyRun(dead,{now,identity:null}).status,'interrupted');
 assert.match(state.classifyRun(dead,{now,identity:null}).reason,/process|heartbeat|sleep/i);
 const fresh=state.createRun({runId:'30000000-0000-4000-8000-000000000012',pid:process.pid,processIdentity:'wrong-start-token',startedAt:now-1000,heartbeatAt:now,logPath:'fresh'});
 assert.equal(state.classifyRun(fresh,{now,identity:'different-start-token'}).status,'interrupted');
});

test('gaps over five minutes are interrupted and each new run starts an independent clock and log',()=>{
 const now=Date.now();
 const interrupted=state.createRun({runId:'30000000-0000-4000-8000-000000000013',pid:process.pid,processIdentity:'id',startedAt:now-600001,heartbeatAt:now-300001,logPath:'gap.ndjson'});
 assert.equal(state.classifyRun(interrupted,{now,identity:'id'}).status,'interrupted');
 const next=state.createRun({runId:'30000000-0000-4000-8000-000000000014',pid:process.pid,processIdentity:'id',startedAt:now,heartbeatAt:now,logPath:'next.ndjson'});
 assert.equal(next.runId,'30000000-0000-4000-8000-000000000014');assert.equal(next.elapsedMs,0);assert.notEqual(next.runId,interrupted.runId);assert.notEqual(next.logPath,interrupted.logPath);
});

test('inspect rejects unknown run ids and persists process exit classification',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soak-inspect-'));
 try {
  assert.throws(()=>state.inspectRun(dir,'30000000-0000-4000-8000-000000000099'),/not found/i);
  const now=Date.now(),run=state.createRun({runId:'30000000-0000-4000-8000-000000000015',pid:2147483647,processIdentity:'gone',startedAt:now-1000,heartbeatAt:now-1000,logPath:path.join(dir,'exit.ndjson')});state.writeRun(dir,run);
  const result=state.inspectRun(dir,'30000000-0000-4000-8000-000000000015',{now});assert.equal(result.status,'interrupted');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'runs','30000000-0000-4000-8000-000000000015.json'),'utf8')).status,'interrupted');assert.match(state.inspectRun(dir,'30000000-0000-4000-8000-000000000015',{now}).reason,/process|heartbeat/i);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

const {inspectDescriptor}=require('../scripts/soak-supervisor.cjs');
test('a legacy descriptor without signed heartbeat proof is explicitly interrupted',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soak-legacy-'));
 try {const file=path.join(dir,'legacy.json');fs.writeFileSync(file,JSON.stringify({pid:2147483647,launchedAt:new Date().toISOString(),artifacts:'private-path'}));const result=inspectDescriptor(file);assert.equal(result.status,'interrupted');assert.match(result.reason,/legacy run descriptor/i);assert.equal(JSON.stringify(result).includes('private-path'),false);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('wall time advancing while monotonic time is suspended records sleep as interrupted',()=>{
 const now=Date.now(),run=state.createRun({runId:'30000000-0000-4000-8000-000000000016',pid:process.pid,processIdentity:'id',startedAt:now,heartbeatAt:now,monotonicAt:1000,logPath:'sleep.ndjson'});
 assert.equal(state.classifyRun(run,{now:now+60000,monotonicNow:2000,identity:'id'}).status,'interrupted');
 assert.match(state.classifyRun(run,{now:now+60000,monotonicNow:2000,identity:'id'}).reason,/sleep/i);
});



test('a completed child cannot remain running when its PID no longer resolves to the saved start identity',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
 const identity=state.processIdentity(child.pid);assert.ok(identity);
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
 const run=state.createRun({runId:'30000000-0000-4000-8000-000000000017',pid:child.pid,processIdentity:identity,startedAt:Date.now()-100,heartbeatAt:Date.now(),logPath:'exit.ndjson'});
 assert.equal(state.classifyRun(run,{identity:state.processIdentity(child.pid)}).status,'interrupted');
});





test('heartbeat cannot bridge a gap over five minutes even when both clocks advance together',()=>{
 const identity=state.processIdentity(process.pid),now=Date.now(),mono=performance.timeOrigin+performance.now();
 const run=state.createRun({runId:'30000000-0000-4000-8000-000000000001',pid:process.pid,processIdentity:identity,startedAt:now-360001,heartbeatAt:now-360001,monotonicAt:mono-360001,logPath:'gap-heartbeat.ndjson'}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'soak-gap-heartbeat-'));state.writeRun(dir,run);
 try{assert.throws(()=>state.heartbeat(dir,run.runId,{now,monotonicNow:mono,identity}),/five minutes/i);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'runs',`${run.runId}.json`),'utf8')).heartbeatAt,run.heartbeatAt);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('terminal interrupted state cannot be changed to passed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soak-terminal-')),run=state.createRun({runId:'30000000-0000-4000-8000-000000000002',pid:process.pid,processIdentity:state.processIdentity(process.pid),logPath:'terminal.ndjson'});state.writeRun(dir,run);state.finishRun(dir,run.runId,'interrupted','worker exited');
 try{assert.throws(()=>state.finishRun(dir,run.runId,'passed'),/terminal|transition/i);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'runs',`${run.runId}.json`),'utf8')).status,'interrupted');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('run IDs must be UUIDs and measured time excludes warmup',()=>{
 assert.throws(()=>state.createRun({runId:'../../escape',pid:process.pid,processIdentity:'id',logPath:'x'}),/UUID/i);
 const now=Date.now(),run=state.createRun({runId:'30000000-0000-4000-8000-000000000003',pid:process.pid,processIdentity:'id',startedAt:now-600000,heartbeatAt:now,measurementStartedAt:null,measuredElapsedMs:0,logPath:'warmup.ndjson'});
 assert.equal(state.classifyRun(run,{now:now+1000,identity:'id'}).status,'running');assert.equal(run.measuredElapsedMs,0);assert.equal(run.stage,'warming');
});

test('passed requires matching measurement start, both acceptance gates, and the full measured duration',()=>{
 const run={runId:'30000000-0000-4000-8000-000000000020',requestedMinutes:60,requestedCycles:3,measurementStartedAt:'2026-10-26T08:00:00.000Z',measuredElapsedMs:3600000,expectedBuildFingerprint:'a'.repeat(64),expectedBuildCommit:'b'.repeat(40)};
 const sample=(measuredMs,nodes)=>({measuredMs,nodes,listeners:10,documents:1,heapBytes:1024,pendingRequests:0});
 const good={status:'passed',runId:run.runId,requestedMinutes:60,requestedCycles:3,completedCycles:3,measurementStartedAt:run.measurementStartedAt,measuredElapsedMs:3600000,measurements:Array.from({length:13},(_,i)=>sample(i*300000,100+i)),buildFingerprint:run.expectedBuildFingerprint,buildInfo:{commit:run.expectedBuildCommit},continuousAcceptance:{status:'passed',requiredMs:3600000},publicSourceAcceptance:{status:'passed'}};
 assert.equal(state.validateAcceptance(run,good).status,'passed');
 assert.equal(state.validateAcceptance(run,{...good,publicSourceAcceptance:{status:'not_run'}}).status,'failed');
 assert.equal(state.validateAcceptance(run,{...good,measuredElapsedMs:3599999}).status,'failed');
 assert.equal(state.validateAcceptance(run,{...good,measurementStartedAt:'2026-10-26T07:00:00.000Z'}).status,'failed');
 assert.match(state.validateAcceptance(run,{...good,runId:'30000000-0000-4000-8000-000000000021'}).reasons.join(' '),/run id/i);
 assert.equal(state.validateAcceptance(run,{...good,buildFingerprint:'fixed',buildInfo:{commit:'abc'}}).status,'failed','truthy fake build identifiers are rejected');
 assert.equal(state.validateAcceptance(run,{...good,buildFingerprint:'c'.repeat(64)}).status,'failed','report must match the run-frozen fingerprint');
 assert.equal(state.validateAcceptance(run,{...good,buildInfo:{commit:'d'.repeat(40)}}).status,'failed','report must match the run-frozen commit');
 const forged={...good,measurements:[sample(0,100),sample(0,101),sample(3600000,102)],continuousAcceptance:{status:'passed',requiredMs:3600000}};
 assert.equal(state.validateAcceptance(run,forged).status,'failed','supervisor independently rejects duplicate timestamps even if child claims continuous acceptance passed');
 assert.equal(state.validateAcceptance(run,{...good,requestedMinutes:59}).status,'failed','reported duration request must match supervised request');
 assert.equal(state.validateAcceptance(run,{...good,requestedCycles:10000,completedCycles:0}).status,'failed','report must complete the supervised requested cycles');
 const missingMetric={...good,measurements:[...good.measurements]};missingMetric.measurements[5]={...missingMetric.measurements[5],heapBytes:NaN};
 assert.equal(state.validateAcceptance(run,missingMetric).status,'failed','every observation must contain finite resource evidence');
});

test('warming heartbeat can advance without measurement start; measurement heartbeat starts measured clock',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soak-warm-heartbeat-')),id='30000000-0000-4000-8000-000000000022',identity=state.processIdentity(process.pid),now=Date.now(),mono=performance.timeOrigin+performance.now();
 const run=state.createRun({runId:id,pid:process.pid,processIdentity:identity,startedAt:now,heartbeatAt:now,monotonicAt:mono,logPath:'warming.ndjson'});state.writeRun(dir,run);
 try{const warming=state.heartbeat(dir,id,{now:now+1000,monotonicNow:mono+1000,identity,stage:'warming',phase:'initialization'});assert.equal(warming.stage,'warming');assert.equal(warming.measurementStartedAt,null);const started=state.heartbeat(dir,id,{now:now+2000,monotonicNow:mono+2000,identity,stage:'measurement',phase:'sample',measurementStartedAt:new Date(now+2000).toISOString(),measuredElapsedMs:0});assert.equal(started.status,'running');assert.equal(started.stage,'measurement');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('finishRun rejects a passed report after the last heartbeat ages beyond five minutes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'soak-finish-gap-')),id='30000000-0000-4000-8000-000000000023',identity=state.processIdentity(process.pid),now=Date.now(),base=now-360001,mono=performance.timeOrigin+performance.now();
 const run=state.createRun({runId:id,pid:process.pid,processIdentity:identity,startedAt:base,heartbeatAt:base,monotonicAt:mono,logPath:'stale-finish.ndjson',requestedMinutes:1,requestedCycles:3});state.writeRun(dir,run);state.heartbeat(dir,id,{now:base,monotonicNow:mono,identity,stage:'measurement',phase:'sample',measurementStartedAt:new Date(base).toISOString(),measuredElapsedMs:0});state.heartbeat(dir,id,{now:base+60000,monotonicNow:mono+60000,identity,measuredElapsedMs:60000});
 const sample=measuredMs=>({measuredMs,nodes:100,listeners:10,documents:1,heapBytes:1024,pendingRequests:0}),report={status:'passed',runId:id,requestedMinutes:1,requestedCycles:3,completedCycles:3,measurementStartedAt:new Date(base).toISOString(),measuredElapsedMs:60000,measurements:[sample(0),sample(30000),sample(60000)],buildFingerprint:'a'.repeat(64),buildInfo:{commit:'b'.repeat(40)},continuousAcceptance:{status:'passed',requiredMs:60000},publicSourceAcceptance:{status:'passed'}};
 try{assert.throws(()=>state.finishRun(dir,id,'passed',null,report),/five minutes/i);assert.equal(state.inspectRun(dir,id,{now}).status,'interrupted');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
