'use strict';
// Same allowances as the existing short session check, evaluated throughout
// the run instead of permitting a final recovery to conceal a transient leak.
const limits={nodes:1000,listeners:40,heapBytes:24*1024*1024,pendingRequests:8};
function evaluateContinuousSoak(report,requiredMs){
 const reasons=[],rows=report.measurements||[],elapsed=report.measuredElapsedMs;
 if(!Number.isFinite(requiredMs)||requiredMs<0)throw Error('Invalid required duration');
 if(!Number.isFinite(elapsed)||elapsed<requiredMs)reasons.push('actual duration insufficient');
 if(report.restarts)reasons.push('process restart invalidates continuity');
 if(report.pageErrors?.length)reasons.push('unhandled browser errors');
 if(rows.length<3)reasons.push('at least three observations required');
 let previous=0;
 for(const row of rows){
  if(!Number.isFinite(row.measuredMs)||row.measuredMs<previous)reasons.push('non-monotonic observation clock');
  if(row.measuredMs-previous>300000)reasons.push('monitoring gap exceeds five minutes');
  previous=row.measuredMs;
 }
 if(Number.isFinite(elapsed)&&(elapsed-previous>300000||previous>elapsed))reasons.push('unobserved final gap or invalid elapsed time');
 const stable=rows.slice(2),first=stable[0];
 for(let i=0;i<stable.length;i++){
  const row=stable[i],window=stable.slice(Math.max(0,i-5),i+1);
  for(const [key,allowance]of Object.entries(limits)){
   if(!Number.isFinite(row[key])||row[key]<0){reasons.push('invalid '+key);continue;}
   if(first&&row[key]>first[key]+allowance||window.some(old=>row[key]>old[key]+allowance))reasons.push(key+' growth beyond original allowance');
  }
 }
 return {status:reasons.length?'failed':'passed',requiredMs,observedMs:elapsed,observations:rows.length,maxMonitoringGapMs:300000,limits:{...limits},reasons:[...new Set(reasons)]};
}
module.exports={evaluateContinuousSoak};
