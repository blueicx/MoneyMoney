'use strict';
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
/** Absolute regression budget, not proof of an improvement against an unmatched baseline. */
function assessLoadingBudget(samples){
 const by=new Map([1440,390].flatMap(viewport=>['cold','warm'].map(temperature=>[JSON.stringify([viewport,temperature]),{viewport,temperature,rows:[]}])));
 let invalidInput=!Array.isArray(samples);
 for(const s of Array.isArray(samples)?samples:[]){const group=by.get(JSON.stringify([s?.viewport,s?.temperature]));if(!group){invalidInput=true;continue;}group.rows.push(s);}
 const groups=[...by.values()].map(({viewport,temperature,rows})=>{
  const limits=temperature==='warm'?{shellMs:1200,chartMs:2500,jsBytes:10000}:{shellMs:3000,chartMs:6500,jsBytes:180000};
  const valid=rows.filter(r=>Number.isInteger(r.run)&&r.run>=0&&[r.shellReadyMs,r.chartReadyMs,r.jsBytes].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0));
  const count=new Set(valid.map(r=>r.run)).size;
  const shellMedianMs=valid.length?median(valid.map(r=>r.shellReadyMs)):null,chartMedianMs=valid.length?median(valid.map(r=>r.chartReadyMs)):null,jsMedianBytes=valid.length?median(valid.map(r=>r.jsBytes)):null;
  const exceeded=count>=3?[shellMedianMs>limits.shellMs?'shell':null,chartMedianMs>limits.chartMs?'chart':null,jsMedianBytes>limits.jsBytes?'javascript':null].filter(Boolean):[];
  return {viewport,temperature,samples:count,shellMedianMs,chartMedianMs,jsMedianBytes,limits,status:count<3||count!==rows.length?'insufficient':exceeded.length?'exceeded':'passed',exceeded};
 });
 for(const viewport of [1440,390]){
  const cold=by.get(JSON.stringify([viewport,'cold'])).rows,warm=by.get(JSON.stringify([viewport,'warm'])).rows;
  const coldRuns=new Set(cold.map(r=>r.run)),warmRuns=new Set(warm.map(r=>r.run));
  if(coldRuns.size!==warmRuns.size||[...coldRuns].some(run=>!warmRuns.has(run)))for(const group of groups)if(group.viewport===viewport)group.status='insufficient';
 }
 return {status:invalidInput||groups.some(g=>g.status==='insufficient')?'insufficient':groups.some(g=>g.status==='exceeded')?'exceeded':'passed',groups,improvementPct:null,reason:'绝对预算要求桌面1440与手机390各有至少3组有效、唯一且配对的冷热样本，含Provider等待；局部诊断不算完整验收，没有同环境配对基线，不宣称提速百分比。'};
}
module.exports={assessLoadingBudget};
