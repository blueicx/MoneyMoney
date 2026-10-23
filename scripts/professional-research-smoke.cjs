const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-professional-smoke-'));
process.env.MONEYMONEY_DATA_DIR=data;
const { FinancialTextIndex } = require('../dist/storage/financial-text-index');
const { dataLakeCatalog } = require('../dist/storage/data-lake');
dataLakeCatalog.registerInstrument({type:'stock',venue:'us',symbol:'AAPL',title:'Isolated identity fixture'});
dataLakeCatalog.saveCorporateAction({id:'isolated-dividend-payment',market:'stocks',instrument:'AAPL',kind:'dividend',effectiveAt:'2025-02-01T00:00:00.000Z',paymentAt:'2025-02-20T00:00:00.000Z',factor:.25,currency:'USD',source:'Isolated issuer fixture, not real data'});
dataLakeCatalog.saveCorporateAction({id:'isolated-late-split',market:'stocks',instrument:'MU',kind:'split',effectiveAt:'2025-02-01T00:00:00.000Z',factor:2,source:'Isolated split fixture, not real data'});
dataLakeCatalog.close();
const {unifiedPaperLedgerStore}=require('../dist/features/unified-paper-trading');
unifiedPaperLedgerStore.ensureRunnerAccount('lifecycle-fixture','isolated-lifecycle',1000);
unifiedPaperLedgerStore.applyRunnerOrder('lifecycle-fixture','isolated-lifecycle',{id:'isolated-stock-order',instrumentType:'stock',instrumentId:'stock:us:AAPL',side:'BUY',price:100,quantity:2,timestamp:'2025-01-01T00:00:00.000Z'});
require('../dist/storage/sqlite-state').stateStore.set('ai-paper-runners',[{
 id:'isolated-lifecycle',accountId:'lifecycle-fixture',venue:'Stocks',symbolOrMarketId:'AAPL',title:'Isolated runner, not real data',
 universe:{market:'stocks',hash:'isolated',instruments:[{venue:'Stocks',symbolOrMarketId:'AAPL',title:'Isolated'}]},policy:{},mode:'rules',
 model:'isolated/fixed',budgetUsd:1000,cashUsd:800,status:'STOPPED',executionState:'ready',createdAt:'2025-01-01T00:00:00.000Z',peakEquityUsd:1000,
 positions:[{id:'isolated-lot',instrumentId:'stock:us:AAPL',entryOrderId:'isolated-stock-order',entryTime:'2025-01-01T00:00:00.000Z',entryPrice:100,quantity:2,currentPrice:100,status:'OPEN'}],
 trades:[{id:'isolated-trade',orderId:'isolated-stock-order',action:'BUY',price:100,quantity:2,timestamp:'2025-01-01T00:00:00.000Z'}]
}],1);
unifiedPaperLedgerStore.ensureRunnerAccount('split-fixture','isolated-split',10000);
for(const order of [
  {id:'split-pre',side:'BUY',price:100,quantity:10,timestamp:'2025-01-01T00:00:00.000Z'},
  {id:'split-post',side:'BUY',price:40,quantity:5,timestamp:'2025-02-02T00:00:00.000Z'},
  {id:'split-sale',side:'SELL',price:60,quantity:5,timestamp:'2025-02-03T00:00:00.000Z'},
])unifiedPaperLedgerStore.applyRunnerOrder('split-fixture','isolated-split',{...order,instrumentType:'stock',instrumentId:'stock:us:MU'});
unifiedPaperLedgerStore.ensureRunnerAccount('runner-split-fixture','isolated-split-runner',1000);
unifiedPaperLedgerStore.applyRunnerOrder('runner-split-fixture','isolated-split-runner',{id:'runner-split-entry',instrumentType:'stock',instrumentId:'stock:us:MU',side:'BUY',price:100,quantity:2,timestamp:'2025-01-01T00:00:00.000Z'});
const fixtureState=require('../dist/storage/sqlite-state').stateStore;
fixtureState.set('ai-paper-runners',[...fixtureState.get('ai-paper-runners'),{
 id:'isolated-split-runner',accountId:'runner-split-fixture',venue:'Stocks',symbolOrMarketId:'MU',title:'Isolated split runner',universe:{market:'stocks',hash:'isolated-mu',instruments:[{venue:'Stocks',symbolOrMarketId:'MU'}]},
 policy:{},mode:'rules',model:'isolated/fixed',budgetUsd:1000,cashUsd:800,status:'STOPPED',executionState:'ready',createdAt:'2025-01-01T00:00:00.000Z',peakEquityUsd:1000,
 positions:[{id:'split-lot',instrumentId:'stock:us:MU',entryOrderId:'runner-split-entry',entryTime:'2025-01-01T00:00:00.000Z',entryPrice:100,quantity:2,currentPrice:100,status:'OPEN'}],
 trades:[{id:'split-trade',orderId:'runner-split-entry',action:'BUY',price:100,quantity:2,timestamp:'2025-01-01T00:00:00.000Z'}],
}],1);
require('../dist/storage/sqlite-state').stateStore.close();
const index = new FinancialTextIndex(path.join(data, 'moneymoney.sqlite'));
index.index({instrument:'stock:us:AAPL',accession:'0000320193-25-000001',form:'10-K',sourceUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/fixture.htm',publishedAt:'2025-01-01T12:00:00Z',retrievedAt:'2025-01-02T12:00:00Z',text:'Isolated browser fixture: tariffs may affect liquidity. This is not a real filing.'});
index.close();
// Never inherit real delivery endpoints into an isolated acceptance run.
const isolatedEnvironment = {OPENROUTER_API_KEY:'',GROQ_API_KEY:'',DISCORD_WEBHOOK_URL:'',LARK_WEBHOOK_URL:'',LARK_WEBHOOK_SECRET:'',MONEYMONEY_WEBHOOK_URL:'',MONEYMONEY_WEBHOOK_SECRET:''};
Object.assign(process.env, isolatedEnvironment);
const base='http://127.0.0.1:3196';
const child=spawn(process.execPath,['dist/web/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,MONEYMONEY_DATA_DIR:data,APP_HOST:'127.0.0.1',APP_PORT:'3196',MONEYMONEY_LOGIN_USER:'smoke-owner',MONEYMONEY_LOGIN_PASS:'isolated-smoke-password',MONEYMONEY_JWT_SECRET:'isolated-professional-smoke-secret-1234567890',TELEGRAM_NETWORK_ENABLED:'false',TELEGRAM_POLLING_ENABLED:'false',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',TELEGRAM_ALLOWED_CHAT_IDS:'',TELEGRAM_ADMIN_CHAT_IDS:'',WECOM_WEBHOOK_URL:'',BARK_DEVICE_KEY:'',MONEYMONEY_DISCORD_WEBHOOK_URL:'',MONEYMONEY_LARK_WEBHOOK_URL:'',MONEYMONEY_JSON_WEBHOOK_URL:'',AI_PAPER_TRADING_ENABLED:'false',PRIVATE_KEY:'',API_KEY:''},stdio:'ignore'});
async function main(){
  let browser;
  try{
    for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health/live')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
    browser=await chromium.launch({headless:true,channel:process.env.MONEYMONEY_SMOKE_BROWSER||'chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/login');await page.fill('#username','smoke-owner');await page.fill('#password','isolated-smoke-password');
    await Promise.all([page.waitForURL(url=>url.pathname==='/'),page.click('#submitBtn')]);
    await page.waitForFunction(()=>window.mm_isLoggedIn && typeof window.openWorkspace==='function');
    await page.evaluate(()=>{setMarketScope('stocks');setWorkspaceInstrument('stock:us:AAPL');openWorkspace('fundamentals');});
    const panel=page.locator('#financial-text-research');await panel.waitFor({state:'visible'});
    await panel.locator('input[name="query"]').fill('tariffs');await panel.locator('button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-filing-results]')?.textContent.includes('Isolated browser fixture'));
    assert.ok((await panel.innerText()).includes('HTML 无可靠页码'));
    assert.equal(await panel.locator('a').getAttribute('rel'),'noopener noreferrer');
    const themes=[];
    for(const theme of ['light','dark','money']){
      const style=await page.evaluate(async theme=>{if(theme==='light')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',theme);await new Promise(resolve=>setTimeout(resolve,200));const b=getComputedStyle(document.querySelector('[data-filing-list]'));return {color:b.color,background:b.backgroundColor,radius:b.borderRadius};},theme);
      assert.ok(parseFloat(style.radius)>=6);assert.notEqual(style.background,'rgb(239, 239, 239)');themes.push({theme,...style});
    }
    assert.equal(new Set(themes.map(item=>item.background)).size,3,'controls must follow all three themes');
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile content must not overflow');
    await page.evaluate(()=>setWorkspaceInstrument('stock:us:MU'));
    await panel.locator('[data-filing-list]').click();await page.waitForFunction(()=>document.querySelector('[data-filing-status]')?.textContent.includes('尚未手动索引'));
    const unavailable=await page.evaluate(()=>fetch('/api/portfolio/analytics?market=stocks').then(r=>r.json()));
    assert.equal(unavailable.data.tailRisk.dataStatus,'unavailable');assert.ok(unavailable.data.tailRisk.source.includes('尚未'));
    const auth=await (await page.request.get(base+'/api/auth/status')).json();
    const headers={'x-csrf-token':auth.data.csrfToken};
    const at=new Date().toISOString();
    const snapshot=await page.request.post(base+'/api/evidence',{headers,data:{market:'stocks',instrument:'AAPL',workspace:'evidence',source:{id:'isolated-fixture',name:'Isolated evidence fixture'},dataStatus:'delayed',observedAt:at,fetchedAt:at,fields:{price:100}}});
    assert.equal(snapshot.status(),201);const saved=(await snapshot.json()).data;
    await page.evaluate(()=>{setWorkspaceInstrument('stock:us:AAPL');openWorkspace('decision-intelligence');loadDecisionIntelligence();});
    const committee=page.locator('[data-committee]');await committee.waitFor({state:'visible'});
    await committee.locator('input[value="'+saved.id+'"]').waitFor();
    const imported=await page.request.post(base+'/api/portfolio/import',{headers,data:{commit:true,rows:[{market:'stocks',instrument:'stock:us:AAPL',quantity:4,price:200,currency:'USD'},{market:'stocks',instrument:'stock:us:SPY',quantity:1,price:200,currency:'USD'}]}});
    assert.ok(imported.ok(),'isolated portfolio fixture is validated');
    await page.locator('#decision-portfolio-source').selectOption('imported');
    await page.locator('[data-risk-budget] [data-risk-cap]').waitFor();
    assert.match(await page.locator('[data-risk-budget]').innerText(),/600.00 USD/);
    for(const theme of ['light','dark','money']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await page.setViewportSize({width:390,height:844});
      await page.locator('[data-risk-cap]').fill('15');
      await page.locator('[data-risk-preview]').click();
      await page.waitForFunction(()=>document.querySelector('[data-risk-budget]')?.textContent.includes('700.00 USD'));
      assert.ok(await page.locator('[data-risk-preview]').isVisible());
      await page.screenshot({path:path.join(data,'risk-budget-'+theme+'-mobile.png')});
    }
    const budgetPreview=await page.request.get(base+'/api/portfolio/analytics?market=stocks&accountSource=imported&riskCapPct=15').then(r=>r.json());
    assert.equal(budgetPreview.data.riskBudgetPreview.orderChanges,0);assert.equal(budgetPreview.data.riskBudgetPreview.executionEnabled,false);
    await page.setViewportSize({width:1440,height:900});
    assert.equal(await committee.locator('input').count(),1,'ephemeral provider-health evidence is not offered');
    await committee.locator('input').check();page.once('dialog',dialog=>dialog.accept());
    await committee.locator('[data-committee-run]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-committee-run]')?.disabled);
    assert.match(await committee.locator('[data-committee-status]').innerText(),/未配置官方/);
    await committee.locator('[data-committee-history]').click();
    await page.waitForFunction(()=>document.querySelector('[data-committee-results]')?.textContent.includes('实际调用 0'));
    assert.equal((await page.request.post(base+'/api/research/committee',{data:{}})).status(),403,'CSRF protection is enforced');
    const experiments=[];
    const missingCosts=await page.request.post(base+'/api/research/experiments',{headers,data:{market:'stocks',instrument:'stock:us:AAPL',workspace:'research',dataSource:'isolated fixture',strategyVersion:'fixture-v1',prices:[100,101,102,103,104,105,106,107],signals:[],split:{trainSize:4,testSize:2}}});
    assert.ok(missingCosts.ok());assert.equal((await missingCosts.json()).data.costStress.dataStatus,'unavailable','missing costs are not relabeled as explicit zero cost');
    const robustnessPrices=Array.from({length:240},(_,i)=>100+i*.1+Math.sin(i/4));
    const fixtureHash=require('node:crypto').createHash('sha256').update(JSON.stringify(robustnessPrices)).digest('hex');
    for(const feeRate of [.001,.002]){
      const response=await page.request.post(base+'/api/research/experiments',{headers,data:{market:'stocks',instrument:'stock:us:AAPL',workspace:'research',timeframe:'1d',dataSource:'isolated fixture, not market data',dataSnapshotHash:fixtureHash,seed:42,strategyVersion:'fixture-v1',feeRate,slippage:.001,prices:robustnessPrices,signals:Array.from({length:8},(_,i)=>[{timeIndex:25+i*25,direction:'buy'},{timeIndex:30+i*25,direction:'sell'}]).flat(),split:{trainSize:100,testSize:40}}});
      assert.ok(response.ok());const row=(await response.json()).data;assert.equal(row.costStress.scenarios.length,3);experiments.push(row.experiment.id);
    }
    const projectResponse=await page.request.post(base+'/api/research/projects',{headers,data:{market:'stocks',title:'Isolated retrospective result check',question:'Compare explicit saved experiments',hypothesis:'Cost variants share the same stated hypothesis',counterEvidence:'Missing model output remains unknown',acceptance:'Pinned lineage and historical model results only'}});assert.equal(projectResponse.status(),200);let retrospectiveProject=(await projectResponse.json()).data;for(const id of experiments){const linkedResponse=await page.request.post(base+'/api/research/projects/'+retrospectiveProject.id+'/links',{headers,data:{market:'stocks',version:retrospectiveProject.version,reference:{kind:'experiment',id}}});assert.equal(linkedResponse.status(),200);retrospectiveProject=(await linkedResponse.json()).data;}const retrospective=await page.request.get(base+'/api/research/projects/'+retrospectiveProject.id+'/retrospective?'+new URLSearchParams({market:'stocks',linkIds:retrospectiveProject.links.map(row=>row.linkId).join(',')})).then(r=>r.json());assert.equal(retrospective.success,true);assert.equal(retrospective.data.columns.length,2);for(const column of retrospective.data.columns){const original=await page.request.get(base+'/api/research/experiments/'+column.id).then(r=>r.json());assert.equal(column.summary.modelResult.kind,'theoretical-backtest');assert.equal(column.summary.modelResult.totalReturnPct,original.data.backtest.metrics.totalReturnPct);assert.equal(column.summary.modelResult.maxDrawdownPct,original.data.backtest.metrics.maxDrawdownPct);assert.equal(column.summary.modelResult.feeRate,original.data.experiment.feeRate);assert.equal(column.summary.modelResult.winRatePct,undefined);}assert.equal(retrospective.data.performanceWinner,null);
    await page.evaluate(()=>openWorkspace('research-lab'));
    await page.locator('[data-research-tab="experiments"]').click();
    await page.locator('#mm-experiment-load').click();await page.locator('#mm-experiment-options input').first().waitFor();
    for(const id of experiments)await page.locator('#mm-experiment-options input[value="'+id+'"]').check();
    await page.locator('#mm-experiment-compare').click();await page.locator('[data-cost-stress] table').first().waitFor();
    assert.equal(await page.locator('[data-cost-stress] tbody tr').count(),6);
    assert.match(await page.locator('[data-cost-stress]').innerText(),/不自动排名/);
    const analyzedId=await page.locator('[data-robustness-run]').first().getAttribute('data-robustness-run');
    await page.locator('[data-robustness-run]').first().click();
    await page.locator('[data-robustness-output]').first().filter({hasText:'配置 Hash'}).waitFor();
    assert.match(await page.locator('[data-robustness-output]').first().innerText(),/随机入场.*12/);
    assert.match(await page.locator('[data-robustness-output]').first().innerText(),/未独立核验/);
    const persisted=await page.request.get(base+'/api/research/experiments/'+analyzedId).then(r=>r.json());
    assert.equal(persisted.data.robustness.controls.randomEntry.length,12);
    const revision=page.locator('[data-revision-impact]').first(),revisionId=await revision.getAttribute('data-revision-impact');
    const original=await page.request.get(base+'/api/research/experiments/'+revisionId).then(r=>r.json());
    await revision.click();await page.locator('[data-preserved-rerun]').first().waitFor();
    assert.match(await page.locator('.mm-revision-impact').innerText(),/unlinked|未关联/);
    const rerunResponse=page.waitForResponse(r=>r.url().endsWith('/'+revisionId+'/rerun')&&r.request().method()==='POST');
    page.once('dialog',dialog=>dialog.accept());await page.locator('[data-preserved-rerun]').first().click();
    const replay=await (await rerunResponse).json();assert.equal(replay.success,true);assert.notEqual(replay.data.experiment.id,revisionId);assert.equal(replay.rerunOf,revisionId);
    await page.waitForFunction(id=>document.querySelector('.mm-revision-impact')?.textContent.includes(id),replay.data.experiment.id);
    const untouched=await page.request.get(base+'/api/research/experiments/'+revisionId).then(r=>r.json());assert.deepEqual(untouched.data,original.data,'manual rerun must preserve the parent including saved robustness evidence');
    assert.equal((await page.request.get(base+'/api/research/experiments/'+replay.data.experiment.id).then(r=>r.json())).data.rerunOf,revisionId);
    const contextLedger=page.locator('[data-context-ledger]');await contextLedger.locator('..').locator('summary').click();await contextLedger.click();await page.waitForFunction(()=>document.querySelector('[data-universe-capture]'));
    assert.match(await contextLedger.locator('..').innerText(),/旧尝试|幸存者/);
    const trialReport=await page.request.get(base+'/api/research/context-ledger?market=stocks').then(r=>r.json());assert.equal(trialReport.data.attempts,4);assert.equal(trialReport.data.trials.filter(r=>r.status==='succeeded').length,4);assert.ok(trialReport.data.trials.some(r=>r.experimentId===replay.data.experiment.id));
    const invalidTrial=await page.request.post(base+'/api/research/experiments',{headers,data:{market:'stocks',instrument:'stock:us:AAPL',prices:[],signals:[]}});assert.equal(invalidTrial.status(),400);const afterFailure=await page.request.get(base+'/api/research/context-ledger?market=stocks').then(r=>r.json());assert.equal(afterFailure.data.attempts,5);assert.equal(afterFailure.data.trials.at(-1).status,'failed');
    const mismatch=await page.request.post(base+'/api/research/shared-capital',{headers,data:{ids:experiments}});assert.equal(mismatch.status(),400,'different cost bases are not silently combined');
    await page.locator('#mm-experiment-load').click();await page.locator('#mm-experiment-options input[value="'+replay.data.experiment.id+'"]').waitFor();
    for(const input of await page.locator('#mm-experiment-options input').all())await input.uncheck();
    for(const id of [revisionId,replay.data.experiment.id])await page.locator('#mm-experiment-options input[value="'+id+'"]').check();
    await page.locator('#mm-experiment-compare').click();const shared=page.locator('[data-shared-capital]');await shared.waitFor({state:'attached'});await shared.locator('..').locator('summary').click();await shared.click();await page.waitForFunction(()=>document.querySelector('[data-shared-capital]')?.parentElement.textContent.includes('配置 Hash'));assert.match(await shared.locator('..').innerText(),/增量贡献不是收益相加/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile cost comparison fits viewport');
    await page.evaluate(()=>{setMarketScope('crypto');openWorkspace('fundamentals');});assert.equal(await panel.isVisible(),false);
    await page.evaluate(()=>{setMarketScope('stocks');openWorkspace('paper');});
    const lifecycle=page.locator('[data-paper-lifecycle]');await lifecycle.waitFor({state:'visible'});await lifecycle.locator('summary').click();
    assert.ok(await page.locator('[data-lifecycle-reconcile]').isDisabled());await page.locator('[data-lifecycle-account]').fill('lifecycle-fixture');await page.locator('[data-lifecycle-read]').click();
    await page.waitForFunction(()=>document.querySelector('[data-lifecycle-output]')?.textContent.includes('暂无已关联公司行动'));
    const before=await page.evaluate(()=>fetch('/api/paper/accounts/lifecycle-fixture/lifecycle?market=stocks').then(r=>r.json()));
    assert.equal(before.market,'stocks');assert.equal(before.data.performance.corporateIncome,0);
    await page.locator('[data-lifecycle-preview]').click();await page.locator('[data-lifecycle-status]').filter({hasText:'只读预览已完成'}).waitFor();page.once('dialog',dialog=>dialog.accept());await page.locator('[data-lifecycle-reconcile]').click();
    await page.waitForFunction(()=>document.querySelector('[data-lifecycle-output]')?.textContent.includes('模拟现金已入账'));
    const after=await page.evaluate(()=>fetch('/api/paper/accounts/lifecycle-fixture/lifecycle?market=stocks').then(r=>r.json()));
    const verifyState=new (require('../dist/storage/sqlite-state').SQLiteStateStore)(path.join(data,'moneymoney.sqlite'),data);
    try{const runner=verifyState.get('ai-paper-runners')[0];assert.equal(runner.cashUsd,800.5);assert.equal(runner.corporateIncomeUsd,.5);assert.equal(runner.model,'isolated/fixed');assert.equal(runner.status,'STOPPED');}finally{verifyState.close();}
    assert.equal(after.data.performance.corporateIncome,.5);assert.equal(after.data.receivables[0].status,'paid');
    await page.locator('[data-lifecycle-account]').fill('split-fixture');
    await page.locator('[data-lifecycle-preview]').click();await page.locator('[data-lifecycle-status]').filter({hasText:'只读预览已完成'}).waitFor();page.once('dialog',dialog=>dialog.accept());await page.locator('[data-lifecycle-reconcile]').click();
    await page.waitForFunction(()=>document.querySelector('[data-lifecycle-output]')?.textContent.includes('拆股成本修正 60 USD'));
    const splitResult=await page.evaluate(()=>fetch('/api/paper/accounts/split-fixture/lifecycle?market=stocks').then(r=>r.json()));
    assert.equal(splitResult.data.costAdjustments[0].orderId,'split-sale');assert.equal(splitResult.data.performance.realizedPnl,60);
    assert.match(await lifecycle.innerText(),/现金及原成交不变/);
    await page.locator('[data-lifecycle-account]').fill('runner-split-fixture');await page.locator('[data-lifecycle-preview]').click();await page.locator('[data-lifecycle-status]').filter({hasText:'只读预览已完成'}).waitFor();page.once('dialog',dialog=>dialog.accept());await page.locator('[data-lifecycle-reconcile]').click();
    await page.waitForFunction(()=>document.querySelector('[data-lifecycle-output]')?.textContent.includes('按来源拆股比例'));
    const splitState=new (require('../dist/storage/sqlite-state').SQLiteStateStore)(path.join(data,'moneymoney.sqlite'),data);
    try{const raw=splitState.get('ai-paper-runners').find(row=>row.id==='isolated-split-runner');assert.equal(raw.positions[0].quantity,4);assert.equal(raw.positions[0].entryPrice,50);assert.equal(raw.cashUsd,800);assert.equal(raw.status,'STOPPED');assert.equal(raw.model,'isolated/fixed');assert.equal(raw.lastDataStatus,'stale');}finally{splitState.close();}
    for(const {theme} of themes){for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.evaluate(theme=>{if(theme==='light')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',theme);},theme);await lifecycle.screenshot({path:path.join(data,`lifecycle-${theme}-${width}.png`)});}}
    await page.evaluate(()=>setMarketScope('crypto'));await lifecycle.waitFor({state:'hidden'});
    const guest=await browser.newPage();await guest.goto(base+'/login');await Promise.all([guest.waitForURL(url=>url.pathname==='/'),guest.click('#guestBtn')]);
    assert.equal(await guest.evaluate(()=>fetch('/api/paper/accounts/lifecycle-fixture/lifecycle?market=stocks').then(r=>r.status)),403);
    assert.equal(await guest.evaluate(()=>fetch('/api/paper/accounts/lifecycle-fixture/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({market:'stocks'})}).then(r=>r.status)),403);
    const privateStatus=await guest.evaluate(()=>fetch('/api/research/filings?instrument=stock:us:AAPL').then(r=>r.status));assert.equal(privateStatus,403);
    assert.equal(await guest.evaluate(()=>fetch('/api/research/committee?market=stocks&instrument=stock:us:AAPL').then(r=>r.status)),403);
    assert.equal(await guest.evaluate(id=>fetch('/api/research/experiments/'+id+'/robustness',{method:'POST'}).then(r=>r.status),experiments[0]),403);
    assert.equal(await guest.evaluate(id=>fetch('/api/research/experiments/'+id+'/revision-impact').then(r=>r.status),experiments[0]),403);
    assert.equal(await guest.evaluate(()=>fetch('/api/research/shared-capital',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:['a','b']})}).then(r=>r.status)),403);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,fixtureOnly:true,themes,privateStatus,dataDirectory:data}));
  }finally{if(browser)await browser.close();child.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
