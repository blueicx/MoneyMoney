import { randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import { normalizeInstrumentRef, parseInstrumentQuery } from './unified-instruments';

export interface WatchlistMetadata { groupId: string | null; tags: string[]; reason: string; observeOn: string | null; pinned: boolean; order: number }
interface Content { groups: Array<{id:string;name:string}>; items: Record<string,WatchlistMetadata> }
interface Operation { id:string; revision:number; before:Content; at:string }
interface MetadataState extends Content { revision:number; history:Operation[] }
type Change = Partial<WatchlistMetadata> & { instrument:string };
const KEY = 'watchlist-metadata:admin:v1';
const empty = (): MetadataState => ({revision:0,groups:[],items:{},history:[]});
const defaults = (): WatchlistMetadata => ({groupId:null,tags:[],reason:'',observeOn:null,pinned:false,order:0});
function text(value:unknown, max:number) { if(typeof value!=='string'||value.length>max)throw Error('文本长度或类型无效'); return value.trim(); }
function canonical(value:string) {
  if(!/^(stock|option|crypto|prediction):[^:]+:[^\s]{1,180}$/.test(value))throw Error('需要规范标的身份');
  const ref=parseInstrumentQuery(value);if(!ref||normalizeInstrumentRef(ref).id!==value)throw Error('标的身份无效');return value;
}
export class WatchlistMetadataStore {
  constructor(private store:Pick<SQLiteStateStore,'get'|'set'|'transaction'>, private watchlist:()=>string[]) {}
  read() { const state=this.store.get<MetadataState>(KEY)||empty();const ids=new Set(this.watchlist());return {...state,items:Object.fromEntries([...ids].map(id=>[id,state.items[id]||defaults()])),history:state.history.map(({id,revision,at})=>({id,revision,at}))}; }
  apply(revision:number,input:{groups?:Content['groups'];changes:Change[]}) {
    return this.store.transaction(()=>{
      const state=this.store.get<MetadataState>(KEY)||empty();if(revision!==state.revision)throw Error('版本已变化，请刷新后重试');
      if(!Array.isArray(input.changes)||input.changes.length>500||!input.changes.length&&!input.groups)throw Error('请选择批量变更');
      const groups=input.groups===undefined?state.groups:input.groups;
      if(!Array.isArray(groups)||groups.length>30||new Set(groups.map(g=>g.id)).size!==groups.length)throw Error('分组最多30个且身份必须唯一');
      const validatedGroups=groups.map(g=>{if(!/^[a-zA-Z0-9_-]{1,40}$/.test(g.id))throw Error('分组身份无效');const name=text(g.name,40);if(!name)throw Error('分组名称不能为空');return {id:g.id,name};});
      const groupIds=new Set(validatedGroups.map(g=>g.id)),watched=new Set(this.watchlist()),items=Object.fromEntries(Object.entries(state.items).map(([id,value])=>[id,{...value,tags:[...value.tags]}]));
      for(const change of input.changes){const instrument=canonical(change.instrument);if(!watched.has(instrument))throw Error('标的不在当前自选中');
        if(Object.keys(change).some(key=>!['instrument','groupId','tags','reason','observeOn','pinned','order'].includes(key)))throw Error('不支持的元数据字段');
        const next={...defaults(),...items[instrument]};
        if(change.groupId!==undefined){if(change.groupId!==null&&!groupIds.has(change.groupId))throw Error('分组不存在');next.groupId=change.groupId;}
        if(change.tags!==undefined){if(!Array.isArray(change.tags)||change.tags.length>12)throw Error('标签最多12个');next.tags=[...new Set(change.tags.map(tag=>text(tag,32)).filter(Boolean))];}
        if(change.reason!==undefined)next.reason=text(change.reason,1000);
        if(change.observeOn!==undefined){const value=change.observeOn;if(value!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('观察日期无效');next.observeOn=value;}
        if(change.pinned!==undefined){if(typeof change.pinned!=='boolean')throw Error('置顶状态无效');next.pinned=change.pinned;}
        if(change.order!==undefined){if(!Number.isInteger(change.order)||change.order<0||change.order>10000)throw Error('排序值无效');next.order=change.order;}
        items[instrument]=next;
      }
      for(const value of Object.values(items))if(value.groupId&&!groupIds.has(value.groupId))value.groupId=null;
      const operationId=randomUUID(),operation={id:operationId,revision:state.revision+1,before:{groups:state.groups,items:state.items},at:new Date().toISOString()};
      this.store.set(KEY,{revision:operation.revision,groups:validatedGroups,items,history:[...state.history,operation].slice(-100)},1);
      return {...this.read(),operationId};
    });
  }
  undo(operationId:string,revision:number){return this.store.transaction(()=>{
    const state=this.store.get<MetadataState>(KEY)||empty(),last=state.history.at(-1);
    if(revision!==state.revision)throw Error('版本已变化，请刷新后重试');
    if(!last||last.id!==operationId||last.revision!==revision)throw Error('存在后续修改，不能撤销该操作');
    this.store.set(KEY,{...last.before,revision:revision+1,history:state.history.slice(0,-1)},1);return this.read();
  });}
}
