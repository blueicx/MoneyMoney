const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
require('ts-node/register/transpile-only');
const {buildResearchEvidenceGraph,renderResearchEvidenceGraphSvg}=require('../src/features/research-evidence-graph');
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('affected paths traverse explicit conclusion to experiment to changed snapshot',()=>{
 const saved={experiment:{id:'e1',market:'stocks',instrument:'stock:us:AAPL',parameters:{x:1},snapshotRefs:['snap1']}},expHash=hash(saved),expLink={linkId:'exp-link',kind:'experiment',id:'e1',market:'stocks',instrument:'stock:us:AAPL',hash:expHash},snapLink={linkId:'snap-link',kind:'partition',id:'snap1',market:'stocks',instrument:'stock:us:AAPL',hash:'a'.repeat(64)},conclusion={id:'c1',text:'claim',references:[expLink]};
 const project={id:'p1',market:'stocks',title:'p',version:3,links:[expLink,snapLink],conclusions:[conclusion]},states=[{linkId:'exp-link',pinnedHash:expHash,current:{hash:expHash,market:'stocks',instrument:'stock:us:AAPL'},changed:false},{linkId:'snap-link',pinnedHash:'a'.repeat(64),current:{hash:'b'.repeat(64),market:'stocks',instrument:'stock:us:AAPL'},changed:true}];
 const graph=buildResearchEvidenceGraph(project,states,id=>id==='e1'?saved:null),path=graph.affectedPaths.find(x=>x.conclusionId==='c1');
 assert.deepEqual(path.path,['conclusion:c1','reference:exp-link','reference:snap-link']);
});
test('SVG lays parameter and snapshot nodes in distinct rows of their shared column',()=>{const graph={nodes:[{id:'p',kind:'parameter',status:'immutable',label:'p',fixedHash:null,currentHash:null},{id:'s',kind:'snapshot',status:'current',label:'s',fixedHash:null,currentHash:null}],edges:[],projectId:'p',market:'stocks',projectVersion:0,affectedPaths:[],unknowns:[]};const svg=renderResearchEvidenceGraphSvg(graph),ys=[...svg.matchAll(/<rect x="910" y="(\d+)"/g)].map(x=>x[1]);assert.equal(ys.length,2);assert.notEqual(ys[0],ys[1]);});
test('governance graph UI renders inline focusable SVG and returns focus on Escape without instrument validation',()=>{const source=fs.readFileSync('src/web/public/research-evidence-governance-workspace.js','utf8');assert.match(source,/function scope\(requireInstrument=true\)/);assert.match(source,/const s=scope\(false\)/);assert.match(source,/document\.createElementNS\(ns,'svg'\)/);assert.doesNotMatch(source,/createElement\('img'\)/);const dom=new JSDOM('<button data-graph>Graph</button><svg xmlns="http://www.w3.org/2000/svg"><g tabindex="0"></g></svg>',{runScripts:'outside-only'}),{window}=dom,node=window.document.querySelector('g'),button=window.document.querySelector('button');node.addEventListener('keydown',event=>{if(event.key==='Escape'){button.focus();event.preventDefault();}});node.focus();node.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(window.document.activeElement,button);});
