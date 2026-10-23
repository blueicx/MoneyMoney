const fields=new Set(['status','progress','direction','thesis','horizonAt','review','action','entryPrice','triggeredAt','exitPrice','exitAt','realizedPnlPct','strategyId','strategyVersion','version','timeframe','dataSource','parameters','from','to','startAt','endAt','sampleCount','sampleFrom','sampleTo','modelResult','pendingReasons','outcomes']);
const excluded=/token|secret|password|cookie|credential|privatekey|authorization|^__proto__$|^constructor$|^prototype$/i;
/** Small explicit research summaries only; no original model payloads or source/account documents. */
export function preserveResearchSummary(input:unknown):Record<string,unknown>|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const copy=(value:unknown,depth:number):unknown=>{
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return value.slice(0,2000);
  if(depth>=6)return null;
  if(Array.isArray(value))return value.length<=2000?value.map(v=>copy(v,depth+1)):null;
  if(value&&typeof value==='object'){const out:Record<string,unknown>={};for(const [key,v]of Object.entries(value).slice(0,80))if(!excluded.test(key))out[key]=copy(v,depth+1);return out;}
  return null;
 };
 const result:Record<string,unknown>={};for(const [key,value]of Object.entries(input))if(fields.has(key)&&!excluded.test(key))result[key]=copy(value,0);
 return Object.keys(result).length&&JSON.stringify(result).length<=200000?result:null;
}
export function compareResearchSummaries(before:Record<string,unknown>|null,after:Record<string,unknown>|null){
 if(!before||!after)return [];
 const flatten=(input:Record<string,unknown>)=>{const result=new Map<string,unknown>();const visit=(value:unknown,key:string)=>{if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length){for(const [child,v]of Object.entries(value))visit(v,key?key+'.'+child:child);}else result.set(key,value);};visit(input,'');return result;};
 const a=flatten(before),b=flatten(after);
 return [...new Set([...a.keys(),...b.keys()])].sort().flatMap(field=>JSON.stringify(a.get(field))===JSON.stringify(b.get(field))?[]:[{field,before:a.has(field)?a.get(field):null,after:b.has(field)?b.get(field):null,beforePresent:a.has(field),afterPresent:b.has(field)}]);
}
