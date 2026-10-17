const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('financial revision history keeps exact field, period, unit and publication evidence without future revisions',()=>{
 const {buildCapitalHistory}=require('../dist/features/stock-capital-history');
 const row={start:'2025-01-01',end:'2025-12-31',filed:'2026-02-15',form:'10-K',fp:'FY',val:100,accn:'original'};
 const facts={facts:{'us-gaap':{NetCashProvidedByUsedInOperatingActivities:{units:{USD:[row,{...row,val:90,filed:'2026-04-01',form:'10-K/A',accn:'amended'},{...row,val:95,filed:'2026-06-01',accn:'future'}]}}}}};
 const early=buildCapitalHistory(facts,'2026-03-01T00:00:00Z'),late=buildCapitalHistory(facts,'2026-05-01T00:00:00Z');
 assert.deepEqual(early.revisions,[]);assert.equal(late.revisions.length,1);
 const r=late.revisions[0];assert.equal(r.before.value,100);assert.equal(r.after.value,90);assert.equal(r.unit,'USD');assert.equal(r.after.accession,'amended');assert.equal(r.change,-10);assert.equal(r.reason,'同字段、单位和报告区间的后续披露数值变化，不推断重述原因');
 assert.equal(late.points[0].operatingCashFlowUsd.value,90);
});
test('capital history preserves exact report windows, field units, evidence and missing values',()=>{
 assert.ok(fs.existsSync('dist/features/stock-capital-history.js'),'same-period capital history module missing');
 const {buildCapitalHistory,compareCapitalHistory}=require('../dist/features/stock-capital-history');
 assert.equal(typeof buildCapitalHistory,'function');
 const annual=(val,extra={})=>({start:'2025-01-01',end:'2025-12-31',filed:'2026-02-15',form:'10-K',fp:'FY',val,...extra});
 const facts={cik:1,facts:{'us-gaap':{NetCashProvidedByUsedInOperatingActivities:{units:{USD:[annual(-2)]}},PaymentsForRepurchaseOfCommonStock:{units:{USD:[annual(4)]}},PaymentsOfDividendsCommonStock:{units:{EUR:[annual(7)]}},CommonStockSharesOutstanding:{units:{shares:[annual(100,{start:undefined})]}},CashAndCashEquivalentsAtCarryingValue:{units:{USD:[annual(30,{start:undefined})]}},LongTermDebtCurrent:{units:{USD:[annual(5,{start:undefined})]}},LongTermDebtNoncurrent:{units:{USD:[annual(20,{start:undefined})]}}}}};
 const history=buildCapitalHistory(facts,'2026-03-01T00:00:00Z');const row=history.points[0];assert.equal(row.operatingCashFlowUsd.value,-2);assert.equal(row.repurchasesUsd.value,4);assert.equal(row.dividendsUsd.value,null);assert.equal(row.shares.value,100);assert.equal(row.shares.unit,'shares');assert.equal(row.debtUsd.value,25);assert.equal(row.debtUsd.evidence.length,2);assert.equal(row.shareChangePct,null);
 assert.equal(buildCapitalHistory(facts,'2026-02-15T12:00:00Z').points.length,0,'filing date without a time cannot be used earlier in the publication day');
 assert.equal(buildCapitalHistory(facts,'2026-02-16T04:00:00Z').points.length,0,'unknown SEC filing time must wait until the entire New York publication day is over');
 const revised=structuredClone(facts);revised.facts['us-gaap'].NetCashProvidedByUsedInOperatingActivities.units.USD.push(annual(999,{filed:'2026-04-01',form:'10-K/A'}));assert.equal(buildCapitalHistory(revised,'2026-03-01T00:00:00Z').points[0].operatingCashFlowUsd.value,-2);
 const same=compareCapitalHistory([{symbol:'AAPL',capitalHistory:history},{symbol:'MSFT',capitalHistory:history}]);assert.equal(same.dataStatus,'partial');assert.equal(same.rows.length,2);
 const shifted=structuredClone(history);shifted.points[0].periodStart='2025-02-01';assert.equal(compareCapitalHistory([{symbol:'AAPL',capitalHistory:history},{symbol:'MSFT',capitalHistory:shifted}]).dataStatus,'unavailable');
 assert.equal(compareCapitalHistory([{symbol:'AAPL',dataStatus:'failed'},{symbol:'MSFT',dataStatus:'failed'}]).dataStatus,'failed');
 assert.equal(compareCapitalHistory([{symbol:'AAPL',capitalHistory:history},{symbol:'MSFT',dataStatus:'failed'}]).dataStatus,'partial');
});
test('capital conflicts and incomplete debt components are not averaged or treated as zero',()=>{
 assert.ok(fs.existsSync('dist/features/stock-capital-history.js'),'capital source arbitration missing');
 const {buildCapitalHistory}=require('../dist/features/stock-capital-history');const row={start:'2025-01-01',end:'2025-12-31',filed:'2026-02-15',form:'10-K',fp:'FY',val:5};const facts={facts:{'us-gaap':{NetCashProvidedByUsedInOperatingActivities:{units:{USD:[row,{...row,val:6}]}},LongTermDebtCurrent:{units:{USD:[{...row,start:undefined}]}}}}};
 const result=buildCapitalHistory(facts,'2026-03-01T00:00:00Z');assert.equal(result.points[0].operatingCashFlowUsd.value,null);assert.match(result.points[0].operatingCashFlowUsd.reason,/冲突/);assert.equal(result.points[0].debtUsd.value,null);
});
test('capital revision evidence is readable in the existing stock workspace without interpreting filing strings as markup',()=>{
 const {JSDOM}=require('jsdom'),vm=require('node:vm'),source=require('./helpers/dashboard-source.cjs').readDashboardSource(),render=source.match(/function renderStockCapitalHistory\(host, data\) \{[\s\S]*?\n\}/)[0];
 const dom=new JSDOM('<div id="host"></div>');
 try{vm.runInNewContext(render+';renderStockCapitalHistory(document.getElementById("host"),data);',{document:dom.window.document,window:dom.window,data:{symbol:'AAPL',capitalHistory:{points:[],revisions:[{tag:'cashflow',unit:'USD',periodStart:'2025-01-01',periodEnd:'2025-12-31',before:{value:100,filed:'2026-02-15',accession:'old'},after:{value:90,filed:'2026-04-01',accession:'new'},change:-10,reason:'<img src=x>'}]}},stockEscapeHtml:v=>String(v??'').replace(/</g,'&lt;')});
 assert.ok(dom.window.document.querySelector('[data-capital-revisions]'));assert.match(dom.window.document.body.textContent,/100.*90/);assert.equal(dom.window.document.querySelector('img'),null);
 }finally{dom.window.close();}
});

