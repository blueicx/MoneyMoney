const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-first-batch-browser-'));
const port = 3217;
const base = `http://127.0.0.1:${port}`;
process.env.MONEYMONEY_DATA_DIR = dataDir;

async function waitForServer() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(base + '/api/health/live')).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('isolated first-batch server did not become healthy');
}

async function main() {
  let browser;
  let child;
  try {
    const { stateStore } = require('../dist/storage/sqlite-state');
    const { decisionIntelligenceStore } = require('../dist/features/decision-intelligence-store');
    const { createEvidenceSnapshot } = require('../dist/features/decision-intelligence');
    const events = [
      createEvidenceSnapshot({ id:'browser-sequence-a', market:'stocks', instrument:'stock:us:AAPL', workspace:'event-intelligence', dataStatus:'historical', source:{id:'isolated-fixture',name:'Isolated browser evidence'}, observedAt:'2026-10-28T01:00:00.000Z', fetchedAt:'2026-10-28T01:00:10.000Z', fields:{stage:'A',magnitude:1} }),
      createEvidenceSnapshot({ id:'browser-sequence-b', market:'stocks', instrument:'stock:us:AAPL', workspace:'event-intelligence', dataStatus:'historical', source:{id:'isolated-fixture',name:'Isolated browser evidence'}, observedAt:'2026-10-28T01:10:00.000Z', fetchedAt:'2026-10-28T01:10:10.000Z', fields:{stage:'B',magnitude:2} }),
    ];
    for (const event of events) decisionIntelligenceStore.saveEvidence(event);
    stateStore.close();

    const env = {
      ...process.env,
      MONEYMONEY_DATA_DIR:dataDir,
      APP_HOST:'127.0.0.1',
      APP_PORT:String(port),
      MONEYMONEY_LOGIN_USER:'first-batch-owner',
      MONEYMONEY_LOGIN_PASS:'first-batch-isolated-password',
      MONEYMONEY_JWT_SECRET:'first-batch-isolated-secret-0123456789',
      AI_PAPER_TRADING_ENABLED:'false',
      TELEGRAM_NETWORK_ENABLED:'false',
      TELEGRAM_POLLING_ENABLED:'false',
      MONEYMONEY_DISABLE_GURU_REFRESH:'true',
      MONEYMONEY_KLINE_STREAM_ENABLED:'false',
    };
    for (const key of Object.keys(env)) if (/TOKEN|API_KEY|WEBHOOK|PRIVATE_KEY|BARK_DEVICE_KEY|TELEGRAM_CHAT|TELEGRAM_ALLOWED|TELEGRAM_ADMIN/.test(key)) env[key] = '';
    child = spawn(process.execPath,['--require',path.join(root,'tests/helpers/offline-drill-guard.cjs'),'dist/web/server.js'],{cwd:root,env,stdio:'ignore'});
    await waitForServer();

    browser = await chromium.launch({channel:process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome',headless:true});
    const context = await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base + '/login');
    await page.fill('#username',env.MONEYMONEY_LOGIN_USER);
    await page.fill('#password',env.MONEYMONEY_LOGIN_PASS);
    await Promise.all([page.waitForURL(url=>url.pathname==='/'),page.click('#submitBtn')]);
    await page.waitForFunction(()=>window.mm_dashboardCoreReady&&typeof openWorkspace==='function');

    const screenerResponsePromise = page.waitForResponse(response=>response.url().includes('/api/screener?scope=stocks'));
    await page.evaluate(()=>{
      setMarketScope('stocks');
      openWorkspace('screener');
    });
    const screenerResponse = await screenerResponsePromise;
    assert.equal(screenerResponse.status(),200);
    await page.evaluate(()=>{
      setWorkspaceInstrument('stock:us:AAPL');
    });
    await page.waitForFunction(()=>{
      const shell = document.getElementById('market-workspace-shell');
      return shell?.dataset.marketScope === 'stocks'
        && shell?.dataset.workspace === 'screener'
        && shell?.dataset.instrument === 'stock:us:AAPL';
    });
    await page.waitForTimeout(750);
    await page.waitForFunction(()=>{
      const shell = document.getElementById('market-workspace-shell');
      const panel = document.getElementById('time-series-conditions');
      return shell?.dataset.marketScope === 'stocks'
        && shell?.dataset.workspace === 'screener'
        && shell?.dataset.instrument === 'stock:us:AAPL'
        && panel && !panel.hidden;
    });
    const sequence = page.locator('#time-series-conditions');
    await sequence.waitFor({state:'visible'});
    await sequence.locator('details').first().evaluate(element => { element.open = true; });
    await sequence.locator('[data-sequence-evidence]').fill(events.map(row=>row.id).join('\n'));
    const formValidity = await sequence.locator('[data-sequence-form]').evaluate(form=>({valid:form.reportValidity(),invalid:[...form.elements].filter(element=>!element.checkValidity()).map(element=>({name:element.getAttribute('data-sequence-evidence')!==null?'evidence':element.getAttribute('data-sequence-asof')!==null?'asof':element.outerHTML.slice(0,120),message:element.validationMessage}))}));
    assert.equal(formValidity.valid,true,JSON.stringify(formValidity));
    const previewResponsePromise = page.waitForResponse(response=>response.url().endsWith('/api/research/time-series-conditions/rules/preview'));
    await sequence.locator('[data-sequence-preview]').click();
    const previewResponse = await previewResponsePromise;
    const previewBody = await previewResponse.json();
    assert.equal(previewResponse.status(),201,JSON.stringify(previewBody));
    assert.equal(previewBody.data.status,'preview');
    page.once('dialog',dialog=>dialog.accept());
    const confirmResponsePromise = page.waitForResponse(response=>response.url().includes('/api/research/time-series-conditions/rules/')&&response.url().endsWith('/confirm'));
    await sequence.locator('[data-sequence-confirm]').click();
    const confirmResponse = await confirmResponsePromise;
    assert.equal(confirmResponse.status(),200);
    const runResponsePromise = page.waitForResponse(response=>response.url().includes('/api/research/time-series-conditions/rules/')&&response.url().endsWith('/run'));
    await sequence.locator('[data-sequence-run]').click();
    const runResponse = await runResponsePromise;
    const runBody = await runResponse.json();
    assert.equal(runResponse.status(),201,JSON.stringify(runBody));
    assert.equal(runBody.data.hits.length,1);
    await sequence.locator('[data-sequence-result]').filter({hasText:'命中 1'}).waitFor();

    const project = await page.evaluate(async()=>{
      const csrf = document.cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('mm_csrf='));
      const response = await fetch('/api/research/projects',{method:'POST',credentials:'include',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':decodeURIComponent(csrf.slice(8))}:{})},body:JSON.stringify({market:'stocks',title:'Browser condition study',question:'Can the saved sequence be reproduced?',hypothesis:'The ordered evidence window remains stable',counterEvidence:'No exclusion evidence appears in the saved window',acceptance:'The project keeps a fixed condition-hit reference'})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.reason || 'project creation failed');
      return body.data;
    });
    await sequence.locator('[data-sequence-project-id]').fill(project.id);
    await sequence.locator('[data-sequence-project-version]').fill(String(project.version));
    page.once('dialog',dialog=>dialog.accept());
    const linkResponsePromise = page.waitForResponse(response=>response.url().includes('/hits/')&&response.url().endsWith('/link'));
    await sequence.locator('[data-sequence-link]').first().click();
    const linkResponse = await linkResponsePromise;
    assert.equal(linkResponse.status(),200);
    const linkedProject = await page.evaluate(async id=>{
      const response = await fetch('/api/research/projects/'+encodeURIComponent(id)+'?market=stocks',{credentials:'include'});
      return response.json();
    },project.id);
    assert.equal(linkedProject.data.links.length,1);
    assert.equal(linkedProject.data.links[0].kind,'condition-hit');

    await page.evaluate(()=>openWorkspace('research-lab'));
    await page.locator('#research-statistics-audit').waitFor({state:'visible'});
    assert.match(await page.locator('#research-statistics-audit').innerText(),/研究统计审计台/);

    await page.evaluate(()=>openWorkspace('fundamentals'));
    await page.locator('#financial-text-research').waitFor({state:'visible'});
    await page.locator('#company-industry-graph').waitFor({state:'visible'});
    await page.locator('#three-statement-model').waitFor({state:'visible'});
    assert.match(await page.locator('#financial-text-research').innerText(),/SEC 财报版本/);
    assert.match(await page.locator('#company-industry-graph').innerText(),/公司与产业关系图谱/);
    assert.match(await page.locator('#three-statement-model').innerText(),/三表联动/);

    await page.evaluate(()=>{
      openWorkspace('screener');
      setWorkspaceInstrument('stock:us:AAPL');
    });
    await page.waitForFunction(()=>{
      const shell=document.getElementById('market-workspace-shell');
      const panel=document.getElementById('time-series-conditions');
      return shell?.dataset.marketScope==='stocks'
        && shell?.dataset.workspace==='screener'
        && shell?.dataset.instrument==='stock:us:AAPL'
        && panel
        && !panel.hidden;
    });
    await sequence.waitFor({state:'visible'});
    await sequence.locator('details').first().evaluate(element=>{element.open=true;});
    for (const width of [375,390,1003,1440]) for (const theme of ['light','dark','money']) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(theme=>{if(theme==='light')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',theme);},theme);
      await sequence.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(dataDir,`first-batch-${theme}-${width}.png`)});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),`horizontal overflow at ${width}/${theme}`);
      assert.ok(await sequence.evaluate(node=>node.getBoundingClientRect().right<=innerWidth+2),`sequence panel clipped at ${width}/${theme}`);
      assert.ok((await sequence.locator('[data-sequence-preview]').boundingBox()).height>=30,`sequence control too small at ${width}/${theme}`);
    }

    const guest = await browser.newPage({viewport:{width:390,height:844}});
    await guest.goto(base + '/login');
    await Promise.all([guest.waitForURL(url=>url.pathname==='/'),guest.click('#guestBtn')]);
    assert.equal(await guest.evaluate(url=>fetch(url).then(response=>response.status),'/api/research/time-series-conditions?market=stocks'),403);
    assert.equal(await page.request.post(base+'/api/research/time-series-conditions/rules/preview',{data:{market:'stocks'}}).then(response=>response.status()),403);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,isolatedSQLite:true,sequencePreviewConfirmRunLink:true,researchProjects:true,privateEndpointsAdminOnly:true,themes:['light','dark','money'],widths:[375,390,1003,1440],noExternalNetwork:true,artifacts:dataDir}));
  } finally {
    await browser?.close();
    child?.kill();
  }
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
