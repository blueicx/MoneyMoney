import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
export const restrictedStrategy=require('../web/public/restricted-strategy.js');
type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'>;
interface DefinitionVersion {id:string;hash:string;version:number;market:string;createdAt:string;interpreterVersion:string;definition:Record<string,any>}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function identity(id:string){if(typeof id!=='string'||!/^strategy_[a-f0-9-]{36}$/.test(id))throw Error('策略定义ID无效');return id;}
function market(m:string){if(!['stocks','options','crypto','prediction'].includes(m))throw Error('策略定义市场无效');return m;}
export class StrategyDefinitionStore {
 constructor(private state:State,private now=Date.now){}
 private index(m:string){const rows=this.state.get<string[]>('strategy-definitions:v1:'+market(m))||[];if(!this.state.health.ok||!Array.isArray(rows)||rows.length>100)throw Error('策略定义目录不可核验');return rows;}
 read(id:string,hash?:string):DefinitionVersion {
  identity(id);const latest=this.state.get<{hash:string}>('strategy-definition-head:'+id),key=hash||latest?.hash;if(!key||!/^[a-f0-9]{64}$/.test(key))throw Error('策略定义或版本不存在');
  const row=this.state.get<DefinitionVersion>('strategy-definition-version:'+id+':'+key);if(!this.state.health.ok||!row)throw Error('策略定义不可用');const definition=restrictedStrategy.validate(row.definition);if(row.id!==id||row.hash!==key||row.market!==definition.market||row.interpreterVersion!==restrictedStrategy.version||!Number.isSafeInteger(row.version)||row.version<1||digest({interpreterVersion:row.interpreterVersion,definition})!==key)throw Error('策略定义Hash或版本不可核验');return {...row,definition};
 }
 list(m:string){return this.index(m).map(id=>this.read(id)).filter(row=>row.market===m);}
 versions(id:string){identity(id);const hashes=this.state.get<string[]>('strategy-definition-history:'+id)||[];if(!Array.isArray(hashes)||hashes.length>100)throw Error('策略历史目录不可核验');return hashes.map(hash=>this.read(id,hash));}
 save(input:unknown,id?:string,expectedHash?:string):DefinitionVersion {
  const definition=restrictedStrategy.validate(input),m=market(definition.market),hash=digest({interpreterVersion:restrictedStrategy.version,definition});
  return this.state.transaction(()=>{const rows=this.index(m);let current:DefinitionVersion|undefined;if(id){current=this.read(id);if(current.market!==m)throw Error('策略版本不能修改市场');if(expectedHash!==current.hash)throw Error('策略版本已变化，请重新读取');if(hash===current.hash)return current;}else if(rows.length>=100)throw Error('本市场策略定义已达100个，未删除历史');
   const key=id||'strategy_'+randomUUID(),saved=this.state.get<DefinitionVersion>('strategy-definition-version:'+key+':'+hash);if(saved){this.read(key,hash);throw Error('此内容已存在历史版本，请显式查看历史，不重写版本链');}const history=id?this.versions(id).map(v=>v.hash):[];if(history.length>=100)throw Error('已达100个版本上限，保留已有历史');
   const row:DefinitionVersion={id:key,market:m,hash,version:(current?.version||0)+1,createdAt:new Date(this.now()).toISOString(),interpreterVersion:restrictedStrategy.version,definition};this.state.set('strategy-definition-version:'+key+':'+hash,row);this.state.set('strategy-definition-head:'+key,{hash});this.state.set('strategy-definition-history:'+key,[...history,hash]);if(!id)this.state.set('strategy-definitions:v1:'+m,[...rows,key]);this.state.appendAudit({id:randomUUID(),action:'strategy-definition-version',detail:JSON.stringify({id:key,market:m,hash,version:row.version}),at:row.createdAt});return structuredClone(row);
  });
 }
}
