// Reproduce Chromium's favicon refetches on native history changes while the
// same-origin connection is slow. No providers, credentials or production data.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{chromium}=require('playwright');
async function main(){
 const html=fs.readFileSync('dist/web/public/index.html','utf8'),icon=html.match(/<link\b[^>]*rel="icon"[^>]*>/)?.[0];assert.ok(icon);
 const sockets=new Set(),server=http.createServer((req,res)=>{if(req.url.startsWith('/icon.svg')){res.setHeader('cache-control','no-cache');return;}res.setHeader('content-type','text/html');res.end('<!doctype html><head>'+icon+'</head><body>history lifecycle fixture</body>');});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({headless:true,channel:process.env.MONEYMONEY_SMOKE_BROWSER||'chrome'});const page=await browser.newPage(),cdp=await page.context().newCDPSession(page),pending=new Set();let count=0;await cdp.send('Network.enable');cdp.on('Network.requestWillBeSent',e=>{if(new URL(e.request.url).pathname==='/icon.svg'){count++;pending.add(e.requestId);}});for(const event of ['Network.loadingFinished','Network.loadingFailed'])cdp.on(event,e=>pending.delete(e.requestId));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  for(let i=0;i<40;i++){await page.evaluate(i=>history.replaceState({},'','/?market='+['stocks','options','crypto','prediction'][i%4]+'&workspace=quotes'),i);await page.waitForTimeout(20);}
  console.log(JSON.stringify({historyChanges:40,iconRequests:count,pending:pending.size,fixture:'slow same-origin icon; native history; no external providers'}));
  assert.ok(count<=1,'native workspace history must not create an unbounded favicon queue');
  const src=await page.locator('link[rel="icon"]').getAttribute('href');assert.ok(src.startsWith('data:image/svg+xml;base64,'));assert.equal(Buffer.from(src.slice(src.indexOf(',')+1),'base64').toString(),fs.readFileSync('src/web/public/icon.svg','utf8'),'preserve the existing icon content');
 }finally{if(browser)await browser.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
