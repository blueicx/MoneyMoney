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
test('column widths and precision persist without unit conversion or sorting by rounded values; display changes can be undone',()=>{
 const {enhanceTable}=require('../src/web/public/table-tools'),dom=new JSDOM('<table><thead><tr><th>标的</th><th>价格</th></tr></thead><tbody><tr><td>A</td><td>1.234 USD</td></tr><tr><td>B</td><td>1.231 USD</td></tr></tbody></table>',{url:'https://test.invalid'}),d=dom.window.document;
 try{const table=d.querySelector('table');enhanceTable(table,{market:'stocks',workspace:'fundamentals'});
 const target=d.querySelector('[data-mm-table-edit-column]');assert.ok(target);target.value='1';target.dispatchEvent(new dom.window.Event('change'));
 const precision=d.querySelector('[data-mm-table-precision]');precision.value='2';precision.dispatchEvent(new dom.window.Event('change'));assert.equal(table.tBodies[0].rows[0].cells[1].textContent,'1.23 USD');assert.match(table.tBodies[0].rows[0].cells[1].title,/1.234 USD/);
 d.querySelector('[data-mm-table-sort="1"]').click();assert.equal(table.tBodies[0].rows[0].cells[0].textContent,'B');
 const width=d.querySelector('[data-mm-table-width]');width.value='240';width.dispatchEvent(new dom.window.Event('change'));assert.equal(table.tHead.rows[0].cells[1].style.width,'240px');
 d.querySelector('[data-mm-table-undo]').click();assert.equal(table.tHead.rows[0].cells[1].style.width,'');assert.match(d.querySelector('[data-mm-table-history]').textContent,/撤销/);
 const stored=Object.values(dom.window.localStorage).join('');assert.doesNotMatch(stored,/1\.234|1\.231/);assert.match(stored,/precision/);
 }finally{dom.window.close();}
});
