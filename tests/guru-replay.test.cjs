const test=require('node:test');const assert=require('node:assert/strict');
test('13F replay compares exact identity, never issuer names, and weights within one report',()=>{
  const {compareReports}=require('../src/web/public/guru-replay.js');
  const base={reportPeriod:'2026-03-31',positions:[{cusip:'123456789',classTitle:'COM',shares:100,shareAmountType:'SH',reportedValueUsd:1000},{cusip:'987654321',classTitle:'COM',shares:40,reportedValueUsd:1000}]};
  const next={reportPeriod:'2026-06-30',positions:[{cusip:'123456789',classTitle:'COM',shares:120,shareAmountType:'SH',reportedValueUsd:3000},{cusip:'112233445',classTitle:'COM',shares:5,reportedValueUsd:1000},{issuerName:'same name',shares:99,reportedValueUsd:0}]};
  const result=compareReports(base,next);assert.equal(result.rows.find(r=>r.cusip==='123456789').change,20);assert.equal(result.rows.find(r=>r.cusip==='123456789').weightPct,75);assert.equal(result.rows.find(r=>r.cusip==='987654321').status,'退出');assert.equal(result.rows.find(r=>r.cusip==='112233445').status,'新进');assert.equal(result.unresolved,1);
});
test('13F replay refuses amendment, duplicate identity and non-adjacent quarter comparisons',()=>{
  const {compareReports}=require('../src/web/public/guru-replay.js');const rows=[{cusip:'123456789',classTitle:'COM',shares:10,reportedValueUsd:100}];
  const a={reportPeriod:'2026-03-31',positions:rows};
  assert.equal(compareReports(a,{reportPeriod:'2026-09-30',positions:rows}).comparable,false);
  assert.equal(compareReports(a,{reportPeriod:'2026-06-30',form:'13F-HR/A',positions:rows}).comparable,false);
  assert.equal(compareReports(a,{reportPeriod:'2026-06-30',positions:[...rows,...rows]}).comparable,false);
});
