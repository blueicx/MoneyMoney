'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {evaluateContinuousSoak}=require('./continuous-soak.cjs');
const MAX_GAP_MS=300000;
const readMonotonic=()=>performance.timeOrigin+performance.now();
const validRunId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
function processIdentity(pid){
 if(!Number.isInteger(pid)||pid<=0)return null;
 try{
  if(process.platform==='linux'){
   const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
   return `linux:${fields[19]}`;
  }
  if(process.platform==='win32'){
   const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if($p){$p.CreationDate.ToUniversalTime().ToString('o')}`;
   const value=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim();
   return value?`windows:${value}`:null;
  }
  const value=execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:3000}).trim();
  return value?`unix:${value}`:null;
 }catch{return null;}
}
function signature(run){return createHash('sha256').update([run.runId,run.pid,run.processIdentity,run.expectedBuildFingerprint||'',run.expectedBuildCommit||''].join('|')).digest('hex');}
function heartbeatSignature(run){return createHash('sha256').update([signature(run),run.status,run.reason,run.finishedAt,JSON.stringify(run.acceptance||null),run.heartbeatAt,run.monotonicAt,run.elapsedMs,run.stage,run.phase,run.measurementStartedAt,run.measuredElapsedMs].join('|')).digest('hex');}
function createRun({runId=randomUUID(),pid,processIdentity:identity,startedAt=Date.now(),heartbeatAt=startedAt,monotonicAt=readMonotonic(),logPath,requestedMinutes=0,requestedCycles=0,profile='loopback',expectedBuildFingerprint=null,expectedBuildCommit=null}){
 if(!validRunId(runId))throw Error('runId must be a UUID');
 if(!Number.isInteger(pid)||!identity||!logPath)throw Error('process identity, pid and log path are required');
 const run={schema:1,runId,status:'warming',stage:'warming',phase:'starting',pid,processIdentity:identity,expectedBuildFingerprint,expectedBuildCommit,startedAt,heartbeatAt,monotonicAt,elapsedMs:0,measuredElapsedMs:0,measurementStartedAt:null,requestedMinutes,requestedCycles,profile,logPath,reason:null};
 run.signature=signature(run);run.heartbeatSignature=heartbeatSignature(run);return run;
}
function writeRun(directory,run){
 if(!validRunId(run?.runId))throw Error('runId must be a UUID');
 const target=path.join(directory,'runs',`${run.runId}.json`);fs.mkdirSync(path.dirname(target),{recursive:true});
 const tmp=target+'.tmp';fs.writeFileSync(tmp,JSON.stringify(run,null,2));fs.renameSync(tmp,target);return target;
}
function classifyRun(run,{now=Date.now(),monotonicNow=readMonotonic(),identity=processIdentity(run.pid)}={}){
 if(!run||run.schema!==1||!validRunId(run.runId))return {status:'interrupted',reason:'invalid run record'};
 if(run.signature!==signature(run)||run.heartbeatSignature!==heartbeatSignature(run))return {status:'interrupted',reason:'run identity or heartbeat signature mismatch'};
 if(['failed','passed','interrupted'].includes(run.status))return {status:run.status,reason:run.reason||null};
 if(!['warming','running'].includes(run.status))return {status:'interrupted',reason:'invalid run status'};
 const gap=now-run.heartbeatAt;
 if(!Number.isFinite(gap)||gap<0||gap>MAX_GAP_MS)return {status:'interrupted',reason:'heartbeat gap exceeds five minutes'};
 if(Number.isFinite(run.monotonicAt)&&Number.isFinite(monotonicNow)&&gap-(monotonicNow-run.monotonicAt)>30000)return {status:'interrupted',reason:'system sleep or wall clock gap detected'};
 if(!identity||identity!==run.processIdentity)return {status:'interrupted',reason:'process missing or identity changed'};
 if(run.stage==='measurement'&&(!Number.isFinite(Date.parse(run.measurementStartedAt))||!Number.isFinite(run.measuredElapsedMs)||run.measuredElapsedMs<0))return {status:'interrupted',reason:'measurement clock evidence invalid'};
 return {status:'running',reason:null};
}
function inspectRun(directory,runId,{now=Date.now(),identity}={}){
 if(!validRunId(runId))throw Error('runId must be a UUID');
 const file=path.join(directory,'runs',`${runId}.json`);if(!fs.existsSync(file))throw Error(`run not found: ${runId}`);
 const run=JSON.parse(fs.readFileSync(file,'utf8')),result=classifyRun(run,{now,identity:identity===undefined?processIdentity(run.pid):identity});
 if(['warming','running'].includes(run.status)&&result.status==='interrupted'){
  run.status='interrupted';run.reason=result.reason;run.finishedAt=now;run.elapsedMs=run.measuredElapsedMs;run.heartbeatSignature=heartbeatSignature(run);writeRun(directory,run);
 }
 const measured=result.status==='running'&&run.stage==='measurement'?Math.max(run.measuredElapsedMs,now-Date.parse(run.measurementStartedAt)):run.measuredElapsedMs;
 return {...run,...result,elapsedMs:measured,wallElapsedMs:Math.max(0,now-run.startedAt),heartbeatGapMs:Math.max(0,now-run.heartbeatAt)};
}
function heartbeat(directory,runId,{now=Date.now(),monotonicNow=readMonotonic(),identity=processIdentity(process.pid),stage,phase,measurementStartedAt,measuredElapsedMs}={}){
 if(!validRunId(runId))throw Error('runId must be a UUID');
 const file=path.join(directory,'runs',`${runId}.json`),run=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!['warming','running'].includes(run.status)||run.pid!==process.pid||identity!==run.processIdentity||run.signature!==signature(run)||run.heartbeatSignature!==heartbeatSignature(run))throw Error('heartbeat process identity mismatch, invalid signature, or run is terminal');
 const gap=now-run.heartbeatAt;if(!Number.isFinite(gap)||gap<0||gap>MAX_GAP_MS)throw Error('heartbeat gap exceeds five minutes');
 const elapsedGap=gap-(monotonicNow-run.monotonicAt);if(elapsedGap>30000)throw Error('system sleep or wall clock gap detected');
 if(stage!==undefined){if(!['warming','measurement'].includes(stage))throw Error('invalid run stage');run.stage=stage;run.phase=String(phase||stage).slice(0,80);}
 if(measurementStartedAt!==undefined&&measurementStartedAt!==null){if(!Number.isFinite(Date.parse(measurementStartedAt)))throw Error('invalid measurement start time');run.measurementStartedAt=measurementStartedAt;run.stage='measurement';run.status='running';}
 if(measuredElapsedMs!==undefined){if(!Number.isFinite(measuredElapsedMs)||measuredElapsedMs<0)throw Error('invalid measured elapsed time');run.measuredElapsedMs=measuredElapsedMs;}
 run.heartbeatAt=now;run.monotonicAt=monotonicNow;run.elapsedMs=run.measurementStartedAt?Math.max(0,now-Date.parse(run.measurementStartedAt)):0;run.heartbeatSignature=heartbeatSignature(run);writeRun(directory,run);return run;
}
function validateAcceptance(run,report){
 const reasons=[];
 if(!report||report.status!=='passed')reasons.push('smoke report did not pass');
 if(report?.runId!==run?.runId)reasons.push('smoke report run id does not match supervised run');
 if(!Array.isArray(report?.measurements)||report.measurements.length<3)reasons.push('at least three measured observations are required');
 if(!/^[a-f0-9]{64}$/.test(report?.buildFingerprint||'')||!/^[a-f0-9]{40}$/.test(report?.buildInfo?.commit||''))reasons.push('fixed build fingerprint or 40-hex commit is invalid');
 if(!/^[a-f0-9]{64}$/.test(run?.expectedBuildFingerprint||'')||!/^[a-f0-9]{40}$/.test(run?.expectedBuildCommit||''))reasons.push('run has no valid frozen build identity');
 if(report?.buildFingerprint!==run?.expectedBuildFingerprint||report?.buildInfo?.commit!==run?.expectedBuildCommit)reasons.push('smoke report build identity differs from run-frozen build');
 if(Number.isFinite(run?.measuredElapsedMs)&&Number.isFinite(report?.measuredElapsedMs)&&(report.measuredElapsedMs<run.measuredElapsedMs||report.measuredElapsedMs-run.measuredElapsedMs>MAX_GAP_MS))reasons.push('smoke report measured duration differs from supervised heartbeat');
 if(report?.continuousAcceptance?.status!=='passed')reasons.push('continuous soak acceptance did not pass');
 if(report?.publicSourceAcceptance?.status!=='passed')reasons.push('public source acceptance did not pass');
 if(!Number.isFinite(Date.parse(report?.measurementStartedAt))||!Number.isFinite(Date.parse(run?.measurementStartedAt))||report.measurementStartedAt!==run.measurementStartedAt)reasons.push('measurement start does not match supervised run');
 const requiredMs=Number(run?.requestedMinutes)*60000;
 if(!Number.isFinite(requiredMs)||requiredMs<=0||report?.continuousAcceptance?.requiredMs!==requiredMs||report?.measuredElapsedMs<requiredMs)reasons.push('required measured duration not proven');
 if(report?.requestedMinutes!==run?.requestedMinutes||report?.requestedCycles!==run?.requestedCycles||!Number.isSafeInteger(run?.requestedCycles)||run.requestedCycles<3||!Number.isSafeInteger(report?.completedCycles)||report.completedCycles<run.requestedCycles)reasons.push('reported request or completed cycle count differs from supervised run');
 const measurements=report?.measurements;
 if(!Array.isArray(measurements)||measurements.length<3||!Number.isFinite(measurements[0]?.measuredMs)||measurements[0].measuredMs<0||!Number.isFinite(measurements.at(-1)?.measuredMs)||measurements.at(-1).measuredMs<requiredMs)reasons.push('report observations do not span required measured duration');
 if(Array.isArray(measurements)){
  let previous=-1;
  for(const row of measurements){
   if(!Number.isFinite(row?.measuredMs)||row.measuredMs<=previous){reasons.push('report observation times must be finite and strictly increasing');break;}
   previous=row.measuredMs;
   if(!['nodes','listeners','documents','heapBytes','pendingRequests'].every(key=>Number.isFinite(row[key])&&row[key]>=0)){reasons.push('report observation resource evidence is missing or invalid');break;}
  }
  try{const continuous=evaluateContinuousSoak(report,requiredMs);if(continuous.status!=='passed')reasons.push('independent continuous soak validation failed: '+continuous.reasons.join(', '));}
  catch(error){reasons.push('independent continuous soak validation failed: '+error.message);}
 }
 return {status:reasons.length?'failed':'passed',requiredMs,reasons,reportHash:createHash('sha256').update(JSON.stringify(report??null)).digest('hex')};
}function finishRun(directory,runId,status,reason=null,report=null){
 if(!validRunId(runId))throw Error('runId must be a UUID');
 if(!['passed','failed','interrupted'].includes(status))throw Error('invalid terminal status');
 const file=path.join(directory,'runs',`${runId}.json`),run=JSON.parse(fs.readFileSync(file,'utf8'));
 if(run.signature!==signature(run)||run.heartbeatSignature!==heartbeatSignature(run))throw Error('run identity or heartbeat signature invalid');
 if(!['warming','running'].includes(run.status))throw Error('terminal run status cannot be changed');
 if(status==='passed'){const now=Date.now(),gap=now-run.heartbeatAt,elapsedGap=gap-(readMonotonic()-run.monotonicAt),identity=processIdentity(run.pid);if(!Number.isFinite(gap)||gap<0||gap>MAX_GAP_MS)throw Error('heartbeat gap exceeds five minutes');if(elapsedGap>30000)throw Error('system sleep or wall clock gap detected');if(!identity||identity!==run.processIdentity)throw Error('supervised process identity changed before completion');const acceptance=validateAcceptance(run,report);if(acceptance.status!=='passed')throw Error(acceptance.reasons.join('; '));run.acceptance=acceptance;run.measuredElapsedMs=report.measuredElapsedMs;}
 run.status=status;run.reason=reason;run.finishedAt=Date.now();run.elapsedMs=run.measuredElapsedMs;run.heartbeatSignature=heartbeatSignature(run);writeRun(directory,run);return run;
}
module.exports={MAX_GAP_MS,validRunId,processIdentity,createRun,writeRun,classifyRun,inspectRun,heartbeat,validateAcceptance,finishRun};
