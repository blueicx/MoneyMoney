import type { ActionCenterItem } from './action-center';

const escapeHtml=(value:unknown,limit:number)=>String(value??'').slice(0,limit).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const statuses:Record<string,string>={live:'实时',delayed:'延迟',cached:'缓存',partial:'部分成功',empty:'来源成功但无记录',unavailable:'来源不可用',failed:'请求失败',unsupported:'不支持',historical:'历史数据'};
/** Keep complete rendered rows: Telegram's transport must never cut a link/entity in this queue. */
export function fitTelegramActionQueue(lines:string[],budget=3200):{lines:string[];count:number;omitted:number} {
  const kept:string[]=[];let size=0;
  for(const line of lines){const next=line.length+(kept.length?1:0);if(size+next>budget)break;kept.push(line);size+=next;}
  return {lines:kept,count:kept.length,omitted:lines.length-kept.length};
}
/** Formats the same server-owned action row; no separate queue or inferred result. */
export function formatTelegramActionItem(row:ActionCenterItem):string {
  const iso=(value:string|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
  let original='';try{const url=new URL(row.sourceUrl||'');if(url.protocol==='https:'&&url.href.length<=500)original=` · <a href="${escapeHtml(url.href,500)}">原文</a>`;}catch{}
  const scheduled=iso(row.scheduledAt),published=iso(row.publishedAt),observed=iso(row.observedAt);
  return `${escapeHtml(row.title,72)} · ${escapeHtml(statuses[row.dataStatus]||row.dataStatus,18)}\n${escapeHtml(row.source,30)} · 抓取 ${observed||'未知'}${scheduled?'\n计划时间（不代表结果）：'+scheduled:''}${published?'\n发布：'+published:''}${row.reason?'\n原因：'+escapeHtml(row.reason,100):''}${row.evidenceRefs?.length?'\n证据：'+row.evidenceRefs.slice(0,2).map(ref=>escapeHtml(ref,48)).join(' / '):'\n证据：未关联'}${original}`;
}
