// Isolated acceptance only; external source dependencies are synthetic fixtures.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),{chromium}=require(path.join(root,'node_modules/playwright'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-relationship-browser-')),phase=path.join(dir,'phase');
fs.writeFileSync(phase,'original');
const preload=path.join(dir,'source-fixtures.cjs');
fs.writeFileSync(preload,`
const fs=require('node:fs'),path=require('node:path'),root=process.env.MM_ACCEPTANCE_ROOT;
const radar=require(path.join(root,'dist/features/prediction-radar'));
const rows=[{platform:'Kalshi',id:'FIXTURE-A',title:'Isolated A',yesPrice:.7},{platform:'Kalshi',id:'FIXTURE-B',title:'Isolated B',yesPrice:.6}];
const observedAt=new Date(Date.now()-1000).toISOString();
const snapshot=()=>({updatedAt:observedAt,markets:rows,opportunities:[],sources:{}});
radar.getCachedPredictionRadarSlice=snapshot;radar.getPredictionRadar=async()=>snapshot();radar.warmPredictionRadarCache=async()=>{};
const {PredictionSettlementRepository}=require(path.join(root,'dist/features/prediction-settlement'));
PredictionSettlementRepository.prototype.latest=function(platform,id){if(!rows.some(r=>r.platform===platform&&r.id===id))return null;return {rulesHash:(fs.readFileSync(process.env.MM_ACCEPTANCE_PHASE,'utf8')==='changed'?'c':id==='FIXTURE-A'?'a':'b').repeat(64),evidenceHash:'isolated-source-'+id};};
`);
const env={...process.env,MM_ACCEPTANCE_ROOT:root,MM_ACCEPTANCE_PHASE:phase,MONEYMONEY_DATA_DIR:dir,APP_HOST:'127.0.0.1',APP_PORT:'3197',MONEYMONEY_LOGIN_USER:'isolated-owner',MONEYMONEY_LOGIN_PASS:'isolated-relationship-password',MONEYMONEY_JWT_SECRET:'isolated-relationship-secret-01234567890',TELEGRAM_NETWORK_ENABLED:'false',TELEGRAM_POLLING_ENABLED:'false',AI_PAPER_TRADING_ENABLED:'false',MONEYMONEY_DISABLE_GURU_REFRESH:'true',MONEYMONEY_KLINE_STREAM_ENABLED:'false'};
for(const key of Object.keys(env))if(/TOKEN|API_KEY|WEBHOOK|PRIVATE_KEY|BARK_DEVICE_KEY|TELEGRAM_CHAT|TELEGRAM_ALLOWED|TELEGRAM_ADMIN/.test(key))env[key]='';
const log=fs.openSync(path.join(dir,'server.log'),'a'),base='http://127.0.0.1:3197';let child,browser;
async function mount(page){await page.evaluate(async()=>{setMarketScope('prediction');openWorkspace('prediction-radar');await MoneyWorkspaceModules.ensure('prediction');const a={platform:'Kalshi',id:'FIXTURE-A',title:'Isolated A'},b={platform:'Kalshi',id:'FIXTURE-B',title:'Isolated B'};predictionRadarState.cards.set('fixture-a',a);predictionRadarState.cards.set('fixture-b',b);document.getElementById('fixture-relationship')?.remove();const host=document.createElement('section');host.id='fixture-relationship';document.getElementById('center-workspace').append(host);attachPredictionRelationshipCheck(host,a);});await page.locator('#fixture-relationship > details > summary').click();return page.locator('#fixture-relationship');}
async function readGraph(page,host,expected){await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/prediction/relationships?market=prediction')),host.getByRole('button',{name:'读取已保存的人工关系图',exact:true}).click()]);const graph=host.locator('[data-prediction-relationship-graph]');await graph.getByText(expected).waitFor({state:'attached'});await graph.locator('details > summary').click();await graph.getByText(expected).waitFor();}
async function main(){try{
 child=spawn(process.execPath,['--require',path.join(root,'tests/helpers/offline-drill-guard.cjs'),'--require',preload,'dist/web/server.js'],{cwd:root,env,stdio:['ignore',log,log]});
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('isolated server exited; '+dir);try{if((await fetch(base+'/api/health/live')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login');await page.fill('#username',env.MONEYMONEY_LOGIN_USER);await page.fill('#password',env.MONEYMONEY_LOGIN_PASS);await Promise.all([page.waitForURL(u=>u.pathname==='/'),page.click('#submitBtn')]);await page.waitForFunction(()=>window.mm_dashboardCoreReady);
 let host=await mount(page),requests=0;page.on('request',r=>{if(r.url().endsWith('/api/prediction/relationships/check'))requests++;});
 await host.getByRole('button',{name:'检查现有快照',exact:true}).click();assert.equal(requests,0);
 await host.getByLabel('比较事件',{exact:true}).selectOption('prediction:kalshi:FIXTURE-B');await host.locator('input[type=checkbox]').first().check();await host.locator('[data-prediction-relationship-save]').check();
 await host.getByRole('button',{name:'检查现有快照',exact:true}).click();assert.equal(requests,0);
 await host.getByLabel('人工关系核对依据',{exact:true}).fill('隔离测试：明确核对双方规则，不是官方证据。');
 const [saved]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/prediction/relationships/check')),host.getByRole('button',{name:'检查现有快照',exact:true}).click()]);const body=await saved.json();assert.equal(saved.status(),200,JSON.stringify(body));assert.equal(body.saved.semanticStatus,'human-attested');assert.equal(body.saved.executionEnabled,false);assert.equal(body.violated,true);
 await host.locator('[aria-live=polite]').filter({hasText:'已保存私人人工关系'}).waitFor();
 await readGraph(page,host,/规则Hash未变化/);
 await page.reload();await page.waitForFunction(()=>window.mm_dashboardCoreReady);host=await mount(page);await readGraph(page,host,/规则Hash未变化/);
 fs.writeFileSync(phase,'changed');await readGraph(page,host,/规则已变化/);
 for(const width of [1440,390])for(const theme of ['light','dark','money']){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await host.scrollIntoViewIfNeeded();assert.ok(await host.evaluate(n=>n.getBoundingClientRect().width<=innerWidth));await page.screenshot({path:path.join(dir,`relationship-${theme}-${width}.png`)});}
 assert.equal(await page.evaluate(()=>fetch('/api/prediction/relationships?market=stocks').then(r=>r.status)),400);
 const guest=await browser.newPage();await guest.goto(base+'/login');await Promise.all([guest.waitForURL(u=>u.pathname==='/'),guest.click('#guestBtn')]);assert.equal(await guest.evaluate(()=>fetch('/api/prediction/relationships?market=prediction').then(r=>r.status)),403);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,compiledUIAndRoutes:true,realIsolatedSQLite:true,syntheticExternalSources:true,confirmationGuard:true,savedAndReloaded:true,changedRulesInvalidated:true,threeThemes:true,mobile:true,guestDenied:true,noModelsOrdersOrProductionMessages:true,artifacts:dir}));
 }finally{await browser?.close();if(child&&child.exitCode===null){child.kill();await new Promise(r=>{child.once('exit',r);setTimeout(r,3000).unref();});}fs.closeSync(log);}}
main().catch(e=>{console.error(e);process.exitCode=1;});
