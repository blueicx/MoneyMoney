const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('risk budget preview is opt-in, escaped and read-only with validated cap',async()=>{
 const dom=new JSDOM('<div id="market-workspace-shell" data-market-scope="stocks" data-workspace="decision-intelligence"></div><div id="host"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.mm_isLoggedIn=true;w.mm_isGuest=false;w.eval(fs.readFileSync('src/web/public/professional-research.js','utf8'));let calls=[];
 w.MoneyMoneyProfessionalResearch.renderRiskBudgetPreview(w.document.getElementById('host'),{dataStatus:'partial',capPct:20,currency:'USD',cashReserveAmount:600,before:{largestWeightPct:80,dailyVolatilityPct:null},after:{largestWeightPct:20,dailyVolatilityPct:null},positions:[{instrument:'<AAPL>',currentPct:80,targetPct:20,reductionAmount:600}],reason:'保存估值',riskReason:'历史不足',assumptions:['不创建订单']},async cap=>calls.push(cap));
 assert.equal(calls.length,0);assert.equal(w.document.querySelector('aapl'),null);assert.match(w.document.getElementById('host').textContent,/600/);
 const input=w.document.querySelector('[data-risk-cap]'),button=w.document.querySelector('[data-risk-preview]');input.value='0';button.click();assert.equal(calls.length,0);input.value='15';button.click();await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,[15]);
 w.document.getElementById('market-workspace-shell').dataset.workspace='events';button.click();assert.equal(calls.length,1);w.close();
});
