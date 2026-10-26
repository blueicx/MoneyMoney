'use strict';
const fs=require('node:fs');
const publicMarketDomains=[
 'yahoo.com','sina.com.cn','sinajs.cn','nasdaq.com','eastmoney.com',
 'binance.com','binance.us','binance.vision','gateio.ws','gateio.io','gate.io',
 'coinbase.com','deribit.com','cboe.com','kalshi.com','kalshi.co','polymarket.com',
 'manifold.markets','metaculus.com','goodjudgment.com','gjopen.com','predict.fun','sec.gov'
];
const exactMarketHosts=new Set(['qt.gtimg.cn','smartbox.gtimg.cn']);
const privatePath=/(?:^|\/)(?:order|orders|openorders|allorders|mytrades|userdatastream|account|accounts|private|wallet|wallets|balance|balances|positionrisk|trade|trades|withdraw|transfer|completions|messages)(?:\/|$)/i;
function isLoopback(host){return host==='localhost'||host==='[::1]'||/^127(?:\.\d{1,3}){3}$/.test(host);}
function isPublicMarketHost(host){return exactMarketHosts.has(host)||publicMarketDomains.some(domain=>host===domain||host.endsWith('.'+domain));}
function allowedRead(value,method='GET'){
 try{const u=new URL(value),verb=String(method).toUpperCase();if(!['http:','https:'].includes(u.protocol)||!['GET','HEAD'].includes(verb)||privatePath.test(decodeURIComponent(u.pathname)))return false;return isLoopback(u.hostname)||(u.protocol==='https:'&&isPublicMarketHost(u.hostname));}catch{return false;}
}
function check(value,method){
 const allowed=allowedRead(value,method);
 if(process.env.MONEYMONEY_SOAK_NETWORK_LOG){try{const u=new URL(value);fs.appendFileSync(process.env.MONEYMONEY_SOAK_NETWORK_LOG,JSON.stringify({at:Date.now(),host:u.hostname,path:u.hostname.includes('telegram')?'[notification-blocked]':u.pathname,method,allowed})+'\n');}catch{}}
 if(!allowed)throw Error('Read-only soak blocks non-public, model or mutating request');
}
function outcome(value,method,phase,status,started){try{if(!process.env.MONEYMONEY_SOAK_NETWORK_LOG)return;const u=new URL(value);fs.appendFileSync(process.env.MONEYMONEY_SOAK_NETWORK_LOG,JSON.stringify({at:Date.now(),host:u.hostname,path:u.pathname,method,allowed:true,phase,status,latencyMs:Date.now()-started})+'\n');}catch{}}
module.exports={allowedRead};
// Installed only in isolated service children; importing the policy in a unit
// test never changes the test process network stack.
if(process.env.MONEYMONEY_SOAK_READ_ONLY==='1'){
 const original=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{const value=typeof input==='string'||input instanceof URL?input:input.url,method=options?.method||input?.method||'GET',started=Date.now();check(value,method);try{const response=await original(input,options);outcome(value,method,'response',response.status,started);return response;}catch(e){outcome(value,method,'failure',0,started);throw e;}};
 for(const name of ['node:http','node:https']){
  const transport=require(name),protocol=name==='node:https'?'https:':'http:';
  for(const key of ['request','get']){const original=transport[key];transport[key]=function(...args){const first=args[0],options=typeof first==='object'&&!(first instanceof URL)?first:args[1];const url=typeof first==='string'||first instanceof URL?String(first):protocol+'//'+(first.hostname||first.host)+(first.port?':'+first.port:'')+(first.path||'/'),method=options?.method||'GET',started=Date.now();check(url,method);const request=original.apply(this,args);request.once('response',response=>outcome(url,method,'response',response.statusCode,started));request.once('error',()=>outcome(url,method,'failure',0,started));return request;};}
 }
}
