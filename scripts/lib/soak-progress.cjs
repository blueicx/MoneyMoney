'use strict';

const {performance}=require('node:perf_hooks');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAX_RECENT_SAMPLES=12,MAX_PENDING_REQUESTS=20,MAX_WORKSPACE_NODES=8,MAX_DIAGNOSTIC_STRING=160;
const DYNAMIC_PATH_PARENTS=new Set(['account','accounts','ai-runner','ai-runners','instrument','instruments','option-chain','options','order','orders','position','positions','runner','runners','session','sessions','symbol','symbols','trade','trades','user','users']);
const SAFE_PATH_SEGMENTS=new Set(['api','assets','auth','status','login','logout','health','live','stock','stocks','kline','indices','workspace','navigation','watchlist','paper','positions','options','events','entities','prediction-radar','binance','klines','crypto','markets','history','replay','quality','compare','snapshots','source','reports','ai-runners','css','js','fonts','images','favicon.ico']);
const safeString=(value,max=MAX_DIAGNOSTIC_STRING)=>typeof value==='string'?value.slice(0,max):null;
function safePath(rawUrl,localOrigin){
 try{
  const url=new URL(rawUrl);
  if(!localOrigin||url.origin!==new URL(localOrigin).origin)return null;
  const parts=url.pathname.split('/');let redactNext=false;
  return parts.map((part,index)=>{
   if(!part)return '';
   const lower=part.toLowerCase();
   const looksSensitive=redactNext||!SAFE_PATH_SEGMENTS.has(lower)||/^[0-9]+$/.test(part)||/^[a-f0-9]{24,}$/i.test(part)||/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(part)||part.length>48||/[?&#]/.test(part);
   redactNext=DYNAMIC_PATH_PARENTS.has(lower);
   if(looksSensitive)return ':redacted';
   return safeString(part,48)||'';
  }).join('/').slice(0,MAX_DIAGNOSTIC_STRING);
 }catch{return null;}
}
function summarizeSnapshot(snapshot){
 if(!snapshot||typeof snapshot!=='object')return null;
 const allNodes=Array.isArray(snapshot.topLevelWorkspaceNodes)?snapshot.topLevelWorkspaceNodes:[];
 const workspace=safeString(snapshot.workspace,64),workspaceRootIndex=allNodes.findIndex(node=>node?.workspaceId===snapshot.workspace||node?.id===snapshot.workspace||String(node?.workspaceIds||'').split(/\s+/).includes(snapshot.workspace));
 const selected=workspaceRootIndex<0?allNodes.slice(0,MAX_WORKSPACE_NODES):[allNodes[workspaceRootIndex],...allNodes.filter((_,index)=>index!==workspaceRootIndex).slice(0,MAX_WORKSPACE_NODES-1)];
 const nodes=selected.map(node=>({
  id:safeString(node?.id,64),workspaceId:safeString(node?.workspaceId,64),workspaceIds:safeString(node?.workspaceIds,96),nodeCount:Number.isFinite(node?.nodeCount)?node.nodeCount:null
 }));
 return {market:safeString(snapshot.market,32),workspace,readyState:safeString(snapshot.readyState,24),domElementCount:Number.isFinite(snapshot.domElementCount)?snapshot.domElementCount:null,topLevelWorkspaceNodes:nodes};
}
function summarizePending(requests,localOrigin){
 if(!Array.isArray(requests))return [];
 const result=[];
 for(const request of requests){
  if(result.length>=MAX_PENDING_REQUESTS)break;
  const path=safePath(request?.url,localOrigin);if(!path)continue;
  result.push({path,resourceType:safeString(request?.resourceType,24)||'unknown'});
 }
 return result;
}

async function waitForStableProgress({readSnapshot,getFinitePendingCount,getPendingRequests,localOrigin,expectedMarket,timeoutMs=5000,stableMs=500,pollMs=50,now=()=>performance.now(),sleepFor=sleep}){
 if(typeof readSnapshot!=='function')throw new TypeError('readSnapshot must be a function');
 if(typeof getFinitePendingCount!=='function')throw new TypeError('getFinitePendingCount must be a function');
 if(typeof expectedMarket!=='string'||!expectedMarket)throw new TypeError('expectedMarket is required');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1)throw new RangeError('timeoutMs must be a positive integer');
 if(!Number.isInteger(stableMs)||stableMs<1||stableMs>timeoutMs)throw new RangeError('stableMs must be between 1 and timeoutMs');
 if(!Number.isInteger(pollMs)||pollMs<1||pollMs>timeoutMs)throw new RangeError('pollMs must be between 1 and timeoutMs');

 const started=now();let stableSince=null,lastSnapshot=null,lastPending=null,lastContext=null;const recentSamples=[];
 const timeoutError=()=>{const error=new Error('workspace/request context did not stabilize within '+timeoutMs+'ms');error.name='SoakProgressTimeout';error.details={expectedMarket,snapshot:summarizeSnapshot(lastSnapshot),pendingRequests:lastPending,recentSamples:recentSamples.filter(Boolean),timeoutMs,stableMs};return error;};
 while(true){
  const readBudget=timeoutMs-(now()-started);if(readBudget<=0)throw timeoutError();
  const expired={timeout:true};let timer;
  const result=await Promise.race([Promise.resolve().then(readSnapshot).then(snapshot=>({snapshot})),new Promise(resolve=>{timer=setTimeout(()=>resolve(expired),readBudget);})]);
  clearTimeout(timer);if(result===expired)throw timeoutError();lastSnapshot=result.snapshot;
  lastPending=getFinitePendingCount();
  const summary=summarizeSnapshot(lastSnapshot),pending=typeof getPendingRequests==='function'?summarizePending(getPendingRequests(),localOrigin):[];
  const elapsedMs=Math.max(0,Math.round(now()-started)),sample={elapsedMs,market:summary?.market??null,workspace:summary?.workspace??null,readyState:summary?.readyState??null,dom:summary?{domElementCount:summary.domElementCount,topLevelWorkspaceNodes:summary.topLevelWorkspaceNodes}:null,pending};
  const bucketIndex=Math.min(MAX_RECENT_SAMPLES-1,Math.floor(elapsedMs/timeoutMs*MAX_RECENT_SAMPLES));recentSamples[bucketIndex]=sample;
  const ready=lastSnapshot&&['interactive','complete'].includes(lastSnapshot.readyState);
  const expected=lastSnapshot?.market===expectedMarket;
  const context=JSON.stringify([lastSnapshot?.market??null,lastSnapshot?.workspace??null,lastSnapshot?.readyState??null,lastSnapshot?.domElementCount??null,lastSnapshot?.topLevelWorkspaceNodes??null]);
  const canSettle=ready&&expected&&Number.isInteger(lastPending)&&lastPending===0;
  if(now()-started>=timeoutMs)throw timeoutError();
  if(canSettle){if(context!==lastContext)stableSince=now();else if(stableSince===null)stableSince=now();lastContext=context;if(now()-stableSince>=stableMs)return lastSnapshot;}
  else{stableSince=null;lastContext=context;}
  const remaining=timeoutMs-(now()-started);
  if(remaining<=0)throw timeoutError();
  await sleepFor(Math.min(pollMs,remaining));
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
function needsAnotherObservation(report,requiredCycles,requiredMs){
 if(!Number.isInteger(requiredCycles)||requiredCycles<0)throw new RangeError('requiredCycles must be a non-negative integer');
 if(!Number.isFinite(requiredMs)||requiredMs<0)throw new RangeError('requiredMs must be a non-negative finite number');
 const rows=report?.measurements||[],last=rows.at(-1);
 return rows.length<requiredCycles||!Number.isFinite(last?.measuredMs)||last.measuredMs<requiredMs;
}
module.exports={waitForStableProgress,evaluateRollingAcceptance,evaluateSourceProgress,needsAnotherObservation};
