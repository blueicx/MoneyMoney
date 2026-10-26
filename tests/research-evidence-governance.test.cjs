const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
require('ts-node/register/transpile-only');

const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
class State{
 constructor(){this.rows=new Map();this.audits=[];this.health={ok:true};}
 get(k){return this.rows.has(k)?structuredClone(this.rows.get(k)):null;}
 set(k,v){this.rows.set(k,structuredClone(v));}
 transaction(fn){return fn();}
 appendAudit(row){this.audits.push(structuredClone(row));}
}
function setup(){
 const {ResearchProjectStore}=require('../src/features/research-projects'),state=new State(),saved=new Map(),partitions=new Map();let now=Date.parse('2026-10-26T12:00:00Z');
 const resolver=ref=>ref.kind==='experiment'&&saved.has(ref.id)?{market:saved.get(ref.id).experiment.market,instrument:saved.get(ref.id).experiment.instrument,hash:sha(saved.get(ref.id)),updatedAt:saved.get(ref.id).experiment.createdAt,summary:{parameters:saved.get(ref.id).experiment.parameters||{},dataSnapshotHash:saved.get(ref.id).experiment.dataSnapshotHash||null}}:ref.kind==='partition'&&partitions.has(ref.id)?partitions.get(ref.id):null;
 const projects=new ResearchProjectStore(state,resolver,()=>now);
 return {state,saved,partitions,projects,setNow:value=>{now=value;}};
}
const projectInput={market:'stocks',title:'AAPL saved evidence',question:'Do fixed inputs support the claim?',hypothesis:'Saved hypothesis',counterEvidence:'Saved counter evidence',acceptance:'Saved acceptance'};
const snapshot=(id,overrides={})=>({id,market:'stocks',instrument:'AAPL',dataset:'bars',timeframe:'1d',asOf:'2026-10-01T00:00:00.000Z',partitionId:'partition_'+id,contentHash:id==='old'?'a'.repeat(64):'b'.repeat(64),source:'saved fixture',createdAt:'2026-10-02T00:00:00.000Z',...overrides});
const catalogHelpers=()=>({resolveInstrument:(market,id)=>market==='stocks'&&id==='stock:us:AAPL'?{id,symbol:'AAPL'}:null,verifySavedSnapshotTuple:s=>({snapshot:s,partitions:[{id:s.partitionId,contentHash:s.contentHash,fileHash:null}],verified:true,reason:'saved catalog tuple verified'})});

