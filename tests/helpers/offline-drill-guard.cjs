'use strict';
const allowed=value=>{try{const u=new URL(typeof value==='string'||value instanceof URL?value:value.url);return ['127.0.0.1','localhost','[::1]'].includes(u.hostname);}catch{return false;}};
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{if(!allowed(input))return Promise.reject(new Error('Isolated drill blocks external network'));return originalFetch(input,options);};
for(const name of ['node:http','node:https']){const transport=require(name),request=transport.request,get=transport.get;
 const local=args=>{const target=args[0];if(typeof target==='string'||target instanceof URL)return allowed(target);return target&&['127.0.0.1','localhost','::1'].includes(target.hostname||target.host);};
 transport.request=function(...args){if(!local(args))throw Error('Isolated drill blocks external HTTP');return request.apply(this,args);};
 transport.get=function(...args){if(!local(args))throw Error('Isolated drill blocks external HTTP');return get.apply(this,args);};
}
