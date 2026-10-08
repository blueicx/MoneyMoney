// Current VPS acceptance. Auth stays in memory; no traces, screenshots or private payload files.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {captureProtectedRunner,assertProtectedRunnerPreserved}=require('./protected-runner-release.cjs');
function allowedApiRequest(url,method,base){try{return method==='GET'&&new URL(url).origin===new URL(base).origin;}catch{return false;}}
function verifyMarkerEvidence(marker,evidence){
  const row=evidence.data;
  assert.equal(evidence.market,marker.market);assert.equal(evidence.instrument,marker.instrument);
  assert.equal(row.id,marker.snapshotId);assert.equal(row.id,'rs_'+row.hash);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(row.fields)).digest('hex'),row.hash);
  assert.ok(Number.isFinite(Date.parse(row.at))&&Date.parse(row.at)<=marker.time);
  assert.ok(Number.isFinite(Date.parse(row.fields.dataAt))&&Date.parse(row.fields.dataAt)<=marker.time+5000);
}
async function run(){
  const {chromium}=require('playwright'),base='https://bluetrade.bbroot.com';
  const key=process.env.MONEYMONEY_ACCEPTANCE_SSH_KEY||'F:/vpsk/aws_blue.pem';
  assert.ok(fs.existsSync(key),'configured current VPS key required');
  let phase='session',browser,context;
  const remote=`const fs=require('node:fs');process.chdir('/opt/moneymoney');const env=require('/opt/moneymoney/node_modules/dotenv').parse(fs.readFileSync('/etc/moneymoney/moneymoney.env'));(async()=>{const r=await fetch('http://127.0.0.1:3001/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:env.MONEYMONEY_LOGIN_USER,password:env.MONEYMONEY_LOGIN_PASS})});if(!r.ok)throw Error();const d=await r.json();if(d.role!=='admin'||!d.token)throw Error();process.stdout.write(JSON.stringify({token:d.token,csrfToken:d.csrfToken}));})().catch(()=>process.exitCode=1);`;
  const login=spawnSync('ssh',['-i',key,'-o','BatchMode=yes','-o','ConnectTimeout=15','ubuntu@54.211.146.2','sudo -n node -'],{input:remote,encoding:'utf8',timeout:25000,maxBuffer:65536,windowsHide:true});
  assert.equal(login.status,0,'in-memory VPS authentication failed');
  const session=JSON.parse(login.stdout);login.stdout='';login.stderr='';assert.ok(session.token&&session.csrfToken);
  const report={version:null,modelCalls:0,businessWrites:0,sourceChecks:[],themes:[],lineage:{verified:0,unlinked:0},mobile:null};
  try{
    phase='browser';browser=await chromium.launch({headless:true,channel:process.env.MONEYMONEY_SMOKE_BROWSER||'chrome'});
    context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
    await context.addCookies([{name:'mm_token',value:session.token,url:base,httpOnly:true,secure:true,sameSite:'Lax'},
      {name:'mm_csrf',value:session.csrfToken,url:base,secure:true,sameSite:'Lax'}]);
    const page=await context.newPage(),errors=[],contractRequests=[];
    page.on('pageerror',()=>errors.push('pageerror'));
    await page.route('**/api/**',route=>{
      const request=route.request();
      if(!allowedApiRequest(request.url(),request.method(),base))return route.abort();
      if(request.url().includes('/api/contracts/detail?'))contractRequests.push(new URL(request.url()).searchParams.get('panels'));
      return route.continue();
    });
    const read=async(route)=>{const r=await context.request.get(base+route,{timeout:30000});assert.equal(r.status(),200,'private GET '+route.split('?')[0]);const d=await r.json();assert.notEqual(d.success,false);return d;};
    report.version=(await read('/api/health/version')).commit;
    if(process.env.EXPECTED_BUILD_ID)assert.equal(report.version,process.env.EXPECTED_BUILD_ID);
    const baseline=captureProtectedRunner((await read('/api/ai-runners')).data);
    phase='lineage';
    for(const instrument of ['stock:us:MU','stock:us:SNDK']){
      const d=await read('/api/paper/chart-markers?'+new URLSearchParams({market:'stocks',instrument}));
      assert.equal(d.market,'stocks');assert.equal(d.instrument,instrument);assert.ok(Array.isArray(d.data.markers));
      report.lineage.unlinked+=d.data.unlinked.length;
      // Bounded sample; full server projection has already verified all references.
      for(const marker of d.data.markers.slice(-3)){verifyMarkerEvidence(marker,await read('/api/evidence/'+encodeURIComponent(marker.snapshotId)));report.lineage.verified++;}
      if(!d.data.markers.length)assert.ok(d.reason);
    }
    phase='contract-ui';await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.mm_isLoggedIn===true&&window.mm_isGuest!==true&&typeof window.openWorkspace==='function');
    await page.evaluate(()=>{setMarketScope('crypto');openWorkspace('contracts');});
    await page.locator('#mm-contract-library').waitFor({state:'visible'});
    await page.locator('[data-contract-search]').fill('BTC');await page.locator('[data-contract-search-button]').click();
    await page.locator('[data-contract-id="crypto:gateio:BTC_USDT"]').click({timeout:45000});
    const panel=page.locator('#mm-contract-workspace');
    await panel.locator('[data-contract-canvas]').waitFor({state:'visible',timeout:45000});
    await page.waitForFunction(()=>document.querySelector('#mm-contract-workspace .mm-trading-readout')?.textContent.includes('成交量'));
    assert.ok(contractRequests.every(value=>value===''),'initial contract UI must not prefetch unselected panels');
    for(const id of ['market-overview','workspace-dashboard-cards','market-change-digest','mm-action-center'])assert.equal(await page.locator('#'+id).isVisible(),false,'current function isolation');
    for(const layer of ['funding','openInterest','basis','depth']){
      const received=page.waitForResponse(r=>r.url().includes('/api/contracts/detail?')&&new URL(r.url()).searchParams.get('panels').includes(layer)&&r.request().method()==='GET',{timeout:45000});
      await panel.locator('[data-contract-layer="'+layer+'"]').check();
      const response=await received,d=await response.json();assert.equal(response.status(),200);assert.equal(d.instrument,'crypto:gateio:BTC_USDT');assert.equal(d.market,'crypto');
      const series=d.series[layer];assert.ok(series&&series.dataStatus);
      if(series.points){assert.ok(series.points.every(p=>Number.isFinite(p.time)&&p.time<=Date.now()+5000&&Number.isFinite(p.value)));assert.equal(series.coverage.records,series.points.length);}
      if(!series.points?.length&&layer!=='depth')assert.ok(series.reason);
      report.sourceChecks.push({panel:layer,status:series.dataStatus,records:series.points?.length??null,timeBasis:series.timeBasis??null});
      await page.waitForFunction(layer=>document.querySelector('[data-contract-subpanels]')?.textContent.includes({funding:'资金费率',openInterest:'OI',basis:'基差',depth:'盘口快照'}[layer]),layer);
      await panel.locator('[data-contract-layer="'+layer+'"]').uncheck();
    }
    phase='themes';
    for(const theme of ['light','dark','money']){
      await page.evaluate(theme=>{if(theme==='light')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',theme);},theme);
      report.themes.push(await panel.locator('[data-contract-fullscreen]').evaluate(b=>({color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor})));
    }
    assert.equal(new Set(report.themes.map(t=>t.color+'|'+t.background)).size,3);
    phase='fullscreen';await panel.locator('[data-contract-fullscreen]').click();
    await page.waitForFunction(()=>document.fullscreenElement||document.querySelector('.mm-contract-chart.mm-trading-fullscreen'));
    await panel.locator('[data-contract-fullscreen]').click();
    phase='mobile';await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile no page overflow');report.mobile={width:390,noPageOverflow:true};
    phase='switch';await page.evaluate(()=>{setMarketScope('stocks');openWorkspace('analysis');});
    assert.equal(await panel.isVisible(),false);assert.equal(await panel.locator('[data-contract-data]').textContent(),'');
    assert.deepEqual(errors,[]);assertProtectedRunnerPreserved(baseline,(await read('/api/ai-runners')).data);
    const automatic=await read('/api/ai-runners/comparisons/automatic');report.automatic={enabled:automatic.data.enabled,groups:automatic.data.groups.length,issued:automatic.budget.issued};
    report.ok=true;
    const output=process.env.PRIVATE_CANARY_REPORT||path.join(os.tmpdir(),'mm-private-chart-'+Date.now()+'.json');
    fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify(report));
  }catch{console.error('Private chart acceptance failed at '+phase+'; no private data or credentials logged');process.exitCode=1;}
  finally{
    // Revoke only this isolated test session, never the owner's existing browser session.
    if(context){try{const cookies=await context.cookies(base),csrf=cookies.find(c=>c.name==='mm_csrf')?.value;
      await context.request.post(base+'/api/auth/logout',{headers:{'x-csrf-token':csrf||session.csrfToken},data:{},timeout:10000});}catch{}}
    await browser?.close();session.token='';session.csrfToken='';
  }
}
if(require.main===module)run().catch(()=>{console.error('Private chart preflight failed; credentials not logged');process.exitCode=1;});
module.exports={allowedApiRequest,verifyMarkerEvidence};