test('capital UI renders missing fields explicitly and peer comparison stays within the selected stock workspace',()=>{
 const {JSDOM}=require('jsdom'),vm=require('node:vm');const source=require('./helpers/dashboard-source.cjs').readDashboardSource(),render=source.match(/function renderStockCapitalHistory\(host, data\) \{[\s\S]*?\n\}/)?.[0];assert.ok(render,'capital table and peer action missing');const dom=new JSDOM('<div id="host"></div>');
 try{vm.runInNewContext(render+';renderStockCapitalHistory(document.getElementById("host"),data);',{document:dom.window.document,window:dom.window,data:{symbol:'AAPL',cik:'1',capitalHistory:{points:[],reason:'来源无精确年度记录',dataStatus:'empty'}},stockEscapeHtml:value=>String(value??'')});assert.match(dom.window.document.body.textContent,/来源无精确年度记录/);assert.ok(dom.window.document.querySelector('[data-capital-peers]'));assert.doesNotMatch(dom.window.document.body.textContent,/现金.*0 USD/);}finally{dom.window.close();}
});

test('fundamental history must not present missing revenue as a confirmed zero',()=>{
 const source=require('./helpers/dashboard-source.cjs').readDashboardSource(),render=source.match(/function renderFundamentalQuality\(data, freshness\) \{[\s\S]*?\n\}/)[0];assert.doesNotMatch(render,/compactUsd\(point\.revenueUsd \|\| 0\)/);
});
