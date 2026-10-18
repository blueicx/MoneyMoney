const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('recovery wizard never resumes on open; explicit acknowledgement uses only reviewed hash',async()=>{
 const src=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=src.indexOf('async function resumeRunner('),end=src.indexOf('async function resetRunnerCircuit(',start);
 const dom=new JSDOM('<button id="return">origin</button>',{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window;w.eval("var activeMarketScope='stocks';");w.showToast=()=>{};w.loadAiRunners=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 const calls=[];w.fetch=async(url,init={})=>{calls.push({url,init});return {ok:true,json:async()=>init.method==='POST'?{success:true}:{success:true,data:{canResume:true,reviewHash:'saved-hash',reviewedAt:'2026-10-01T00:00:00Z',cash:1000,runnerCash:1000,openPositions:0,orderCount:0,configurationHash:'config',ledgerHash:'ledger',riskParameters:{maxTradeUsd:100},warnings:['等待新鲜报价'],blocked:[]}}};};
 w.eval(src.slice(start,end));await w.resumeRunner('r');assert.equal(calls.length,1);const dialog=w.document.querySelector('[data-ai-recovery-dialog]');assert.ok(dialog,'manual reconciliation dialog');
 const button=dialog.querySelector('[data-ai-recovery-confirm]');assert.equal(button.disabled,true);const check=dialog.querySelector('input[type=checkbox]');check.checked=true;check.dispatchEvent(new w.Event('change'));button.click();await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.length,2);const body=JSON.parse(calls[1].init.body);assert.deepEqual(Object.keys(body).sort(),['confirmed','expectedHash','reviewedAt']);assert.equal(body.expectedHash,'saved-hash');assert.equal(body.confirmed,true);dom.window.close();
});
test('changing workspace cancels the recovery dialog instead of submitting a delayed confirmation',async()=>{
 const src=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8'),start=src.indexOf('async function resumeRunner('),end=src.indexOf('async function resetRunnerCircuit(',start);
 assert.match(src.slice(start,end),/mm-workspace-context/);
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;w.eval("var activeMarketScope='stocks';");w.showToast=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new w.Event('close'));};
 let release,posts=0;w.fetch=(_url,init={})=>{if(init.method==='POST')posts++;return new Promise(r=>release=()=>r({ok:true,json:async()=>({success:true,data:{canResume:true,warnings:[],blocked:[],riskParameters:{}}})}));};
 w.eval(src.slice(start,end));const pending=w.resumeRunner('r');w.dispatchEvent(new w.Event('mm-workspace-context'));release();await pending;assert.equal(w.document.querySelector('dialog'),null);assert.equal(posts,0);dom.window.close();
});
