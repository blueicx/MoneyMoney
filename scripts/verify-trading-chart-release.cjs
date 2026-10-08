// Run on the current VPS as root. Credentials stay in process memory, never in output.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {captureProtectedRunner,assertProtectedRunnerPreserved}=require('./protected-runner-release.cjs');
process.chdir('/opt/moneymoney');
const env=require('/opt/moneymoney/node_modules/dotenv').parse(fs.readFileSync('/etc/moneymoney/moneymoney.env'));
async function main(){
  const publicBase='https://bluetrade.bbroot.com',base='http://127.0.0.1:3001',expected=process.argv[2];assert.ok(expected);
  const capture=expected==='--capture',baselinePath=process.argv[3];
  assert.ok(/^\/tmp\/moneymoney-[a-zA-Z0-9._-]+\.json$/.test(baselinePath || ''),'bounded release baseline path required');
  const baseline=capture?null:JSON.parse(fs.readFileSync(baselinePath));
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:env.MONEYMONEY_LOGIN_USER,password:env.MONEYMONEY_LOGIN_PASS})});assert.equal(response.status,200);
  const login=await response.json(),headers={Authorization:'Bearer '+login.token};
  const readRunners=async()=>{const r=await fetch(base+'/api/ai-runners',{headers});assert.equal(r.status,200);const body=await r.json();assert.ok(Array.isArray(body.data));return body.data;};
  if(capture){fs.writeFileSync(baselinePath,JSON.stringify(captureProtectedRunner(await readRunners())),{flag:'wx',mode:0o600});console.log(JSON.stringify({ok:true,protectedRunnerBaselineCaptured:true,modelCallsIssued:0}));return;}
  assertProtectedRunnerPreserved(baseline,await readRunners());
  const manifest=JSON.parse(fs.readFileSync('dist/web/public/asset-manifest.json'));
  for(const [url,record]of Object.entries(manifest))assert.equal(crypto.createHash('sha256').update(fs.readFileSync('dist/web/public'+url)).digest('hex'),record.sha256);
  const version=await fetch(publicBase+'/api/health/version').then(r=>r.json());assert.equal(version.commit,expected);
  const sourceChecks=[];
  for(const symbol of ['usAAPL','usSNDK']){const r=await fetch(publicBase+'/api/stock/kline?symbol='+symbol+'&period=5m&interval=5m',{headers});assert.equal(r.status,200);const d=await r.json();const rows=d.data || [];if(rows.length)assert.ok(rows.every(b=>b.high>=Math.max(b.open,b.close) && b.low<=Math.min(b.open,b.close) && b.time<=Date.now()));else assert.ok(d.reason || d.error);sourceChecks.push({market:'stocks',instrument:symbol,records:rows.length,status:d.dataStatus,source:d.source,reason:d.reason || null});}
  const contract=await fetch(publicBase+'/api/contracts/kline?market=crypto&instrument=crypto%3Agateio%3ABTC_USDT&interval=5m',{headers}).then(r=>r.json());assert.ok(contract.success);assert.equal(contract.instrument,'crypto:gateio:BTC_USDT');assert.equal(contract.volumeUnit,'contracts');assert.equal(contract.executionEnabled,false);if(contract.data.length)assert.ok(contract.data.every(b=>b.high>=Math.max(b.open,b.close) && b.low<=Math.min(b.open,b.close) && b.volume>=0 && b.time<=Date.now()));else assert.ok(contract.reason);sourceChecks.push({market:'crypto-contract',records:contract.data.length,status:contract.dataStatus,source:contract.source,reason:contract.reason});
  const invalid=await fetch(base+'/api/contracts/kline?market=stocks&instrument=crypto%3Agateio%3ABTC_USDT',{headers});assert.equal(invalid.status,400);
  const guest=await fetch(base+'/api/auth/guest',{method:'POST'}).then(r=>r.json());const denied=await fetch(base+'/api/kline-stream?market=crypto&instrument=BTCUSDT&interval=5m',{headers:{Authorization:'Bearer '+guest.token}});assert.equal(denied.status,403);
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),20000);let valid=0,buffer='';
  try {const stream=await fetch(publicBase+'/api/kline-stream?market=crypto&instrument=BTCUSDT&interval=5m',{headers,signal:controller.signal});assert.equal(stream.status,200);const reader=stream.body.getReader(),decoder=new TextDecoder();while(valid<2){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!frame.includes('event: kline'))continue;const row=JSON.parse(frame.split('\n').find(l=>l.startsWith('data: ')).slice(6));assert.equal(row.dataStatus,'live');assert.equal(row.instrument,'crypto:binance:BTCUSDT');assert.ok(row.eventTime>Date.now()-60000);valid++;}}}finally{clearTimeout(deadline);controller.abort();}assert.ok(valid>=2);
  assertProtectedRunnerPreserved(baseline,await readRunners());
  assert.equal((await fetch(publicBase+'/login')).status,200);
  console.log(JSON.stringify({ok:true,commit:version.commit,assets:Object.keys(manifest).length,sourceChecks,sseRealUpdates:valid,guestDenied:true,invalidMarketDenied:true,runnerBudgetAndUniversePreserved:true,runnerConfigurationAndStatusPreserved:true,modelCallsIssued:0}));
}
main().catch(()=>{console.error('Trading chart release verification failed; no secrets logged');process.exitCode=1;});
