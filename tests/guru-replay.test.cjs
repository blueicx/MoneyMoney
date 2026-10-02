const test=require('node:test');const assert=require('node:assert/strict');
test('13F replay compares exact identity, never issuer names, and weights within one report',()=>{
  const {compareReports}=require('../src/web/public/guru-replay.js');
  const base={cik:'0001067983',reportPeriod:'2026-03-31',positions:[{cusip:'123456789',classTitle:'COM',shares:100,shareAmountType:'SH',reportedValueUsd:1000},{cusip:'987654321',classTitle:'COM',shares:40,shareAmountType:'SH',reportedValueUsd:1000}]};
  const next={cik:'1067983',reportPeriod:'2026-06-30',positions:[{cusip:'123456789',classTitle:'COM',shares:120,shareAmountType:'SH',reportedValueUsd:3000},{cusip:'112233445',classTitle:'COM',shares:5,shareAmountType:'SH',reportedValueUsd:1000},{issuerName:'same name',shares:99,reportedValueUsd:0}]};
  const result=compareReports(base,next);assert.equal(result.rows.find(r=>r.cusip==='123456789').change,20);assert.equal(result.rows.find(r=>r.cusip==='123456789').weightPct,75);assert.equal(result.rows.find(r=>r.cusip==='987654321').status,'不可比');assert.equal(result.rows.find(r=>r.cusip==='112233445').status,'新进');assert.equal(result.unresolved,1);
  assert.equal(compareReports(base,{...next,positions:next.positions.slice(0,2)}).rows.find(r=>r.cusip==='987654321').status,'退出');
});

