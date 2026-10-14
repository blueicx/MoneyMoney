const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('table comparison keeps missing numbers unknown and sorts financial units without zero fallback',()=>{
 assert.ok(fs.existsSync('src/web/public/table-tools.js'));const {compareCellValues}=require('../src/web/public/table-tools');assert.ok(compareCellValues('100 USD','2 USD')>0);assert.ok(compareCellValues('不可用','0 USD')>0);assert.ok(compareCellValues('不可用','0 USD',-1)>0);assert.ok(compareCellValues('$1,000','$100')>0);assert.equal(compareCellValues('—','不可用'),0);
});
test('table column preferences and sorting preserve row callbacks, restore original order, and never hide every column',()=>{
 assert.ok(fs.existsSync('src/web/public/table-tools.js'));const {enhanceTable}=require('../src/web/public/table-tools'),dom=new JSDOM('<div><table><thead><tr><th>标的</th><th>价格 USD</th></tr></thead><tbody><tr><td>A</td><td>100 USD</td></tr><tr><td>B</td><td>2 USD</td></tr><tr><td>C</td><td>不可用</td></tr></tbody></table></div>',{url:'https://test.invalid'}),d=dom.window.document;let clicks=0;const table=d.querySelector('table');table.tBodies[0].rows[0].onclick=()=>clicks++;
 try{enhanceTable(table,{market:'stocks',workspace:'fundamentals'});d.querySelector('[data-mm-table-sort="1"]').click();assert.equal(table.tBodies[0].rows[0].cells[0].textContent,'B');table.tBodies[0].rows[1].click();assert.equal(clicks,1);const column=d.querySelector('[data-mm-table-column="1"]');column.checked=false;column.dispatchEvent(new dom.window.Event('change'));assert.equal(table.tBodies[0].rows[0].cells[1].hidden,true);const first=d.querySelector('[data-mm-table-column="0"]');first.checked=false;first.dispatchEvent(new dom.window.Event('change'));assert.equal(first.checked,true);d.querySelector('[data-mm-table-reset]').click();assert.equal(table.tBodies[0].rows[0].cells[0].textContent,'A');assert.equal(table.tBodies[0].rows[0].cells[1].hidden,false);}finally{dom.window.close();}
});
test('mixed monetary units are grouped by unit, never sorted as exchange-rate-equivalent amounts',()=>{
 const {compareCellValues}=require('../src/web/public/table-tools');assert.equal(Math.sign(compareCellValues('100 USD','2 USDT')),Math.sign(compareCellValues('1 USD','200 USDT')));
});
test('merged body cells are left untouched without adding unusable controls',()=>{
 const {enhanceTable}=require('../src/web/public/table-tools'),dom=new JSDOM('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td colspan="2">group</td></tr></tbody></table>');try{assert.equal(enhanceTable(dom.window.document.querySelector('table'),{market:'stocks',workspace:'fundamentals'}),null);assert.equal(dom.window.document.querySelector('[data-mm-table-tools]'),null);}finally{dom.window.close();}
});
