import {randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import type {ResearchProjectStore} from './research-projects';

type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'acquireLease'|'releaseLease'|'getLease'>;
type Projects=Pick<ResearchProjectStore,'list'|'refreshAffected'>;
interface Schedule {afterId:string|null;nextAt:number;updatedAt:string;lastResult:{checked:number;added:number;failed:number}}
const key='research-project-local-review',interval=300000;

/** Derived local reviews only: no provider, model, notification or execution dependencies. */
export class ResearchProjectReviewWorker {
 private readonly owner=randomUUID();
 private timer:ReturnType<typeof setInterval>|null=null;
 constructor(private state:State,private projects:Projects,private now=Date.now,private onError:(error:unknown)=>void=()=>{}){}
 private schedule(){
  const saved=this.state.get<Schedule>(key+':schedule');
  if(saved&&(!Number.isFinite(saved.nextAt)||saved.afterId!==null&&typeof saved.afterId!=='string'))throw Error('本地复查检查点不可核验');
  return saved;
 }
 status(){return {source:'已保存的明确引用；仅本地复查',intervalMs:interval,batchLimit:5,...this.schedule()};}
 private assertLease(){const lease=this.state.getLease(key,this.now());if(!lease||lease.owner!==this.owner||lease.expired)throw Error('本地复查租约已失效，未提交本轮变化');}
 runOnce(limit=5){
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('单轮本地复查限制为1–5个项目');
  if(!this.state.acquireLease(key,this.owner,this.now(),30000))return {status:'busy',checked:0,added:0,failed:0};
  try{
   const saved=this.schedule();if(saved&&saved.nextAt>this.now())return {status:'waiting',checked:0,added:0,failed:0};
   const ids:string[]=[];let failedScopes=0;
   for(const market of ['stocks','options','crypto','prediction']){try{ids.push(...this.projects.list(market).map(p=>p.id));}catch{failedScopes++;}}
   ids.sort();
   const after=saved?.afterId||'',rotated=[...ids.filter(id=>id>after),...ids.filter(id=>id<=after)].slice(0,limit);
   const result={status:'checked',checked:0,added:0,failed:failedScopes};let cursor=saved?.afterId||null;
   for(const id of rotated){
    try{const added=this.state.transaction(()=>{this.assertLease();const value=this.projects.refreshAffected(id);this.assertLease();return value.added;});result.added+=added;}
    catch{this.assertLease();result.failed++;}
    result.checked++;cursor=id;
   }
   this.state.transaction(()=>{this.assertLease();this.state.set(key+':schedule',{afterId:cursor,nextAt:this.now()+interval,updatedAt:new Date(this.now()).toISOString(),lastResult:{checked:result.checked,added:result.added,failed:result.failed}} satisfies Schedule);});
   return result;
  }finally{this.state.releaseLease(key,this.owner);}
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>{try{this.runOnce();}catch(error){this.onError(error);}},interval);this.timer.unref?.();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}
