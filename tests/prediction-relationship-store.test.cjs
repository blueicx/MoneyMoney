const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
const now='2026-10-01T00:00:00Z',left={market:'prediction',instrument:'prediction:kalshi:EVENT-A',probability:.6,observedAt:now,source:'Kalshi',ruleHash:'a'.repeat(64),evidenceRef:'evidence-a'},right={market:'prediction',instrument:'prediction:polymarket:123',probability:.5,observedAt:now,source:'Polymarket',ruleHash:'b'.repeat(64),evidenceRef:'evidence-b'};
function fixture(){const map=new Map(),store={get:k=>map.get(k)||null,set:(k,v)=>map.set(k,structuredClone(v)),transaction:f=>f()};return {map,store};}
test('manual event relationships retain original rule hashes and attestations, never become automatically verified semantics',()=>{
 const {PredictionRelationshipStore}=require('../src/features/prediction-relationship-audit');assert.equal(typeof PredictionRelationshipStore,'function');const {store}=fixture(),s=new PredictionRelationshipStore(store);
 const input={left,right,relationship:'mutually-exclusive',confirmed:true,reason:'I checked the two official resolution rules'};
 const saved=s.save(input,now);assert.equal(saved.semanticStatus,'human-attested');assert.equal(saved.executionEnabled,false);assert.equal(s.save(input,now).id,saved.id);assert.equal(s.list({market:'prediction',now,ruleHash:id=>id===left.instrument?left.ruleHash:right.ruleHash}).length,1);
 const changed=s.list({market:'prediction',now,ruleHash:()=> 'c'.repeat(64)})[0];assert.equal(changed.ruleStatus,'changed');assert.equal(changed.probabilityConclusion,null);assert.equal(changed.record.left.ruleHash,left.ruleHash);
 assert.equal(s.list({market:'stocks',now,ruleHash:()=>null}).length,0);
});
test('missing attestation, stale quotes and tampered saved graph edges fail closed',()=>{
 const {PredictionRelationshipStore}=require('../src/features/prediction-relationship-audit');assert.equal(typeof PredictionRelationshipStore,'function');const {store,map}=fixture(),s=new PredictionRelationshipStore(store),input={left,right,relationship:'equivalent',confirmed:true,reason:'Reviewed evidence, conditional relationship'};
 assert.throws(()=>s.save({...input,confirmed:false},now));assert.throws(()=>s.save({...input,reason:''},now));assert.throws(()=>s.save(input,'2026-10-01T01:00:00Z'));
 s.save(input,now);const [key,rows]=[...map.entries()][0];rows[0].left.probability=.99;map.set(key,rows);assert.equal(s.list({market:'prediction',now,ruleHash:()=>left.ruleHash}).length,0);
});
test('relationship graph routes require administrator access and use only server-resolved quotes and rules',async()=>{
 const express=require('express'),{createPredictionRelationshipRouter}=require('../src/web/prediction-relationship-routes'),{PredictionRelationshipStore}=require('../src/features/prediction-relationship-audit');
 const {store}=fixture(),app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']==='admin'?'admin':'guest'};next();});
 app.use('/api/prediction/relationships',createPredictionRelationshipRouter({store:new PredictionRelationshipStore(store),quote:id=>id===left.instrument?left:id===right.instrument?right:null,ruleHash:id=>id===left.instrument?left.ruleHash:right.ruleHash,now:()=>now}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/prediction/relationships';
 try{assert.equal((await fetch(base)).status,403);assert.equal((await fetch(base+'/check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  const response=await fetch(base+'/check',{method:'POST',headers:{'content-type':'application/json','x-role':'admin'},body:JSON.stringify({left:left.instrument,right:right.instrument,relationship:'equivalent',confirmed:true,save:true,reason:'Manual official rule comparison'})});assert.equal(response.status,200);const body=await response.json();assert.ok(body.saved.id);assert.equal(body.saved.semanticStatus,'human-attested');
  const list=await fetch(base,{headers:{'x-role':'admin'}});assert.match(list.headers.get('cache-control'),/no-store/);assert.equal((await list.json()).data.length,1);
 }finally{await new Promise(r=>server.close(r));}
});
test('manual graph survives a SQLite restart without overwriting its original evidence',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-prediction-graph-'));process.env.MONEYMONEY_DATA_DIR=root;
 const {SQLiteStateStore}=require('../src/storage/sqlite-state'),{PredictionRelationshipStore}=require('../src/features/prediction-relationship-audit'),file=path.join(root,'graph.sqlite');let db=new SQLiteStateStore(file,root),s=new PredictionRelationshipStore(db);
 const saved=s.save({left,right,relationship:'equivalent',confirmed:true,reason:'Reviewed the official source evidence'},now);db.close();db=new SQLiteStateStore(file,root);s=new PredictionRelationshipStore(db);
 try{const rows=s.list({market:'prediction',now,ruleHash:id=>id===left.instrument?left.ruleHash:right.ruleHash});assert.equal(rows[0].record.hash,saved.hash);assert.equal(rows[0].record.reason,saved.reason);}finally{db.close();}
});
