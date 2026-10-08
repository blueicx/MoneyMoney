const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function load(){assert.ok(fs.existsSync(path.join(__dirname,'../scripts/private-chart-canary.cjs')),'缺少生产私有图表只读验收');return require('../scripts/private-chart-canary.cjs');}
test('private canary permits only same-origin read-only API requests',()=>{
 const {allowedApiRequest}=load(),base='https://bluetrade.bbroot.com';
 assert.equal(allowedApiRequest(base+'/api/contracts/detail?market=crypto','GET',base),true);
 for(const [url,method] of [[base+'/api/ai-runners/id/tick','POST'],[base+'/api/watchlist','DELETE'],['https://other.test/api/paper','GET'],[base+'/api/paper','HEAD']])assert.equal(allowedApiRequest(url,method,base),false);
});
test('real marker evidence must match its immutable hash, exact market/instrument and pre-fill capture time',()=>{
 const {verifyMarkerEvidence}=load(),fields={market:'stocks',instrument:'MU',status:'delayed',source:'verified-test-source',dataAt:'2026-10-08T10:00:00Z',price:100};
 const hash=crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
 const marker={market:'stocks',instrument:'stock:us:MU',time:Date.parse('2026-10-08T10:01:00Z'),snapshotId:'rs_'+hash};
 const evidence={market:'stocks',instrument:'stock:us:MU',data:{id:'rs_'+hash,hash,fields,at:'2026-10-08T10:00:30Z'}};
 assert.doesNotThrow(()=>verifyMarkerEvidence(marker,evidence));
 for(const mutate of [d=>d.data.fields.price=999,d=>d.instrument='stock:us:AAPL',d=>d.market='crypto',d=>d.data.at='2026-10-08T10:02:00Z',d=>d.data.fields.dataAt='2026-10-08T10:02:00Z']){
  const changed=structuredClone(evidence);mutate(changed);assert.throws(()=>verifyMarkerEvidence(marker,changed));
 }
});
test('private browser fixture places its fill only inside a valid final candle',()=>{
 const {paperEvidenceFixtureBars}=load();assert.equal(typeof paperEvidenceFixtureBars,'function','read-only chart fixture builder missing');
 const fillTime=Date.parse('2026-10-08T10:31:17.000Z'),rows=paperEvidenceFixtureBars(fillTime);
 assert.equal(rows.length,25);assert.equal(rows.at(-1).time,Date.parse('2026-10-08T10:31:00.000Z'));
 assert.ok(fillTime>=rows.at(-1).time&&fillTime<rows.at(-1).time+60000);
 assert.ok(rows.every(row=>[row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite)&&row.high>=Math.max(row.open,row.close)&&row.low<=Math.min(row.open,row.close)));
});
