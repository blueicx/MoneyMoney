const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('private comparison API creates paused accounts and rejects invalid execution before upstream work',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moneymoney-comparison-api-')),base='http://127.0.0.1:3213';
 const child=spawn(process.execPath,['dist/web/server.js'],{cwd:path.join(__dirname,'..'),stdio:'ignore',env:{...process.env,MONEYMONEY_DATA_DIR:dir,APP_HOST:'127.0.0.1',APP_PORT:'3213',MONEYMONEY_LOGIN_USER:'comparison-test',MONEYMONEY_LOGIN_PASS:'temporary-comparison-123!',MONEYMONEY_JWT_SECRET:'test_comparison_api_only_secret_123456',TELEGRAM_NETWORK_ENABLED:'false',TELEGRAM_POLLING_ENABLED:'false',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',TELEGRAM_ALLOWED_CHAT_IDS:'',TELEGRAM_ADMIN_CHAT_IDS:'',OPENROUTER_API_KEY:'',OPENAI_API_KEY:'',AI_PAPER_TRADING_ENABLED:'true',MONEYMONEY_DISABLE_GURU_REFRESH:'true',PRIVATE_KEY:'',API_KEY:''}});
 const exit=new Promise(resolve=>child.once('exit',resolve));
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health/live')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'comparison-test',password:'temporary-comparison-123!'})});assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(row=>row.split(';')[0]).join('; ');
  const csrf=decodeURIComponent(cookie.match(/mm_csrf=([^;]+)/)[1]);
  const get=async url=>fetch(base+url,{headers:{Cookie:cookie}}),post=async(url,data)=>fetch(base+url,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:base},body:JSON.stringify(data)});
  const response=await post('/api/ai-runners/comparisons',{venue:'Stocks',symbolOrMarketId:'AAPL',title:'Apple',budgetUsd:100,seed:42});assert.equal(response.status,200);const {data:group}=await response.json();
  const list=await(await get('/api/ai-runners?market=stocks')).json(),rows=list.data.filter(row=>group.runnerIds.includes(row.id));assert.equal(rows.length,3);assert.ok(rows.every(row=>row.status==='STOPPED'));assert.equal(new Set(rows.map(row=>row.accountId)).size,3);
  assert.equal((await post('/api/ai-runners/comparisons/'+group.id+'/tick',{})).status,400,'missing idempotency key must not activate accounts');
  assert.equal((await post('/api/ai-runners/'+rows[0].id+'/tick',{})).status,409,'individual tick cannot evade comparison sampling');
  assert.equal((await post('/api/ai-runners/policy',{id:rows[0].id,policy:{feeRateBps:30}})).status,400);
  assert.equal((await post('/api/ai-runners/comparisons',{venue:'Stocks',symbolOrMarketId:'AAPL',budgetUsd:100,seed:42,universe:{kind:'watchlist',instruments:[{venue:'Stocks',symbolOrMarketId:'AAPL'},{venue:'Binance',symbolOrMarketId:'BTCUSDT'}]}})).status,400);
  assert.equal((await get('/api/ai-runners/comparisons/'+group.id+'/samples/missing/replay')).status,404);
  const after=await(await get('/api/ai-runners?market=stocks')).json();assert.ok(after.data.every(row=>row.status==='STOPPED' && !row.trades.length && !row.aiCalls?.length));
  const guest=await fetch(base+'/api/auth/guest',{method:'POST'});assert.equal(guest.status,200);const guestCookie=guest.headers.getSetCookie().map(row=>row.split(';')[0]).join('; ');
  assert.equal((await fetch(base+'/api/ai-runners/comparisons/'+group.id,{headers:{Cookie:guestCookie}})).status,403);
 }finally{child.kill();await exit;fs.rmSync(dir,{recursive:true,force:true});}
});