test('proof reads only a saved exact snapshot and leaves absent currency/session/file hash unknown',async()=>{
 const {createSavedEvidenceProofService}=require('../src/features/research-evidence-governance'),{projects}=setup();
 const ref=snapshot('old'),catalog={...catalogHelpers(),getSnapshot:id=>id==='old'?ref:null,listSnapshots:()=>[ref],readSnapshotProofExact:async s=>({dataStatus:'historical',snapshot:s,fileHashes:[],coverage:{start:null,end:null,rows:0},adjustment:'unknown',currency:null,session:null,reason:'manifest not saved'})};
 const service=createSavedEvidenceProofService({catalog,projects});
 const result=await service.proof({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',snapshotId:'old'});
 assert.equal(result.snapshot.contentHash,'a'.repeat(64));assert.equal(result.fileHash,null);assert.equal(result.currency,'unknown');assert.equal(result.session,'unknown');assert.equal(result.dataStatus,'unavailable');
 await assert.rejects(()=>service.proof({market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',snapshotId:'not-saved'}),/不存在|不可用/);
});

test('recapture association is explicit, same identity, immutable, idempotent, and never replaces the project reference',async()=>{
 const {createSavedEvidenceProofService}=require('../src/features/research-evidence-governance'),ctx=setup(),old=snapshot('old'),fresh=snapshot('fresh',{asOf:'2026-10-05T00:00:00.000Z'});
 const project=ctx.projects.create(projectInput),catalog={...catalogHelpers(),getSnapshot:id=>({old,fresh}[id]||null),listSnapshots:()=>[old,fresh],readSnapshotProofExact:async s=>({dataStatus:'historical',snapshot:s,fileHashes:s.id==='old'?[]:[{partitionId:s.partitionId,fileHash:s.contentHash}],coverage:{rows:3},adjustment:'unknown',currency:null,session:null})};
 const service=createSavedEvidenceProofService({catalog,projects:ctx.projects,state:ctx.state});
 const input={projectId:project.id,market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',originalSnapshotId:'old',recapturedSnapshotId:'fresh',reason:'explicit re-capture',expectedVersion:0,idempotencyKey:'recapture-key-0001'};
 const first=await service.associateRecapture(input),again=await service.associateRecapture(input);
 assert.equal(first.contentHash,again.contentHash);assert.equal(ctx.projects.read(project.id).links.length,0);assert.equal(first.originalProof.verifiedSnapshot,false);assert.deepEqual(first.originalProof.missingProof,['fileHash','currency','session']);assert.equal(first.originalProof.tupleVerified,true);assert.equal(first.recapturedProof.verifiedSnapshot,true);assert.equal(ctx.state.audits.length,2);
 await assert.rejects(()=>service.associateRecapture({...input,reason:'different request'}),/幂等/);
 await assert.rejects(()=>service.associateRecapture({...input,idempotencyKey:'recapture-key-0002',recapturedSnapshotId:'foreign'}),/快照|身份|不存在/);
});

test('evidence graph emits only explicit saved project links and shows fixed/current hashes and affected conclusions',()=>{
 const {buildResearchEvidenceGraph}=require('../src/features/research-evidence-graph'),ctx=setup(),p=ctx.projects.create(projectInput);
 ctx.saved.set('experiment-1',{experiment:{id:'experiment-1',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:'2026-10-01T00:00:00Z',parameters:{feeRate:.001},dataSnapshotHash:'f'.repeat(64)}});
 const linked=ctx.projects.link(p.id,p.version,{kind:'experiment',id:'experiment-1'});const conclusion=ctx.projects.conclude(p.id,linked.version,{text:'claim',linkIds:[linked.links[0].linkId]});
 const state=ctx.projects.referenceStates(p.id),changed={...state[0],current:{...state[0].current,hash:'c'.repeat(64)},changed:true};
 const graph=buildResearchEvidenceGraph(ctx.projects.read(p.id),[changed]);
 assert.equal(graph.nodes.find(n=>n.id==='project:'+p.id).fixedHash,null);assert.equal(graph.nodes.find(n=>n.id==='reference:'+linked.links[0].linkId).fixedHash,linked.links[0].hash);
 assert.equal(graph.nodes.find(n=>n.id==='reference:'+linked.links[0].linkId).currentHash,'c'.repeat(64));assert(graph.edges.some(e=>e.from==='conclusion:'+conclusion.conclusions[0].id&&e.to==='reference:'+linked.links[0].linkId));assert(graph.affectedPaths.some(row=>row.path.includes('conclusion:'+conclusion.conclusions[0].id)));
 assert.equal(graph.edges.some(e=>e.to.includes('snapshot')||e.to.includes('parameter')),false,'embedded metadata is not a separate explicit reference');
});

test('evidence graph rejects a saved cross-market conclusion edge rather than drawing a misleading path',()=>{
 const {buildResearchEvidenceGraph}=require('../src/features/research-evidence-graph'),ctx=setup(),p=ctx.projects.create(projectInput);
 const corrupted=ctx.projects.read(p.id);corrupted.links.push({kind:'project-conclusion',id:'project_foreign',conclusionId:'conclusion_foreign',linkId:'foreign-link',market:'crypto',instrument:undefined,hash:'a'.repeat(64),updatedAt:'2026-10-01T00:00:00Z',linkedAt:'2026-10-01T00:00:00Z',readOnly:true,inputEligible:false});
 assert.throws(()=>buildResearchEvidenceGraph(corrupted,[]),/跨市场/);
});

test('evidence graph adds fixed parameter and explicitly saved snapshot edges only from a Hash-matching experiment',()=>{
 const {buildResearchEvidenceGraph}=require('../src/features/research-evidence-graph'),ctx=setup(),p=ctx.projects.create(projectInput),fixedHash='f'.repeat(64);
 ctx.partitions.set('partition_fixed',{market:'stocks',instrument:'stock:us:AAPL',hash:fixedHash,updatedAt:'2026-10-25T00:00:00Z'});
 const saved={experiment:{id:'experiment-graph',market:'stocks',instrument:'stock:us:AAPL',createdAt:'2026-10-25T00:00:00Z',parameters:{feeRate:.001}},partitionRefs:['partition_fixed']};ctx.saved.set('experiment-graph',saved);
 let links=ctx.projects.link(p.id,p.version,{kind:'experiment',id:'experiment-graph'});links=ctx.projects.link(p.id,links.version,{kind:'partition',id:'partition_fixed'});const graph=buildResearchEvidenceGraph(ctx.projects.read(p.id),ctx.projects.referenceStates(p.id),id=>ctx.saved.get(id)||null);
 assert(graph.edges.some(edge=>edge.kind==='experiment-parameter'));assert(graph.edges.some(edge=>edge.kind==='experiment-snapshot'));assert.equal(new Set(graph.nodes.map(node=>node.id)).size,graph.nodes.length,'late target link must not duplicate an already referenced node');assert.deepEqual(graph.nodes.find(node=>node.kind==='parameter').values,{feeRate:.001});
 const changed={...saved,experiment:{...saved.experiment,parameters:{feeRate:.002}}};const mismatched=buildResearchEvidenceGraph(ctx.projects.read(p.id),ctx.projects.referenceStates(p.id),id=>id==='experiment-graph'?changed:null);
 assert.equal(mismatched.edges.some(edge=>edge.kind==='experiment-parameter'),false);assert.equal(mismatched.unknowns.some(value=>value.includes('Hash 与固定 Hash 不同')),true);
 assert.equal(links.links.find(row=>row.kind==='experiment').hash,sha(saved));
});

test('preregistration freezes fixed link hashes and marks post-result registration retrospective',()=>{
 const {createResearchPreregistrationStore}=require('../src/features/research-preregistration'),ctx=setup();const p=ctx.projects.create(projectInput);
 ctx.saved.set('e1',{experiment:{id:'e1',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:'2026-10-01T00:00:00Z',parameters:{feeRate:.001},dataSnapshotHash:'d'.repeat(64)}});
 const linked=ctx.projects.link(p.id,p.version,{kind:'experiment',id:'e1'}),store=createResearchPreregistrationStore({state:ctx.state,projects:ctx.projects,now:()=>Date.parse('2026-10-26T12:00:00Z')});
 const input={projectId:p.id,market:'stocks',expectedVersion:0,idempotencyKey:'prereg-key-0001',hypothesis:'freeze this',primaryMetric:'net_return',sampleDefinition:'saved bars only',stopCondition:'stop at 100 trials',parameterBudget:{feeRate:{min:0,max:.01,steps:5}},fixedReferenceLinkIds:[linked.links[0].linkId]};
 const row=store.register(input);assert.equal(row.registrationStatus,'retrospective');assert.equal(row.fixedReferences[0].hash,linked.links[0].hash);assert.match(row.contentHash,/^[a-f0-9]{64}$/);assert.equal(store.register(input).contentHash,row.contentHash);assert.equal(ctx.state.audits.length,3);
 assert.throws(()=>store.register({...input,idempotencyKey:'prereg-key-0002',expectedVersion:0}),/版本/);
});

test('preregistration records only explicit saved experiment outcomes and counts unique configurations without computing results',()=>{
 const {createResearchPreregistrationStore}=require('../src/features/research-preregistration'),ctx=setup(),p=ctx.projects.create(projectInput);
 ctx.saved.set('e1',{experiment:{id:'e1',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:'2026-10-01T00:00:00Z',parameters:{feeRate:.001},dataSnapshotHash:'d'.repeat(64)},backtest:{metrics:{tradesCount:4}},robustness:{dataStatus:'historical'}});
 ctx.saved.set('e2',{experiment:{id:'e2',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:'2026-10-02T00:00:00Z',parameters:{feeRate:.001},dataSnapshotHash:'d'.repeat(64)},error:'saved failure'});
 let linked=ctx.projects.link(p.id,p.version,{kind:'experiment',id:'e1'});linked=ctx.projects.link(p.id,linked.version,{kind:'experiment',id:'e2'});
 const store=createResearchPreregistrationStore({state:ctx.state,projects:ctx.projects,getSavedExperiment:id=>ctx.saved.get(id)}),record=store.register({projectId:p.id,market:'stocks',expectedVersion:0,idempotencyKey:'prereg-key-0002',hypothesis:'h',primaryMetric:'m',sampleDefinition:'s',stopCondition:'c',parameterBudget:{feeRate:{min:0,max:.01,steps:5}},fixedReferenceLinkIds:linked.links.map(x=>x.linkId)});
 const associated=store.associateSavedExperiments({projectId:p.id,registrationId:record.id,expectedVersion:1,idempotencyKey:'experiments-key-0001',experimentIds:['e1','e2']});
 assert.deepEqual(associated.experiments.map(x=>x.outcome),['succeeded','failed']);assert(associated.experiments.every(x=>/^[a-f0-9]{64}$/.test(x.parameterHash)));assert.equal(associated.trialCount,2);assert.equal(associated.uniqueConfigurations,1);assert.equal(associated.costCompleteness,'unknown');assert.equal(associated.sampleLeakage,'unknown');
 const repeated=store.associateSavedExperiments({projectId:p.id,registrationId:record.id,expectedVersion:2,idempotencyKey:'experiments-key-0002',experimentIds:['e1','e2']});assert.equal(repeated.trialCount,2,'same saved experiment must not inflate attempt counts');
 assert.throws(()=>store.associateSavedExperiments({projectId:p.id,registrationId:record.id,expectedVersion:3,idempotencyKey:'experiments-key-0003',experimentIds:['client-fabricated']}),/已保存|明确/);
});

test('prospective association retains saved results while explicitly checking registration time, fixed input hash, input hash, and parameter budget',()=>{
 const {createResearchPreregistrationStore}=require('../src/features/research-preregistration'),ctx=setup(),p=ctx.projects.create(projectInput),fixedHash='e'.repeat(64);
 ctx.partitions.set('partition_fixed',{market:'stocks',instrument:'stock:us:AAPL',hash:fixedHash,updatedAt:'2026-10-25T00:00:00Z'});
 let linked=ctx.projects.link(p.id,p.version,{kind:'partition',id:'partition_fixed'});
 const store=createResearchPreregistrationStore({state:ctx.state,projects:ctx.projects,getSavedExperiment:id=>ctx.saved.get(id),now:()=>Date.parse('2026-10-26T12:00:00Z')});
 const registration=store.register({projectId:p.id,market:'stocks',expectedVersion:0,idempotencyKey:'prospective-key-001',hypothesis:'freeze before result',primaryMetric:'net_return',sampleDefinition:'saved fixed snapshot',stopCondition:'five trials',parameterBudget:{feeRate:{min:0,max:.01,steps:5}},fixedReferenceLinkIds:[linked.links[0].linkId]});
 assert.equal(registration.registrationStatus,'prospective');assert.equal(registration.inputBindingStatus,'fixed-evidence-selected');
 ctx.setNow(Date.parse('2026-10-26T12:01:00Z'));
 const input={context:{market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',dataSnapshotHash:fixedHash},prices:[1,2],signals:[]};
 ctx.saved.set('e-future',{input,inputHash:sha(input),experiment:{id:'e-future',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:'2026-10-26T12:01:00Z',parameters:{feeRate:.005},dataSnapshotHash:fixedHash},backtest:{completedAt:'2026-10-26T12:02:00Z',metrics:{tradesCount:1}}});
 linked=ctx.projects.link(p.id,linked.version,{kind:'experiment',id:'e-future'});
 const view=store.associateSavedExperiments({projectId:p.id,registrationId:registration.id,expectedVersion:1,idempotencyKey:'future-assoc-001',experimentIds:['e-future']});
 assert.equal(view.trialCount,1);assert.equal(view.comparableTrialCount,1);assert.equal(view.experiments[0].fixedInputStatus,'verified');assert.equal(view.experiments[0].budgetStatus,'within');assert.match(view.experiments[0].inputHash,/^[a-f0-9]{64}$/);assert.equal(view.budgetExceeded,false);
});

test('late project linkage cannot make a pre-registration experiment prospective and missing result time remains unknown',()=>{
 const {createResearchPreregistrationStore}=require('../src/features/research-preregistration'),ctx=setup(),p=ctx.projects.create(projectInput),fixedHash='d'.repeat(64);
 ctx.partitions.set('partition-time',{market:'stocks',instrument:'stock:us:AAPL',hash:fixedHash,updatedAt:'2026-10-25T00:00:00Z'});
 const dataLink=ctx.projects.link(p.id,p.version,{kind:'partition',id:'partition-time'}),store=createResearchPreregistrationStore({state:ctx.state,projects:ctx.projects,getSavedExperiment:id=>ctx.saved.get(id),now:()=>Date.parse('2026-10-26T12:00:00Z')});
 const registration=store.register({projectId:p.id,market:'stocks',expectedVersion:0,idempotencyKey:'time-check-key-01',hypothesis:'h',primaryMetric:'m',sampleDefinition:'s',stopCondition:'c',parameterBudget:{feeRate:{min:.005,max:.005,steps:4}},fixedReferenceLinkIds:[dataLink.links[0].linkId]});
 const input={context:{market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',dataSnapshotHash:fixedHash},prices:[1],signals:[]};
 ctx.saved.set('created-before',{input,inputHash:sha(input),experiment:{id:'created-before',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:'2026-10-26T11:59:00Z',parameters:{feeRate:.005},dataSnapshotHash:fixedHash},backtest:{completedAt:'2026-10-26T11:59:30Z'}});
 ctx.saved.set('missing-completion',{input,inputHash:sha(input),experiment:{id:'missing-completion',market:'stocks',instrument:'stock:us:AAPL',timeframe:'1d',createdAt:'2026-10-26T12:01:00Z',parameters:{feeRate:.005},dataSnapshotHash:fixedHash},backtest:{metrics:{tradesCount:1}}});
 ctx.setNow(Date.parse('2026-10-26T12:02:00Z'));let linked=ctx.projects.link(p.id,dataLink.version,{kind:'experiment',id:'created-before'});linked=ctx.projects.link(p.id,linked.version,{kind:'experiment',id:'missing-completion'});
 const result=store.associateSavedExperiments({projectId:p.id,registrationId:registration.id,expectedVersion:1,idempotencyKey:'time-assoc-key-01',experimentIds:['created-before','missing-completion']});
 assert.equal(registration.registrationStatus,'prospective');assert.deepEqual(result.experiments.map(row=>row.temporalStatus),['mismatch','unknown']);assert.deepEqual(result.experiments.map(row=>row.inputHashStatus),['verified','verified']);assert(result.experiments.every(row=>row.budgetStatus==='within'));assert.equal(result.comparableTrialCount,0);assert.equal(result.trialCount,2);
});
