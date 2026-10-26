'use strict';

const {performance}=require('node:perf_hooks');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForStableProgress({readSnapshot,getFinitePendingCount,expectedMarket,timeoutMs=5000,stableMs=500,pollMs=50}){
 if(typeof readSnapshot!=='function')throw new TypeError('readSnapshot must be a function');
 if(typeof getFinitePendingCount!=='function')throw new TypeError('getFinitePendingCount must be a function');
 if(typeof expectedMarket!=='string'||!expectedMarket)throw new TypeError('expectedMarket is required');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1)throw new RangeError('timeoutMs must be a positive integer');
 if(!Number.isInteger(stableMs)||stableMs<1||stableMs>timeoutMs)throw new RangeError('stableMs must be between 1 and timeoutMs');
 if(!Number.isInteger(pollMs)||pollMs<1||pollMs>timeoutMs)throw new RangeError('pollMs must be between 1 and timeoutMs');

 const started=performance.now();let stableSince=null,lastSnapshot=null,lastPending=null,lastContext=null;
 const timeoutError=()=>{const error=new Error('workspace/request context did not stabilize within '+timeoutMs+'ms');error.name='SoakProgressTimeout';error.details={expectedMarket,snapshot:lastSnapshot,pendingRequests:lastPending,timeoutMs,stableMs};return error;};
 while(true){
  const readBudget=timeoutMs-(performance.now()-started);if(readBudget<=0)throw timeoutError();
  const expired={timeout:true};let timer;
  const result=await Promise.race([Promise.resolve().then(readSnapshot).then(snapshot=>({snapshot})),new Promise(resolve=>{timer=setTimeout(()=>resolve(expired),readBudget);})]);
  clearTimeout(timer);if(result===expired)throw timeoutError();lastSnapshot=result.snapshot;
  lastPending=getFinitePendingCount();
  const ready=lastSnapshot&&['interactive','complete'].includes(lastSnapshot.readyState);
  const expected=lastSnapshot?.market===expectedMarket;
  const context=JSON.stringify([lastSnapshot?.market??null,lastSnapshot?.workspace??null,lastSnapshot?.readyState??null,lastSnapshot?.domElementCount??null,lastSnapshot?.topLevelWorkspaceNodes??null]);
  const canSettle=ready&&expected&&Number.isInteger(lastPending)&&lastPending===0;
  if(performance.now()-started>=timeoutMs)throw timeoutError();
  if(canSettle){if(context!==lastContext)stableSince=performance.now();else if(stableSince===null)stableSince=performance.now();lastContext=context;if(performance.now()-stableSince>=stableMs)return lastSnapshot;}
  else{stableSince=null;lastContext=context;}
  const remaining=timeoutMs-(performance.now()-started);
  if(remaining<=0)throw timeoutError();
  await sleep(Math.min(pollMs,remaining));
 }
}

function evaluateRollingAcceptance(report,evaluator){
 if(typeof evaluator!=='function')throw new TypeError('evaluator must be a function');
 if((report?.measurements||[]).length<3)return null;
 return {...evaluator(report,0),progressOnly:true};
}

function evaluateSourceProgress(report,network,evaluator){
 if(typeof evaluator!=='function')throw new TypeError('evaluator must be a function');
 if(!Number.isFinite(report?.measuredElapsedMs)||report.measuredElapsedMs<300000)return null;
 return {...evaluator(report.sourceProbes||[],network,report.measuredElapsedMs),progressOnly:true};
}
module.exports={waitForStableProgress,evaluateRollingAcceptance,evaluateSourceProgress};
