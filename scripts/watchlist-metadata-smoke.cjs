const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{chromium}=require('playwright');
const base='http://127.0.0.1:3216',dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-meta-browser-'));
// Seed only isolated, paused fixtures. No production state, model call or live tick is used.
process.env.MONEYMONEY_DATA_DIR=dataDir;
// Prevent dotenv from inheriting delivery/model credentials during this isolated test.
const isolatedEnvironment={OPENROUTER_API_KEY:'',GROQ_API_KEY:'',TELEGRAM_NETWORK_ENABLED:'false',TELEGRAM_ALLOWED_CHAT_IDS:'',TELEGRAM_ADMIN_CHAT_IDS:'',DISCORD_WEBHOOK_URL:'',LARK_WEBHOOK_URL:'',LARK_WEBHOOK_SECRET:'',MONEYMONEY_WEBHOOK_URL:'',MONEYMONEY_WEBHOOK_SECRET:'',WECOM_WEBHOOK_URL:'',BARK_DEVICE_KEY:'',MONEYMONEY_DISCORD_WEBHOOK_URL:'',MONEYMONEY_LARK_WEBHOOK_URL:'',MONEYMONEY_JSON_WEBHOOK_URL:''};
Object.assign(process.env,isolatedEnvironment);
const runners=require('../dist/features/ai-paper-runner');
const fixture=runners.createAiRunner('Stocks','AAPL','Isolated diagnostic fixture',1000,{}, {startPaused:true});
runners.appendAiRunnerDecision({id:'isolated-diagnostic-round',runnerId:fixture.id,idempotencyKey:'isolated-diagnostic-round',at:new Date().toISOString(),market:'stocks',instrument:'AAPL',dataStatus:'failed',source:'Isolated fixture',modelVersion:'fixture-model',modelCallStatus:'failed',signals:[],riskChecks:[{name:'freshness',passed:false,reason:'Fixture source timeout'}],action:'REJECTED',reason:'Fixture source timeout'});
require('../dist/storage/sqlite-state').stateStore.close();
const child=spawn(process.execPath,['dist/web/server.js'],{cwd:path.join(__dirname,'..'),stdio:'ignore',env:{...process.env,MONEYMONEY_DATA_DIR:dataDir,APP_HOST:'127.0.0.1',APP_PORT:'3216',MONEYMONEY_LOGIN_USER:'meta-owner',MONEYMONEY_LOGIN_PASS:'isolated-meta-owner-92!',MONEYMONEY_JWT_SECRET:'isolated-metadata-secret-0123456789abcdef',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',TELEGRAM_POLLING_ENABLED:'false',AI_PAPER_TRADING_ENABLED:'false',MONEYMONEY_DISABLE_GURU_REFRESH:'true',PRIVATE_KEY:'',API_KEY:''}});
(async()=>{let browser;try{
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health/live')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 browser=await chromium.launch({headless:true,channel:process.env.MONEYMONEY_SMOKE_BROWSER||'chrome'});
 const auth=await browser.newContext({serviceWorkers:'block'});assert.ok((await auth.request.post(base+'/api/auth/login',{data:{username:'meta-owner',password:'isolated-meta-owner-92!'}})).ok());
 const status=await auth.request.get(base+'/api/auth/status').then(r=>r.json()),headers={'x-csrf-token':status.data.csrfToken};
 for(const instrumentId of ['stock:us:AAPL','crypto:binance:BTCUSDT'])assert.ok((await auth.request.post(base+'/api/watchlist',{headers,data:{instrumentId}})).ok());
 const storageState=await auth.storageState();await auth.close();const results=[];
 for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',storageState}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/?market=watchlist&workspace=watchlist');
   const panel=page.locator('#workspace-watchlist-metadata');await panel.locator('summary').waitFor({state:'visible',timeout:20000});await panel.locator('summary').click();
   await panel.locator('[data-meta-id="stock:us:AAPL"]').waitFor();
   await panel.locator('[name=groupName]').fill('财报观察');await panel.locator('[data-meta-create]').click();await panel.locator('[role=status]').filter({hasText:'已保存'}).waitFor();
   const groupId=await panel.locator('[name=groupId] option').filter({hasText:'财报观察'}).last().getAttribute('value');
   await panel.locator('[data-meta-id="stock:us:AAPL"]').check();await panel.locator('[name=groupId]').selectOption(groupId);await panel.locator('[data-meta-enable=tags]').check();await panel.locator('[name=tags]').fill('现金流,财报');await panel.locator('[data-meta-save]').click();await panel.locator('[role=status]').filter({hasText:'已保存'}).waitFor();
   const stored=await context.request.get(base+'/api/watchlist/metadata').then(r=>r.json());assert.equal(stored.data.items['stock:us:AAPL'].groupId,groupId);assert.deepEqual(stored.data.items['stock:us:AAPL'].tags,['现金流','财报']);assert.equal(stored.data.items['crypto:binance:BTCUSDT'].groupId,null);
   for(const theme of ['light','dark','money']){
     await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
     const style=await panel.locator('[name=tags]').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,height:r.height};});
     assert.notEqual(style.background,'rgba(0, 0, 0, 0)');assert.notEqual(style.color,style.background);assert.ok(style.height>=40);results.push({width,theme,...style});
   }
   await panel.locator('[data-meta-undo]').click();await panel.locator('[role=status]').filter({hasText:'已保存'}).waitFor();
   const undone=await context.request.get(base+'/api/watchlist/metadata').then(r=>r.json());assert.notEqual(undone.data.items['stock:us:AAPL'].groupId,groupId);
   assert.deepEqual(errors,[]);await context.close();
 }
 const runnerContext=await browser.newContext({viewport:{width:1440,height:900},storageState,serviceWorkers:'block'}),runnerPage=await runnerContext.newPage(),runnerErrors=[];
 runnerPage.on('pageerror',e=>runnerErrors.push(e.message));await runnerPage.goto(base+'/?market=stocks&workspace=paper');
 await runnerPage.locator('[data-ai-diagnostics="'+fixture.id+'"]').waitFor({state:'visible',timeout:20000});await runnerPage.locator('[data-ai-diagnostics="'+fixture.id+'"]').click();
 const history=runnerPage.locator('#ai-runner-history-'+fixture.id);await history.getByText('逐轮原因诊断 · 只读').waitFor();await history.locator('summary').click();assert.match(await history.innerText(),/Fixture source timeout/);
 await history.locator('[data-ai-round-replay]').click();await history.locator('[data-ai-round-output]').filter({hasText:'未关联'}).waitFor();assert.deepEqual(runnerErrors,[]);
 assert.equal((await runnerContext.request.get(base+'/api/ai-runners/'+fixture.id+'/diagnostics').then(r=>r.json())).data.modelCalls,0);await runnerContext.close();
 const guest=await browser.newContext();await guest.request.post(base+'/api/auth/guest');assert.equal((await guest.request.get(base+'/api/watchlist/metadata')).status(),403);assert.equal((await guest.request.get(base+'/api/ai-runners/'+fixture.id+'/diagnostics')).status(),403);await guest.close();
 console.log(JSON.stringify({ok:true,private:true,results},null,2));
}finally{await browser?.close();child.kill('SIGINT');}})().catch(e=>{console.error(e.message);process.exitCode=1;});
