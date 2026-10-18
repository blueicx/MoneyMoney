const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('revision impact is opt-in, context-bound, escaped and reruns require explicit confirmation',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="research-lab" data-instrument="stock:us:AAPL"></div><div id="host"></div>',{url:'http://localhost/',runScripts:'outside-only'});
 try{const w=dom.window;w.mm_isGuest=false;w.confirm=()=>false;w.eval(fs.readFileSync('src/web/public/workflow-polish.js','utf8'));let requests=[];
 assert.equal(typeof w.MoneyMoneyWorkflow.renderRevisionImpact,'function');const host=w.document.getElementById('host');
 w.MoneyMoneyWorkflow.renderRevisionImpact(host,[{id:'exp'}],async(url,options)=>{requests.push([url,options]);return url.endsWith('/rerun')?{data:{experiment:{id:'run-new'}},rerunOf:'exp'}:{data:{rows:[{id:'<script>',kind:'decision',status:'unlinked',reason:'未关联',findings:[]}]},reason:'只有目录引用，不按时间猜测'};});
 assert.equal(requests.length,0);await host.querySelector('[data-revision-impact]').onclick();assert.equal(requests.length,1);assert.match(host.textContent,/未关联/);assert.equal(host.querySelector('script'),null);
 const rerun=host.querySelector('[data-preserved-rerun]');await rerun.onclick();assert.equal(requests.length,1);w.confirm=()=>true;await rerun.onclick();assert.equal(requests[1][1].method,'POST');assert.equal(requests[1][1].body,'{}');assert.match(host.textContent,/run-new/);
 w.document.getElementById('market-workspace-shell').dataset.instrument='stock:us:SNDK';await host.querySelector('[data-revision-impact]').onclick();assert.equal(requests.length,2);
 }finally{dom.window.close();}
});
