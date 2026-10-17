'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'moneymoney-isolated-reliability-'));
const files=['ai-runner-contract.test.cjs','ai-runner-model.test.cjs','ai-runner-coordinator.test.cjs','ai-runner-state.test.cjs','backup-disk-preflight.test.cjs','state-backup.test.cjs'];
const git=args=>spawnSync('git',args,{cwd:root,encoding:'utf8'}),commit=git(['rev-parse','HEAD']).stdout.trim();
const release=process.argv.includes('--release'),clean=git(['diff','--quiet','HEAD','--','src','scripts','tests']).status===0;
if(release&&!clean)throw Error('Release drill requires committed source/tests; preview report stays isolated');
const report={version:1,commit,cleanTree:clean,status:'passed',isolated:true,network:'loopback-only',platform:process.platform,startedAt:new Date().toISOString(),completedAt:null,cases:[],modelCalls:0,productionOrders:0};
try{
 for(const name of files){
  const file=path.join(root,'tests',name),directory=fs.mkdtempSync(path.join(temporary,'case-')),env={...process.env};
  for(const key of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|_PASS$|API_KEY|PRIVATE_KEY/.test(key.toUpperCase()))env[key]='';
  Object.assign(env,{MONEYMONEY_DATA_DIR:directory,AI_PAPER_TRADING_ENABLED:'false',TELEGRAM_POLLING_ENABLED:'false',MONEYMONEY_DISABLE_GURU_REFRESH:'true',NODE_OPTIONS:'--require '+JSON.stringify(path.join(root,'tests/helpers/offline-drill-guard.cjs'))});delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',file],{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  const count=label=>Number(result.stdout?.match(new RegExp('^# '+label+' (\\d+)','m'))?.[1]??-1);
  const entry={name,passed:count('pass'),failed:count('fail'),skipped:count('skipped'),exitCode:result.status??-1,sourceHash:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  report.cases.push(entry);if(entry.exitCode!==0||entry.failed!==0||entry.skipped!==0||entry.passed<=0)report.status='failed';
  fs.writeFileSync(path.join(temporary,name+'.log'),String(result.stdout||'')+String(result.stderr||''));
  process.stdout.write(JSON.stringify(entry)+'\n');
 }
 report.completedAt=new Date().toISOString();const serialized=JSON.stringify(report,null,2)+'\n';fs.writeFileSync(path.join(temporary,'report.json'),serialized);
 if(release&&report.status==='passed')fs.writeFileSync(path.join(root,'dist','reliability-drill.json'),serialized);
 process.stdout.write(JSON.stringify({status:report.status,isolated:true,report:path.join(temporary,'report.json'),releaseArtifact:release&&report.status==='passed'})+'\n');
 if(report.status!=='passed')process.exitCode=1;
}catch(error){process.stderr.write('Isolated reliability drill failed; production state untouched\n');process.exitCode=1;}
