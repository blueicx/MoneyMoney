import { WatchlistMetadataStore } from './watchlist-metadata';
import { parseInstrumentQuery } from './unified-instruments';
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function handleWatchlistMetadataCommand(store:WatchlistMetadataStore,context:{isOwner:boolean;scope:string;args:string[]}) {
  if(!context.isOwner)return '仅管理员私聊可访问网页自选分组。';
  const state=store.read(),types:Record<string,string>={stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'};
  const allowed=(id:string)=>parseInstrumentQuery(id)?.type===types[context.scope];
  if(!types[context.scope])return '请先选择股票、期权、虚拟币或预测市场。';
  const [action,target,...ids]=context.args;
  if(!action) return ['<b>自选分组与标签（与网页同步）</b>',...state.groups.map(group=>`${escape(group.id)} · ${escape(group.name)}`),
    ...Object.entries(state.items).filter(([id])=>allowed(id)).sort((a,b)=>Number(b[1].pinned)-Number(a[1].pinned)||a[1].order-b[1].order).slice(0,30).map(([id,item])=>`${escape(id)} · ${escape(state.groups.find(g=>g.id===item.groupId)?.name||'未分组')}\n${escape(item.tags.join(' · '))}${item.reason?' · '+escape(item.reason):''}${item.observeOn?' · 观察 '+escape(item.observeOn):''}`),
    '用法：/groups move 分组ID 标的ID…（none取消分组）；/groups tag 标签 标的ID…','修改仅作用于当前市场，不改变运行中实验。'].join('\n');
  if(!['move','tag'].includes(action)||!target||!ids.length)return '用法：/groups move 分组ID 标的ID… 或 /groups tag 标签 标的ID…';
  if(ids.some(id=>!allowed(id)))return '仅能处理当前市场自选，请先切换市场。';
  try {
    store.apply(state.revision,{changes:[...new Set(ids)].map(instrument=>action==='move'?{instrument,groupId:target==='none'?null:target}:{instrument,tags:[...new Set([...(state.items[instrument]?.tags||[]),target])]})});
    return '已同步网页自选分组与标签；运行中实验保持不变。';
  }catch(error){return escape(error instanceof Error?error.message:'保存失败');}
}
