const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('ts-node/register/transpile-only');
const {SQLiteStateStore}=require('../src/storage/sqlite-state');
const {ResearchProjectStore}=require('../src/features/research-projects');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-report-')),state=new SQLiteStateStore(path.join(dir,'state.sqlite'),dir),records=new Map();const store=new ResearchProjectStore(state,ref=>records.get(ref.id)||null);return {state,records,store,close(){state.close();fs.rmSync(dir,{recursive:true,force:true});}};}
test('pinned summaries remain fixed and retrospective diffs retain missing sides and affected conclusions',()=>{
 const f=fixture();try{let p=f.store.create({market:'stocks',title:'<script>private</script>',question:'question',hypothesis:'hypothesis',counterEvidence:'counter',acceptance:'acceptance'});
 for(const [id,progress] of [['one',25],['two',50]]){f.records.set(id,{market:'stocks',hash:id==='one'?'a'.repeat(64):'b'.repeat(64),updatedAt:'2026-01-01T00:00:00Z',summary:{status:'running',progress,parameters:{lookback:20},apiToken:'DO-NOT-COPY'}});p=f.store.link(p.id,p.version,{kind:'task',id});}
 p=f.store.conclude(p.id,p.version,{text:'Old decision',linkIds:[p.links[0].linkId]});
 const current=f.records.get('one');f.records.set('one',{...current,hash:'c'.repeat(64),updatedAt:'2026-01-02T00:00:00Z',summary:{status:'succeeded',progress:100,parameters:{lookback:30}}});
 const auditCount=f.state.listAudits().length,r=f.store.retrospective(p.id,p.links.map(row=>row.linkId));
 assert.equal(r.columns[0].pinnedSummary.progress,25);assert.equal(r.columns[0].summary.progress,100);assert.ok(r.columns[0].fieldChanges.some(row=>row.field==='progress'&&row.before===25&&row.after===100));assert.equal(r.columns[0].conclusions[0].text,'Old decision');assert.doesNotMatch(JSON.stringify(r),/DO-NOT-COPY|apiToken/);
 const report=f.store.report(p.id,p.links.map(row=>row.linkId));assert.equal(report.project.title,p.title);assert.equal(report.retrospective.contentHash,r.contentHash);assert.match(report.contentHash,/^[a-f0-9]{64}$/);assert.equal(f.state.listAudits().length,auditCount);
 const {renderProjectReport}=require('../src/features/project-retrospective-report');const html=renderProjectReport(report);assert.match(html,/<!doctype html>/i);assert.match(html,/@media print/);assert.doesNotMatch(html,/<script\b|<img\b|https?:\/\//i);assert.match(html,/&lt;script&gt;private&lt;\/script&gt;/);assert.match(html,/收益曲线.*缺失|未保存收益曲线/);
 assert.equal(f.store.export(p.id,'json'),JSON.stringify(f.store.read(p.id),null,2),'legacy export remains compatible');
 }finally{f.close();}
});
test('legacy references without historical summaries are never reconstructed from current results',()=>{
 const {buildProjectRetrospective}=require('../src/features/research-assistance');const links=['a','b'].map((id,i)=>({linkId:id,id,kind:'task',market:'crypto',hash:String(i+1).repeat(64),updatedAt:'2026-01-01'})),p={id:'p',market:'crypto',version:1,hypothesis:'h',links,conclusions:[],reviews:[]};
 const r=buildProjectRetrospective(p,links.map(link=>({linkId:link.linkId,current:{hash:link.hash,summary:{progress:100}}})),['a','b']);assert.equal(r.columns[0].comparisonStatus,'unavailable');assert.equal(r.columns[0].pinnedSummary,null);assert.equal(r.columns[0].fieldChanges.length,0);assert.throws(()=>buildProjectRetrospective(p,[],['a','elsewhere']));
});
test('report exports require explicit same-project selection and retain private permissions',async()=>{
 const express=require('express'),{createResearchProjectRouter}=require('../src/web/research-project-routes'),f=fixture(),app=express();let role='admin';app.use((req,res,next)=>{req.user={role};next();});app.use('/projects',createResearchProjectRouter(f.store));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{let p=f.store.create({market:'crypto',title:'Saved report',question:'q',hypothesis:'h',counterEvidence:'c',acceptance:'a'});for(const id of ['a','b']){f.records.set(id,{market:'crypto',hash:id.repeat(64),updatedAt:'2026-01-01T00:00:00Z',summary:{modelResult:{kind:'theoretical-backtest',equityCurve:[100,95,110],totalFees:1}}});p=f.store.link(p.id,p.version,{kind:'task',id});}
 const base=`http://127.0.0.1:${server.address().port}/projects/${p.id}`,query='market=crypto&linkIds='+p.links.map(row=>row.linkId).join(',');let r=await fetch(base+'/retrospective?'+query+'&includeReport=1');assert.equal(r.status,200);const body=await r.json();assert.match(body.reportHtml,/polyline/);assert.match(body.reportHtml,new RegExp(body.report.contentHash));assert.equal(body.report.retrospective.contentHash,body.data.contentHash);assert.equal(r.headers.get('cache-control'),'private, no-store');
 r=await fetch(base+'/export?'+query+'&format=html');assert.equal(r.status,200);assert.match(await r.text(),/polyline/);assert.match(r.headers.get('content-disposition'),/attachment/);
 assert.equal((await fetch(base+'/export?market=crypto&format=html')).status,400);assert.equal((await fetch(base+'/retrospective?'+query.replace('crypto','stocks'))).status,400);role='guest';assert.equal((await fetch(base+'/export?'+query+'&format=html')).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));f.close();}
});
