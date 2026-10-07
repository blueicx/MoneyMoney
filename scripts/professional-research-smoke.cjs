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
dataLakeCatalog.close();
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
    for(const feeRate of [.001,.002]){
      const response=await page.request.post(base+'/api/research/experiments',{headers,data:{market:'stocks',instrument:'stock:us:AAPL',workspace:'research',dataSource:'isolated fixture, not market data',strategyVersion:'fixture-v1',feeRate,slippage:.001,prices:[100,101,102,103,104,105,106,107],signals:[{timeIndex:0,direction:'buy'},{timeIndex:7,direction:'sell'}],split:{trainSize:4,testSize:2}}});
      assert.ok(response.ok());const row=(await response.json()).data;assert.equal(row.costStress.scenarios.length,3);experiments.push(row.experiment.id);
    }
    await page.evaluate(()=>openWorkspace('research-lab'));
    await page.locator('[data-research-tab="experiments"]').click();
    await page.locator('#mm-experiment-load').click();await page.locator('#mm-experiment-options input').first().waitFor();
    for(const id of experiments)await page.locator('#mm-experiment-options input[value="'+id+'"]').check();
    await page.locator('#mm-experiment-compare').click();await page.locator('[data-cost-stress] table').first().waitFor();
    assert.equal(await page.locator('[data-cost-stress] tbody tr').count(),6);
    assert.match(await page.locator('[data-cost-stress]').innerText(),/不自动排名/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile cost comparison fits viewport');
    await page.evaluate(()=>{setMarketScope('crypto');openWorkspace('fundamentals');});assert.equal(await panel.isVisible(),false);
    const guest=await browser.newPage();await guest.goto(base+'/login');await Promise.all([guest.waitForURL(url=>url.pathname==='/'),guest.click('#guestBtn')]);
    const privateStatus=await guest.evaluate(()=>fetch('/api/research/filings?instrument=stock:us:AAPL').then(r=>r.status));assert.equal(privateStatus,403);
    assert.equal(await guest.evaluate(()=>fetch('/api/research/committee?market=stocks&instrument=stock:us:AAPL').then(r=>r.status)),403);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,fixtureOnly:true,themes,privateStatus,dataDirectory:data}));
  }finally{if(browser)await browser.close();child.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
