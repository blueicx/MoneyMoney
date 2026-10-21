import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import type {ResearchProjectStore,ResearchProject} from './research-projects';
import type {researchRepository} from './research-repository';
import type {MarketId} from './research-contracts';
import {TelegramSignalOutbox} from './telegram-signal-outbox';
import {fitTelegramActionQueue} from './telegram-action-queue';

type Store=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'|'acquireLease'|'refreshLease'|'releaseLease'>;
type Repository=Pick<typeof researchRepository,'getAlertDelivery'|'saveAlertDelivery'|'listAlertDeliveries'>;
interface Subscription {projectId:string;market:MarketId;generation:string;enabled:boolean;hash:string;observedAt:string;pending:string[]}
interface Dependencies {isOwner:(chat:string)=>boolean;suppressed:(chat:string)=>boolean;link:(market:MarketId)=>string|null}
const markets=['stocks','options','crypto','prediction'];
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const esc=(value:unknown,max=160)=>String(value??'未知').slice(0,max).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** Subscription cursors only. Project facts and delivery payloads stay in their existing stores. */
export class TelegramProjectSubscriptions {
 constructor(private state:Store,private projects:ResearchProjectStore,private repository:Repository,private deps:Dependencies,private now=Date.now){}
 private authorize(chat:string){if(!/^[1-9]\d{0,19}$/.test(chat)||!this.deps.isOwner(chat))throw Error('私人研究项目仅限管理员私聊');if(!this.state.health.ok)throw Error('项目订阅存储不可用');}
 private key(chat:string){return 'telegram:research-project-subscriptions:v1:'+chat;}
 private read(chat:string):Subscription[]{const rows=this.state.get<Subscription[]>(this.key(chat))||[];if(!Array.isArray(rows)||rows.length>20||rows.some(r=>!r||!markets.includes(r.market)||typeof r.projectId!=='string'||typeof r.generation!=='string'||typeof r.enabled!=='boolean'||!Array.isArray(r.pending)||r.pending.length>8||!r.pending.every(v=>typeof v==='string'&&v.startsWith('research-project:'))))throw Error('项目订阅状态不可核验');return rows;}
 private snapshot(p:ResearchProject){
  const states=this.projects.referenceStates(p.id).map(r=>({id:r.id,kind:r.kind,linkId:r.linkId,status:r.current?.status||null,progress:r.current?.progress??null,hash:r.current?.revisionHash||r.current?.hash||null,dataStatus:r.dataStatus}));
  return {hash:hash({links:p.links.map(r=>[r.linkId,r.hash]),conclusions:p.conclusions.map(r=>r.id),reviews:p.reviews.map(r=>[r.id,r.status]),states}),states};
 }
 private scoped(projectId:string,market:string){const p=this.projects.read(projectId);if(p.market!==market)throw Error('研究项目市场上下文不匹配');return p;}
 command(chat:string,market:string,args:string[]):string {
  this.authorize(chat);if(!markets.includes(market))throw Error('请先选择具体市场');const action=args[0]||'list';
  if(!['list','show','subscribe','unsubscribe','status'].includes(action))throw Error('项目指令无效：list / show / subscribe / unsubscribe / status');
  if(args.length>(['show','subscribe','unsubscribe'].includes(action)?2:1)||(['show','subscribe','unsubscribe'].includes(action)&&!args[1]))throw Error('项目参数无效，需要明确项目 ID');
  if(action==='list')return fitTelegramActionQueue(['<b>当前市场私人研究项目</b>','使用 /projects show &lt;项目ID&gt; 查看；/projects subscribe &lt;项目ID&gt; 显式订阅。默认不推送。',...this.projects.list(market).slice(0,10).map(p=>`${esc(p.title,64)} · v${p.version} · 结论 ${p.conclusions} · 待复查 ${p.openReviews}\n${p.id}`)],3500).lines.join('\n')+'\n最多显示10项；完整目录请在网页查看。';
  if(action==='status'){const rows=this.read(chat).filter(r=>r.enabled&&r.market===market);return ['<b>私人项目订阅</b>',...rows.map(r=>`${r.projectId}\n最近观察 ${r.observedAt} · 待投递 ${this.pending(r).length}`),rows.length?'使用 /projects unsubscribe &lt;项目ID&gt; 取消；沿用全局暂停、静默和现有投递重试。':'当前市场没有订阅；未启用自动推送。'].join('\n');}
  const p=this.scoped(args[1],market);
  if(action==='show'){const s=this.snapshot(p);return this.message(p,s.states)+'\n研究问题：'+esc(p.question,120)+'\n来源：现有私人项目及明确关联记录；不采集、不调用模型、不创建订单。';}
  return this.state.transaction(()=>{this.authorize(chat);const rows=this.read(chat),existing=rows.find(r=>r.projectId===p.id);if(action==='subscribe'&&existing?.enabled)return '该项目已经订阅，不重置基线或重复发送。';
   if(action==='unsubscribe'){if(existing){existing.enabled=false;for(const id of existing.pending){const item=this.repository.getAlertDelivery(id);if(item&&['queued','failed'].includes(item.status))this.repository.saveAlertDelivery({...item,status:'cancelled',lastError:'管理员取消项目订阅；未继续投递'});}existing.pending=[];}}
   else {if(!existing&&rows.length>=20)throw Error('每个私聊最多保留20项项目订阅；不删除旧记录');const row:Subscription={projectId:p.id,market:p.market,generation:randomUUID(),enabled:true,hash:this.snapshot(p).hash,observedAt:new Date(this.now()).toISOString(),pending:[]};if(existing)Object.assign(existing,row);else rows.push(row);}
   this.state.set(this.key(chat),rows);this.state.appendAudit({id:randomUUID(),chatId:chat,action:'research-project-'+action,detail:JSON.stringify({projectId:p.id,market:p.market}),at:new Date(this.now()).toISOString()});return action==='subscribe'?'已订阅当前项目的后续变化；当前状态作为基线，不补发历史。':'已取消项目订阅；尚未发送的旧通知不再投递。';});
 }
 private pending(row:Subscription){return row.pending.filter(id=>{const item=this.repository.getAlertDelivery(id);if(!item||!['queued','failed'].includes(item.status)||(item.attempts||0)>=7)return false;if(item.expiresAt&&(!Number.isFinite(Date.parse(item.expiresAt))||Date.parse(item.expiresAt)<=this.now())){this.repository.saveAlertDelivery({...item,status:'failed',attempts:7,lastError:'项目通知已过期或时间无效；不投递旧研究变化'});return false;}return true;});}
 private message(p:ResearchProject,states:ReturnType<TelegramProjectSubscriptions['snapshot']>['states']){
  const open=p.reviews.filter(r=>r.status==='open');let link='';try{const url=new URL(this.deps.link(p.market)||'');if(url.protocol==='https:'&&!/^(localhost|127\.|\[::1\])/.test(url.hostname)&&url.href.length<600)link=`\n<a href="${esc(url.href,600)}">打开研究工作区（需管理员登录）</a>`;}catch{}
  const parts=[`<b>研究项目变化 · ${esc(p.title,80)}</b>`,`市场 ${p.market} · v${p.version} · 更新 ${esc(p.updatedAt,32)}`,`结论 ${p.conclusions.length} · 待复查 ${open.length}`,`项目 ${p.id}`,'仅报告已保存状态；不是新研究结论或交易指令。',...states.slice(0,4).map(r=>`${esc(r.kind,20)} ${esc(r.id,64)} · ${esc(r.status||r.dataStatus,24)}${r.progress!==null?' · '+r.progress+'%':''}\n当前Hash ${esc(r.hash||'不可核验',64)}`),...open.slice(-2).map(r=>`复查：${esc(r.reason,100)}\n${esc(r.previousHash,64)} → ${esc(r.currentHash||'不可核验',64)}`),link].filter(Boolean),fit=fitTelegramActionQueue(parts,2850);
  return fit.lines.join('\n')+(fit.omitted?'\n更多状态请在网页查看；未截断证据或HTML标签。':'');
 }
 collect(chat:string):number {
  if(!this.deps.isOwner(chat))return 0;this.authorize(chat);
  return this.state.transaction(()=>{const rows=this.read(chat),before=JSON.stringify(rows);let added=0;for(const row of rows.filter(r=>r.enabled)){
   row.pending=this.pending(row);if(row.pending.length>=8)continue;const p=this.scoped(row.projectId,row.market),s=this.snapshot(p);if(s.hash===row.hash)continue;
   const id='research-project:'+hash({chat,project:p.id,generation:row.generation,version:p.version,hash:s.hash});
   const delivery=this.repository.getAlertDelivery(id);if(!delivery)this.repository.saveAlertDelivery({id,context:{market:p.market,workspace:'research-lab',dataStatus:'historical'},alertId:p.id+':'+row.generation,status:'queued',channel:'telegram',attempts:0,expiresAt:new Date(this.now()+7*86400000).toISOString(),payload:{chatId:chat,message:this.message(p,s.states)+'\n确认已读：/delivery ack '+id}});
   if(!row.pending.includes(id))row.pending.push(id);row.hash=s.hash;row.observedAt=new Date(this.now()).toISOString();if(!delivery)added++;
  }if(JSON.stringify(rows)!==before)this.state.set(this.key(chat),rows);return added;});
 }
 async flush(chat:string,send:(text:string)=>Promise<unknown>){
  if(!this.deps.isOwner(chat))return;this.authorize(chat);
  const outbox=new TelegramSignalOutbox({...this.repository,listAlertDeliveries:()=>this.read(chat).filter(r=>r.enabled).flatMap(r=>r.pending.map(id=>this.repository.getAlertDelivery(id))).filter((r):r is NonNullable<typeof r>=>!!r)},this.state,this.now,'research-project');
  await outbox.flush(chat,()=>this.state.health.ok&&this.deps.isOwner(chat)&&!this.deps.suppressed(chat),send,item=>this.read(chat).some(r=>r.enabled&&r.market===item.context.market&&item.alertId===r.projectId+':'+r.generation&&r.pending.includes(item.id))?item.payload?.message||null:null);
 }
}
export function telegramProjectCommandReply(service:TelegramProjectSubscriptions,chat:string,market:string,args:string[],chatType:string|undefined):string {
 if(chatType!=='private')return '私人研究项目仅限管理员私聊，群组入口关闭。';
 try{return service.command(chat,market,args);}catch(error){return '项目请求未完成：'+esc(error instanceof Error?error.message:'存储或来源状态不可核验',300);}
}