test('13F CSV neutralizes formulas and rendering replaces an earlier replay panel',()=>{
  const {csv,render}=require('../src/web/public/guru-replay.js'),{JSDOM}=require('jsdom');
  assert.match(csv([['=HYPERLINK("bad")','ordinary']]),/"'=HYPERLINK/);
  const dom=new JSDOM('<div id="host"></div>'),prior=global.document;global.document=dom.window.document;
  try{const host=document.querySelector('#host'),history={reports:[{reportPeriod:'2026-06-30',positions:[]}]};render(host,history);render(host,history);assert.equal(host.querySelectorAll('.mm-guru-replay').length,1);assert.equal(host.querySelector('[data-guru-export]').disabled,true);render(host,{reports:[]});assert.equal(host.querySelectorAll('.mm-guru-replay').length,0);}finally{global.document=prior;dom.window.close();}
});

test('13F never guesses missing units, null shares, or a unit change',()=>{
  const {compareReports}=require('../src/web/public/guru-replay.js');
  const p={cusip:'123456789',classTitle:'COM',shares:100,shareAmountType:'SH',reportedValueUsd:1000};
  const a={cik:'1067983',reportPeriod:'2026-03-31',positions:[p]};
  for(const changed of [{...p,shareAmountType:null},{...p,shares:null},{...p,shareAmountType:'PRN'}]){
    const r=compareReports(a,{cik:'1067983',reportPeriod:'2026-06-30',positions:[changed]});
    assert.ok(r.rows.length,'uncertain positions remain visible');
    assert.ok(r.rows.every(row=>row.change===null),'no fabricated zero or newly disclosed position');
    assert.match(r.reason,/单位|股数|身份|不完整/);
  }
});

test('13F rejects different or absent manager identity and non-quarter-end dates',()=>{
  const {compareReports}=require('../src/web/public/guru-replay.js');
  const a={cik:'1067983',reportPeriod:'2026-03-31',positions:[{cusip:'123456789',classTitle:'COM',shareAmountType:'SH',shares:10}]};
  for(const b of [{...a,cik:'999',reportPeriod:'2026-06-30'},{...a,cik:null,reportPeriod:'2026-06-30'},{...a,reportPeriod:'2026-06-29'}]) assert.equal(compareReports(a,b).comparable,false);
});

test('large 13F reports paginate 100 visible rows but export every filtered result',()=>{
  const {render}=require('../src/web/public/guru-replay.js'),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="host"></div>'),prior=global.document;global.document=dom.window.document;
  try{let content;render(document.querySelector('#host'),{reports:[{cik:'123',reportPeriod:'2026-06-30',positions:Array.from({length:205},(_,i)=>({cusip:String(i).padStart(9,'0'),classTitle:'COM',shareAmountType:'SH',shares:i,issuerName:'Row'+i}))}]},{download:(_,text)=>{content=text;}});assert.equal(document.querySelectorAll('tbody tr').length,100);document.querySelector('[data-guru-page-next]').click();assert.equal(document.querySelectorAll('tbody tr').length,100);document.querySelector('[data-guru-page-next]').click();assert.equal(document.querySelectorAll('tbody tr').length,5);assert.equal(document.querySelector('[data-guru-page-next]').disabled,true);document.querySelector('[data-guru-export]').click();assert.equal(content.split('\r\n').length,206);const search=document.querySelector('[data-guru-search]');search.value='Row204';search.dispatchEvent(new dom.window.Event('input'));assert.equal(document.querySelectorAll('tbody tr').length,1);assert.equal(document.querySelector('[data-guru-page-previous]').disabled,true);}finally{global.document=prior;dom.window.close();}
});

test('13F replay allows search, change filtering, quarter navigation and scoped CSV',()=>{
  const {JSDOM}=require('jsdom'),{render}=require('../src/web/public/guru-replay.js');
  const dom=new JSDOM('<div id="host"></div>');const prior=global.document;global.document=dom.window.document;
  try{
    const p={cusip:'123456789',issuerName:'Alpha',classTitle:'COM',shares:100,shareAmountType:'SH',reportedValueUsd:1000};
    const reports=[{cik:'123',reportPeriod:'2026-03-31',positions:[p]},{cik:'123',reportPeriod:'2026-06-30',positions:[{...p,shares:120},{...p,cusip:'987654321',issuerName:'Beta',shares:20}]}];
    let downloaded;render(document.querySelector('#host'),{reports},{download:(name,content)=>{downloaded={name,content};}});
    const search=document.querySelector('[data-guru-search]');assert.ok(search,'search exists');search.value='Beta';search.dispatchEvent(new dom.window.Event('input'));assert.equal(document.querySelectorAll('tbody tr').length,1);
    document.querySelector('[data-guru-export]').click();assert.match(downloaded.content,/Beta/);assert.doesNotMatch(downloaded.content,/Alpha/);assert.match(downloaded.content,/报告期/);
    search.value='';search.dispatchEvent(new dom.window.Event('input'));const filter=document.querySelector('[data-guru-filter]');filter.value='增持';filter.dispatchEvent(new dom.window.Event('change'));assert.equal(document.querySelectorAll('tbody tr').length,1);
    document.querySelector('[data-guru-previous]').click();assert.match(document.querySelector('[data-report]').textContent,/2026-03-31/);assert.equal(document.querySelector('[data-guru-previous]').disabled,true);
    document.querySelector('[data-guru-next]').click();assert.equal(document.querySelector('[data-guru-next]').disabled,true);
  }finally{global.document=prior;dom.window.close();}
});
test('13F replay refuses amendment, duplicate identity and non-adjacent quarter comparisons',()=>{
  const {compareReports}=require('../src/web/public/guru-replay.js');const rows=[{cusip:'123456789',classTitle:'COM',shares:10,reportedValueUsd:100}];
  const a={reportPeriod:'2026-03-31',positions:rows};
  assert.equal(compareReports(a,{reportPeriod:'2026-09-30',positions:rows}).comparable,false);
  assert.equal(compareReports(a,{reportPeriod:'2026-06-30',form:'13F-HR/A',positions:rows}).comparable,false);
  assert.equal(compareReports(a,{reportPeriod:'2026-06-30',positions:[...rows,...rows]}).comparable,false);
});
