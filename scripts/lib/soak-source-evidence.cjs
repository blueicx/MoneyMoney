'use strict';
const {createHash}=require('node:crypto');
const markets=['stocks','crypto','options','prediction'];
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const policies={stocks:{fetchMaxAgeMs:300000,barMaxAgeMs:96*3600000},crypto:{fetchMaxAgeMs:300000,barMaxAgeMs:2*3600000},options:{fetchMaxAgeMs:300000},prediction:{fetchMaxAgeMs:900000}};
const timestamp=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()?Date.parse(value):NaN;
const fresh=(value,now,age)=>Number.isFinite(value)&&value<=now&&now-value<=age;
function sourceProviders(source){const text=String(source||'').toLowerCase().replace(/good judgment open/g,'gjopen');return ['yahoo','sina','tencent','nasdaq','eastmoney','binance','gateio','coinbase','deribit','cboe','kalshi','polymarket','manifold','metaculus','goodjudgment','gjopen','predict'].filter(p=>text.includes(p));}
const domains={yahoo:['yahoo.com'],sina:['sina.com.cn','sinajs.cn'],tencent:['qq.com'],nasdaq:['nasdaq.com'],eastmoney:['eastmoney.com'],binance:['binance.com','binance.us','binance.vision'],gateio:['gateio.ws','gateio.io','gate.io'],coinbase:['coinbase.com'],deribit:['deribit.com'],cboe:['cboe.com'],kalshi:['kalshi.com'],polymarket:['polymarket.com'],manifold:['manifold.markets'],metaculus:['metaculus.com'],goodjudgment:['goodjudgment.com'],gjopen:['gjopen.com'],predict:['predict.fun']};
function matchesProvider(host,providers){return providers.some(p=>(domains[p]||[]).some(d=>host===d||host.endsWith('.'+d)));}
function sourceObservation(market,payload,httpStatus,measuredMs,observedAt=Date.now()){
 const now=timestamp(observedAt),data=payload?.data,policy=policies[market];let valid=false,source=payload?.source||null,count=0,fetchTime=payload?.updatedAt||null,latestBarAt=null;
 if(['stocks','crypto'].includes(market)){const rows=Array.isArray(data)?data.filter(row=>positive(row.close)&&Number.isFinite(timestamp(row.time))):[];count=rows.length;latestBarAt=count?Math.max(...rows.map(row=>timestamp(row.time))):null;valid=count>0&&['live','delayed','cached','historical'].includes(payload?.dataStatus)&&fresh(latestBarAt,now,policy.barMaxAgeMs);}
 if(market==='options'){count=Array.isArray(data?.expiries)?data.expiries.reduce((n,e)=>n+(e.rows||[]).filter(r=>typeof r.instrumentName==='string'&&(positive(r.bidPrice)||positive(r.askPrice))).length,0):0;valid=positive(data?.spot)&&count>0;fetchTime=data?.fetchedAt||fetchTime;}
 if(market==='prediction'){const rows=Array.isArray(data?.markets)?data.markets:[];count=rows.filter(r=>typeof r.platform==='string'&&Number.isFinite(r.yesPrice)&&r.yesPrice>=0&&r.yesPrice<=1).length;source=[...new Set(rows.map(r=>r.platform).filter(Boolean))].join(', ')||null;fetchTime=data?.updatedAt||fetchTime;valid=count>0&&rows.every(r=>sourceProviders(r.platform).length===1)&&sourceProviders(source).every(p=>data?.sources?.[p]?.ok===true&&positive(data.sources[p].count)&&fresh(timestamp(data.sources[p].checkedAt),now,policy.fetchMaxAgeMs));}
 const providers=sourceProviders(source),fetchMs=timestamp(fetchTime),fixture=/fixture|synthetic|isolated|mock/i.test(String(source)),timeValid=!!policy&&fresh(fetchMs,now,policy.fetchMaxAgeMs);
 const ok=httpStatus===200&&payload?.success===true&&valid&&providers.length>0&&!fixture&&timeValid;
 return {market,measuredMs,at:Number.isFinite(now)?new Date(now).toISOString():null,ok,httpStatus,source,providers,serverFetchedAt:Number.isFinite(fetchMs)?new Date(fetchMs).toISOString():null,sourceTime:payload?.sourceTime||null,latestBarAt:latestBarAt===null?null:new Date(latestBarAt).toISOString(),fetchAgeMs:Number.isFinite(fetchMs)?now-fetchMs:null,validRecords:count,dataStatus:payload?.dataStatus||null,reason:!timeValid?'missing, stale or future fetch timestamp':!valid?'missing, stale or invalid market records':fixture?'fixture source rejected':payload?.reason||payload?.error||null,responseHash:createHash('sha256').update(JSON.stringify(payload??null)).digest('hex')};
}
function evaluatePublicSourceEvidence(samples,network,elapsed){
 const reasons=[],coverage={};if(!Number.isFinite(elapsed)||elapsed<0)reasons.push('invalid measured duration');
 for(const market of markets){const rows=samples.filter(s=>s.market===market),successful=[],responses=new Set();let previous=0,previousSuccess=0;
  for(const row of rows){if(!Number.isFinite(row.measuredMs)||row.measuredMs<previous||row.measuredMs>elapsed||row.measuredMs-previous>300000)reasons.push(market+' public probe heartbeat gap');previous=row.measuredMs;
   const at=timestamp(row.at),providers=sourceProviders(row.source),matching=network.filter(e=>e.phase==='response'&&e.allowed===true&&e.status>=200&&e.status<300&&Number.isFinite(e.at)&&e.at<=at+1000&&at-e.at<=300000&&matchesProvider(String(e.host).toLowerCase(),providers));
   if(row.ok===true&&Number.isFinite(at)&&providers.length>0&&providers.every(p=>matching.some(e=>matchesProvider(String(e.host).toLowerCase(),[p])))){if(row.measuredMs-previousSuccess>300000)reasons.push(market+' validated source evidence gap');previousSuccess=row.measuredMs;successful.push(row);matching.forEach(e=>responses.add(e));}
  }
  if(!rows.length||elapsed-previous>300000)reasons.push(market+' missing public probe heartbeat');
  if(!successful.length||elapsed-previousSuccess>300000)reasons.push(market+' missing recent validated response with matching upstream evidence');
  coverage[market]={probes:rows.length,successful:successful.length,failed:rows.length-successful.length,confirmedUpstreamResponses:responses.size};
 }
 return {status:reasons.length?'failed':'passed',coverage,reasons:[...new Set(reasons)],policies,maxEvidenceGapMs:300000,modelCalls:0,claim:'validated public reads with same-provider upstream responses within five minutes; fetch time is separate from source/bar time; stock bar age policy allows weekends, not proof of exchange-session freshness'};
}
module.exports={sourceObservation,evaluatePublicSourceEvidence};
