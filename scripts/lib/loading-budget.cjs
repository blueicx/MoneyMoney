'use strict';
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
/** Absolute regression budget, not proof of an improvement against an unmatched baseline. */
function assessLoadingBudget(samples){
 const by=new Map();
 for(const s of samples||[]){const key=JSON.stringify([s.viewport,s.temperature]);const group=by.get(key)||[];group.push(s);by.set(key,group);}
 const groups=[...by.values()].map(rows=>{
  const first=rows[0],limits=first.temperature==='warm'?{shellMs:1200,chartMs:2500,jsBytes:10000}:{shellMs:3000,chartMs:6500,jsBytes:180000};
  const valid=rows.filter(r=>[r.shellReadyMs,r.chartReadyMs,r.jsBytes].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0));
  const count=new Set(valid.map(r=>r.run)).size;
  const shellMedianMs=valid.length?median(valid.map(r=>r.shellReadyMs)):null,chartMedianMs=valid.length?median(valid.map(r=>r.chartReadyMs)):null,jsMedianBytes=valid.length?median(valid.map(r=>r.jsBytes)):null;
  const exceeded=count>=3?[shellMedianMs>limits.shellMs?'shell':null,chartMedianMs>limits.chartMs?'chart':null,jsMedianBytes>limits.jsBytes?'javascript':null].filter(Boolean):[];
  return {viewport:first.viewport,temperature:first.temperature,samples:count,shellMedianMs,chartMedianMs,jsMedianBytes,limits,status:count<3?'insufficient':exceeded.length?'exceeded':'passed',exceeded};
 });
 return {status:!groups.length||groups.some(g=>g.status==='insufficient')?'insufficient':groups.some(g=>g.status==='exceeded')?'exceeded':'passed',groups,improvementPct:null,reason:'绝对预算按各视口冷热至少3次中位数评估，含Provider等待；没有同环境配对基线，不宣称提速百分比。'};
}
module.exports={assessLoadingBudget};
