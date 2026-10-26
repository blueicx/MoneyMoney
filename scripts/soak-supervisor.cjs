'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const state=require('./lib/soak-run-state.cjs');
const ROOT=path.resolve(__dirname,'..');
function readBuildIdentity(){
 const dist=path.join(ROOT,'dist'),buildInfo=JSON.parse(fs.readFileSync(path.join(dist,'build-info.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(buildInfo.commit||''))throw Error('fixed build commit must be 40 lowercase hex characters');
 const digest=createHash('sha256'),walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(!/\.(gz|br)$/.test(entry.name))digest.update(path.relative(ROOT,file)).update(fs.readFileSync(file));}};
 walk(dist);return {commit:buildInfo.commit,fingerprint:digest.digest('hex')};
}
function argsOf(argv){const [command,...rest]=argv,out={command};for(let i=0;i<rest.length;i++){if(rest[i].startsWith('--'))out[rest[i].slice(2)]=rest[++i];else throw Error(`unexpected argument: ${rest[i]}`);}return out;}
function summary(run){return {runId:run.runId,status:run.status,stage:run.stage,phase:run.phase,elapsedMs:run.elapsedMs,wallElapsedMs:run.wallElapsedMs,heartbeatGapMs:run.heartbeatGapMs,reason:run.reason||undefined,logPath:run.logPath,startedAt:new Date(run.startedAt).toISOString(),measurementStartedAt:run.measurementStartedAt||undefined};}
function inspectDescriptor(file){
 const descriptor=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
 const identity=Number.isInteger(descriptor.pid)?state.processIdentity(descriptor.pid):null;
 const launchedAt=Date.parse(descriptor.measurementStartedAt||descriptor.launchedAt||'');
 const heartbeatAgeMs=Number.isFinite(launchedAt)?Date.now()-launchedAt:null;
 const result={status:'interrupted',pid:descriptor.pid,heartbeatAgeMs,reason:'legacy run descriptor has no signed run id, OS process start identity, or supervisor heartbeat'};
 if(identity&&Number.isFinite(launchedAt)&&heartbeatAgeMs<=state.MAX_GAP_MS)result.reason='legacy descriptor cannot prove process identity or signed heartbeat';
 return result;
}
async function worker({dir,runId}){
 if(!state.validRunId(runId))throw Error('runId must be a UUID');
 const runFile=path.join(dir,'runs',`${runId}.json`);
 for(let i=0;i<50&&!fs.existsSync(runFile);i++)await new Promise(resolve=>setTimeout(resolve,100));
 if(!fs.existsSync(runFile))throw Error('run record not created');
 const record=JSON.parse(fs.readFileSync(runFile,'utf8')),ownIdentity=state.processIdentity(process.pid);
 if(record.pid!==process.pid||record.processIdentity!==ownIdentity)throw Error('worker process identity does not match run record');
 const logFd=fs.openSync(record.logPath,'a');
 const child=spawn(process.execPath,[path.join(__dirname,'long-session-smoke.cjs')],{cwd:ROOT,windowsHide:true,stdio:['ignore',logFd,logFd,'ipc'],env:{...process.env,MONEYMONEY_SOAK_RUN_ID:runId,MONEYMONEY_SOAK_DATA_DIR:path.dirname(record.logPath)}});
 child.on('message',message=>{if(message?.type==='soak-heartbeat'&&message.runId===runId){try{state.heartbeat(dir,runId,{identity:ownIdentity,stage:message.stage,phase:message.phase,measurementStartedAt:message.measurementStartedAt,measuredElapsedMs:message.measuredElapsedMs});}catch(error){process.stderr.write(`heartbeat failed: ${error.message}\n`);requestedStop=/gap|sleep|identity/i.test(error.message)?'HEARTBEAT_GAP':'HEARTBEAT_INVALID';child.kill('SIGTERM');}}});
 let requestedStop=null,forceKill;
 const stopOwnedChild=()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');clearTimeout(forceKill);forceKill=setTimeout(()=>child.kill('SIGKILL'),2000);}};
 const onWorkerSignal=()=>{requestedStop='WORKER_STOPPED';stopOwnedChild();};process.once('SIGTERM',onWorkerSignal);process.once('SIGINT',onWorkerSignal);
 const budgetMs=(record.requestedMinutes+Math.max(12,Math.ceil(record.requestedMinutes*.1)))*60000;let watchdog,poll;const result=await new Promise(resolve=>{let settled=false;const done=value=>{if(settled)return;settled=true;clearTimeout(watchdog);clearInterval(poll);clearTimeout(forceKill);process.removeListener('SIGTERM',onWorkerSignal);process.removeListener('SIGINT',onWorkerSignal);resolve(value);};poll=setInterval(()=>{try{const observed=state.inspectRun(dir,runId,{identity:ownIdentity});if(observed.status==='interrupted'){requestedStop='HEARTBEAT_GAP';stopOwnedChild();}}catch(error){process.stderr.write(`watchdog inspect failed: ${error.message}\n`);}},30000);poll.unref();watchdog=setTimeout(()=>{requestedStop='SUPERVISOR_BUDGET_EXCEEDED';stopOwnedChild();},budgetMs);watchdog.unref();child.once('error',()=>done({code:127,signal:requestedStop}));child.once('exit',(code,signal)=>done({code,signal:requestedStop||signal}));});fs.closeSync(logFd);
 let status=result.signal==='SUPERVISOR_BUDGET_EXCEEDED'?'failed':result.signal?'interrupted':result.code===0?'passed':'failed',reason=result.signal==='SUPERVISOR_BUDGET_EXCEEDED'?'finite supervisor runtime budget exceeded':result.signal?('soak child received '+result.signal):result.code===0?null:('soak child exited '+result.code);
 if(status==='passed'){
  try{const report=JSON.parse(fs.readFileSync(path.join(path.dirname(record.logPath),'soak-report.json'),'utf8'));state.finishRun(dir,runId,'passed',null,report);}
  catch(error){status='failed';reason=`acceptance evidence missing or invalid: ${error.message}`;state.finishRun(dir,runId,status,reason);}
 }else if(result.signal!=='HEARTBEAT_GAP')state.finishRun(dir,runId,status,reason);
 return status==='passed'?0:1;
}
function startRun(options){
 const dir=path.resolve(options.dir||path.join(ROOT,'.soak-runs'));
 const minutes=Number(options.minutes||1440),cycles=Number(options.cycles||3),profile=options.profile||'isolated-fixed-build',browser=options.browser||'chrome';
 if(!Number.isInteger(minutes)||minutes<1||minutes>1440||!Number.isInteger(cycles)||cycles<3||cycles>10000)throw Error('minutes must be 1..1440 and cycles 3..10000');
 if(!['loopback','isolated-fixed-build'].includes(profile))throw Error('profile must be loopback or isolated-fixed-build');
 const expectedBuild=readBuildIdentity();
 const runId=randomUUID(),runDir=path.join(dir,'runs',runId);fs.mkdirSync(runDir,{recursive:true});const logPath=path.join(runDir,'supervisor.log'),log=fs.openSync(logPath,'a');
 const child=spawn(process.execPath,[__filename,'worker','--dir',dir,'--runId',runId],{cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,MONEYMONEY_SOAK_MINUTES:String(minutes),MONEYMONEY_SOAK_CYCLES:String(cycles),MONEYMONEY_SOAK_SAMPLE_MS:'60000',MONEYMONEY_SOAK_OFFLINE:'0',MONEYMONEY_SMOKE_BROWSER:browser}});
 const identity=state.processIdentity(child.pid);if(!identity){try{process.kill(child.pid,'SIGTERM');}catch{}fs.closeSync(log);throw Error('cannot establish supervisor process start identity');}
 const record=state.createRun({runId,pid:child.pid,processIdentity:identity,expectedBuildFingerprint:expectedBuild.fingerprint,expectedBuildCommit:expectedBuild.commit,logPath,startedAt:Date.now(),heartbeatAt:Date.now(),requestedMinutes:minutes,requestedCycles:cycles,profile});state.writeRun(dir,record);child.unref();fs.closeSync(log);
 return {runId,status:'warming',pid:child.pid,elapsedMs:0,logPath};
}
async function main(argv=process.argv.slice(2)){
 const options=argsOf(argv);
 if(options.command==='worker')return worker(options);
 if(options.command==='inspect'){
  if(options.descriptor){console.log(JSON.stringify(inspectDescriptor(options.descriptor)));return;}
  if(!options.runId)throw Error('inspect requires --runId or --descriptor');
  console.log(JSON.stringify(summary(state.inspectRun(options.dir||path.join(ROOT,'.soak-runs'),options.runId))));return;
 }
 if(options.command==='start'){console.log(JSON.stringify(startRun(options)));return;}
 console.log('Usage: node scripts/soak-supervisor.cjs start --profile loopback|isolated-fixed-build [--minutes 1440] [--cycles 3] [--browser chrome] [--dir PATH]\n       node scripts/soak-supervisor.cjs inspect --dir PATH --runId ID\n       node scripts/soak-supervisor.cjs inspect --descriptor PATH');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={argsOf,inspectDescriptor,readBuildIdentity,startRun,summary,worker};
