import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import type {MarketId} from './research-contracts';
import {buildProjectRetrospective} from './research-assistance';
import {preserveResearchSummary} from './research-summary';
import {buildProjectReport,renderProjectReport} from './project-retrospective-report';
import {getResearchTemplate} from './research-templates';

const markets=['stocks','options','crypto','prediction'];
const kinds=['evidence','partition','experiment','decision','signal','strategy','account','event','task','study','condition-hit','project-conclusion'];
type Store=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'appendAudit'|'health'>;
export interface ProjectReference {kind:string;id:string;conclusionId?:string}
export interface ProjectReferenceState {market:MarketId;instrument?:string;hash:string;updatedAt:string;expired?:boolean;revisionHash?:string;status?:string;progress?:number;summary?:Record<string,unknown>}
interface ProjectLink extends ProjectReference,ProjectReferenceState {linkId:string;linkedAt:string;readOnly:boolean;inputEligible:boolean}
export interface Conclusion {id:string;text:string;at:string;references:ProjectLink[]}
export interface Review {id:string;conclusionId:string;linkId:string;reason:string;previousHash:string;currentHash:string|null;at:string;status:'open'|'resolved';resolution?:string;resolvedAt?:string}
export interface ResearchProject {
 id:string;market:MarketId;title:string;question:string;hypothesis:string;counterEvidence:string;acceptance:string;
 templateRef?:string;
 version:number;createdAt:string;updatedAt:string;links:ProjectLink[];conclusions:Conclusion[];reviews:Review[];
 timeline:Array<{id:string;at:string;action:string;referenceId?:string}>;
}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function text(value:unknown,label:string,max=4000){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label}不能为空或超过${max}字`);return value.trim();}
function market(value:string):MarketId {if(!markets.includes(value))throw Error('研究项目市场无效');return value as MarketId;}
function id(value:string){if(typeof value!=='string'||!/^project_[a-f0-9-]{36}$/.test(value))throw Error('项目身份无效');return value;}

/** Project metadata and explicit lineage only; referenced business content stays in its existing store. */
export class ResearchProjectStore {
 constructor(private store:Store,private resolve:(ref:ProjectReference)=>ProjectReferenceState|null,private now=Date.now){}
 private clock(){return new Date(this.now()).toISOString();}
 private index(m:MarketId){const rows=this.store.get<string[]>('research-project-index:v1:'+market(m))||[];if(!this.store.health.ok||!Array.isArray(rows)||rows.some(r=>typeof r!=='string'))throw Error('项目索引不可核验');return rows;}
 read(projectId:string):ResearchProject {
  const p=this.store.get<ResearchProject>('research-project:'+id(projectId));
  if(!this.store.health.ok||!p)throw Error('研究项目不存在或存储不可用');
  if(p.id!==projectId||!markets.includes(p.market)||!Number.isSafeInteger(p.version)||!Array.isArray(p.links)||!Array.isArray(p.conclusions)||!Array.isArray(p.reviews)||!Array.isArray(p.timeline))throw Error('研究项目历史格式不可核验');
  return structuredClone(p);
 }
 list(m:string,query='') {
  market(m);if(typeof query!=='string'||query.length>200)throw Error('项目搜索条件无效');
  const q=query.trim().toLowerCase();
  return this.index(m as MarketId).map(row=>this.read(row)).filter(p=>!q||[p.title,p.question,p.hypothesis,p.id,...p.links.map(r=>r.id)].join(' ').toLowerCase().includes(q)).reverse().map(p=>({id:p.id,market:p.market,title:p.title,question:p.question,version:p.version,updatedAt:p.updatedAt,conclusions:p.conclusions.length,openReviews:p.reviews.filter(r=>r.status==='open').length}));
 }
 create(input:{market:string;title:string;question:string;hypothesis:string;counterEvidence:string;acceptance:string;templateRef?:string}) {
  if(!input||Object.keys(input).some(k=>!['market','title','question','hypothesis','counterEvidence','acceptance','templateRef'].includes(k)))throw Error('项目不接受额外业务配置');
  const m=market(input.market),at=this.clock();
  let templateRef:string|undefined;
  if(input.templateRef!==undefined){
   if(typeof input.templateRef!=='string'||input.templateRef.length>120)throw Error('研究模板引用无效');
   const template=getResearchTemplate(input.templateRef);
   if(!template||template.market!==m)throw Error('研究模板不存在、市场不一致或版本不受支持');
   templateRef=`${template.id}@${template.version}`;
  }
  const p:ResearchProject={id:'project_'+randomUUID(),market:m,title:text(input.title,'标题',160),question:text(input.question,'研究问题'),hypothesis:text(input.hypothesis,'假设'),counterEvidence:text(input.counterEvidence,'反证'),acceptance:text(input.acceptance,'验收条件'),...(templateRef?{templateRef}:{}),version:1,createdAt:at,updatedAt:at,links:[],conclusions:[],reviews:[],timeline:[{id:randomUUID(),at,action:'created'}]};
  return this.store.transaction(()=>{const ids=this.index(m);if(ids.length>=100)throw Error('本市场研究项目已达100个，未删除旧项目');this.store.set('research-project:'+p.id,p);this.store.set('research-project-index:v1:'+m,[...ids,p.id]);this.audit(p,'created');return p;});
 }
 private audit(p:ResearchProject,action:string){this.store.appendAudit({id:randomUUID(),action:'research-project-'+action,detail:JSON.stringify({projectId:p.id,market:p.market,version:p.version}),at:p.updatedAt});}
 private change(projectId:string,version:number,action:string,work:(p:ResearchProject)=>void) {
  return this.store.transaction(()=>{const p=this.read(projectId);if(p.version!==version)throw Error('项目版本已变化，请刷新重试');if(p.timeline.length>=1000)throw Error('项目时间线已达上限，未删除历史');work(p);p.version++;p.updatedAt=this.clock();p.timeline.push({id:randomUUID(),at:p.updatedAt,action});this.store.set('research-project:'+p.id,p);this.audit(p,action);return structuredClone(p);});
 }
 private reference(ref:ProjectReference):ProjectReferenceState {
  if(!ref||!kinds.includes(ref.kind)||typeof ref.id!=='string'||!ref.id.trim()||ref.id.length>200||Object.keys(ref).some(k=>!['kind','id','conclusionId'].includes(k)))throw Error('研究引用无效');
  let state:ProjectReferenceState|null;
  if(ref.kind==='project-conclusion') {
   const project=this.read(ref.id),conclusion=project.conclusions.find(c=>c.id===ref.conclusionId);
   if(!conclusion)throw Error('跨项目只能引用明确的只读结论，不能引用整个项目作为输入');
   state={market:project.market,hash:digest(conclusion),updatedAt:conclusion.at};
  }else state=this.resolve(ref);
  if(!state||!markets.includes(state.market)||!/^[a-f0-9]{64}$/.test(state.hash)||!Number.isFinite(Date.parse(state.updatedAt))||Date.parse(state.updatedAt)>this.now()+1000)throw Error('引用不存在、Hash或来源时间不可核验');
  if(state.revisionHash!==undefined&&!/^[a-f0-9]{64}$/.test(state.revisionHash))throw Error('修订Hash不可核验');
  if(state.status!==undefined&&(typeof state.status!=='string'||state.status.length>60)||state.progress!==undefined&&(!Number.isFinite(state.progress)||state.progress<0||state.progress>100))throw Error('引用状态或任务进度不可核验');
  return {market:state.market,...(preserveResearchSummary(state.summary)?{summary:preserveResearchSummary(state.summary)!}:{}),...(state.instrument?{instrument:state.instrument}:{}),hash:state.hash,updatedAt:state.updatedAt,...(state.expired?{expired:true}:{}),...(state.revisionHash?{revisionHash:state.revisionHash}:{}),...(state.status!==undefined?{status:state.status}:{}),...(state.progress!==undefined?{progress:state.progress}:{})};
 }
 private pinnedReference(link:ProjectLink){
  const current=this.reference({kind:link.kind,id:link.id,...(link.conclusionId?{conclusionId:link.conclusionId}:{})});
  if(current.market!==link.market||current.instrument!==link.instrument)throw Error('固定引用的市场或标的身份发生变化，当前不可核验');return current;
 }
 referenceStates(projectId:string){
  return this.read(projectId).links.map(link=>{try{const current=this.pinnedReference(link);return {linkId:link.linkId,kind:link.kind,id:link.id,pinnedHash:link.hash,current,changed:(current.revisionHash||current.hash)!==link.hash,dataStatus:current.expired?'unavailable':'historical',reason:current.expired?'已保存的来源状态过期；未更新原引用':'只读当前记录；进度变化不启动、暂停或修改任务'};}catch{return {linkId:link.linkId,kind:link.kind,id:link.id,pinnedHash:link.hash,current:null,changed:null,dataStatus:'unavailable',reason:'明确引用当前不可核验，未猜测配对或改写原引用'};}});
 }
 retrospective(projectId:string,linkIds:string[]){
  const project=this.read(projectId),states=this.referenceStates(projectId).map(row=>{
   const link=project.links.find(link=>link.linkId===row.linkId)!;
   if(!row.current||!linkIds.includes(row.linkId)||link.kind==='project-conclusion')return row;
   try{const current=this.resolve({kind:link.kind,id:link.id});return {...row,current:{...row.current,...(current?.hash===row.current.hash&&current.market===project.market&&current.summary?{summary:current.summary}:{})}};}catch{return row;}
  });
  return buildProjectRetrospective(project,states,linkIds);
 }
 report(projectId:string,linkIds:string[]){const p=this.read(projectId);return buildProjectReport(p,this.retrospective(projectId,linkIds));}
 exportReport(projectId:string,linkIds:string[],format:'json'|'html'){const report=this.report(projectId,linkIds);return format==='html'?renderProjectReport(report):JSON.stringify(report,null,2);}
 link(projectId:string,version:number,ref:ProjectReference) {
  return this.change(projectId,version,'linked',p=>{const state=this.reference(ref);if(ref.kind!=='project-conclusion'&&state.market!==p.market)throw Error('研究输入不得跨市场引用');if(ref.id===p.id)throw Error('项目不得引用自身结论');if(p.links.some(r=>r.kind===ref.kind&&r.id===ref.id&&r.conclusionId===ref.conclusionId&&r.hash===state.hash))throw Error('研究引用此版本已关联，不重复建立');if(p.links.length>=200)throw Error('项目引用已达上限');p.links.push({...ref,...state,linkId:randomUUID(),linkedAt:this.clock(),readOnly:true,inputEligible:ref.kind!=='project-conclusion'});});
 }
 conclude(projectId:string,version:number,input:{text:string;linkIds:string[]}) {
  return this.change(projectId,version,'conclusion-added',p=>{const value=text(input?.text,'阶段结论');if(!Array.isArray(input.linkIds)||!input.linkIds.length||input.linkIds.length>50||new Set(input.linkIds).size!==input.linkIds.length)throw Error('结论必须选择1–50个明确引用');const refs=input.linkIds.map(key=>{const ref=p.links.find(r=>r.linkId===key);if(!ref)throw Error('结论引用未关联到本项目');const current=this.pinnedReference(ref);if(current.hash!==ref.hash||current.expired||current.revisionHash&&current.revisionHash!==ref.hash)throw Error('引用已修订或过期，请先复查并明确关联新的证据版本');return ref;});if(p.conclusions.length>=100)throw Error('阶段结论已达上限，未覆盖旧结论');p.conclusions.push({id:'conclusion_'+randomUUID(),text:value,at:this.clock(),references:structuredClone(refs)});});
 }
 private pendingReviews(p:ResearchProject,coalesceOpen=false){
  const pending:Review[]=[],seen=new Set(p.reviews.map(r=>r.id)),resolved=new Map<string,ProjectReferenceState|null>();
  for(const c of p.conclusions)for(const r of c.references){let current:ProjectReferenceState|null=null;
   if(resolved.has(r.linkId))current=resolved.get(r.linkId)!;else{try{current=this.pinnedReference(r);}catch{/* Keep pinned history; an unavailable record is a review reason. */}resolved.set(r.linkId,current);}
   const currentHash=current?.revisionHash||current?.hash||null;
   const reason=!current?'引用缺失或来源状态不可用':current.expired?'来源证据已过期':currentHash!==r.hash?'引用存在内容变化或明确的后续目录修订，原结论未覆盖':null;if(!reason)continue;
   if(coalesceOpen&&p.reviews.some(review=>review.status==='open'&&review.conclusionId===c.id&&review.linkId===r.linkId&&review.reason===reason))continue;
   const reviewId='review_'+digest({conclusion:c.id,link:r.linkId,hash:currentHash,reason});if(seen.has(reviewId))continue;if(p.reviews.length+pending.length>=300)throw Error('项目复查任务已达上限');seen.add(reviewId);pending.push({id:reviewId,conclusionId:c.id,linkId:r.linkId,reason,previousHash:r.hash,currentHash,at:this.clock(),status:'open'});
  }
  return pending;
 }
 refresh(projectId:string,version:number) {
  return this.change(projectId,version,'references-reviewed',p=>{p.reviews.push(...this.pendingReviews(p));});
 }
 refreshAffected(projectId:string){
  return this.store.transaction(()=>{const current=this.read(projectId),pending=this.pendingReviews(current,true);if(!pending.length)return {project:current,added:0};const project=this.change(projectId,current.version,'local-revision-review',p=>{p.reviews.push(...pending);});return {project,added:pending.length};});
 }
 resolveReview(projectId:string,version:number,reviewId:string,note:string) {
  const resolution=text(note,'人工复查说明',2000);return this.change(projectId,version,'review-resolved',p=>{const row=p.reviews.find(r=>r.id===reviewId);if(!row||row.status!=='open')throw Error('复查任务不存在或已处理');row.status='resolved';row.resolution=resolution;row.resolvedAt=this.clock();});
 }
 export(projectId:string,format:'json'|'markdown') {
  const p=this.read(projectId);if(format==='json')return JSON.stringify(p,null,2);if(format!=='markdown')throw Error('不支持的导出格式');
  const safe=(v:string)=>v.replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;');
  return [`# ${safe(p.title)}`,`市场：${p.market} · 项目 ${p.id} · 版本 ${p.version}`,`## 研究问题\n${safe(p.question)}`,`## 假设\n${safe(p.hypothesis)}`,`## 反证\n${safe(p.counterEvidence)}`,`## 验收条件\n${safe(p.acceptance)}`,'## 阶段结论（只追加）',...p.conclusions.map(c=>`${safe(c.text)}\n\n记录时间：${c.at}\n\n${c.references.map(r=>`- ${r.kind} ${r.id} · ${r.market} · Hash ${r.hash}`).join('\n')}`),'## 复查记录',...p.reviews.map(r=>`- ${r.status}: ${r.reason} · ${r.previousHash} → ${r.currentHash||'未知'}${r.resolution?' · '+safe(r.resolution):''}`),'本报告为研究记录，不创建订单，不改变策略或模拟持仓。'].join('\n\n');
 }
}
