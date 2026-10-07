import {createHash} from 'node:crypto';

interface Store {get<T>(key:string):T|null;set<T>(key:string,value:T,version?:number):void;transaction<T>(work:()=>T):T;readonly health?:{ok:boolean};}
interface Reservation {requests:number;issued:string[];}
interface BudgetState {day:string;rounds:Record<string,Reservation>;}
const hash=(id:string)=>createHash('sha256').update(id).digest('hex');

/** Shared ONLY by controlled comparison groups; standalone runner limits are unchanged.
 * Reservations survive crashes and are not refunded on an ambiguous/failed request.
 * A request crossing midnight must obtain a new round reservation before calling a model.
 */
export class ComparisonModelBudget {
  constructor(private readonly store:Store){}
  private assertHealthy(){if(this.store.health?.ok===false)throw new Error('额度存储不可用，禁止调用模型');}
  private key(now:number){if(!Number.isFinite(now))throw new Error('额度时间无效');return 'ai-comparison-model-budget:'+new Date(now).toISOString().slice(0,10);}
  private read(now:number):BudgetState {
    this.assertHealthy();
    const state=this.store.get<BudgetState>(this.key(now))??{day:new Date(now).toISOString().slice(0,10),rounds:{}};
    this.assertHealthy();
    if(!state.rounds||typeof state.rounds!=='object'||Array.isArray(state.rounds)||state.day!==new Date(now).toISOString().slice(0,10)||Object.values(state.rounds).some(r=>!r||!Number.isSafeInteger(r.requests)||r.requests<1||r.requests>24||!Array.isArray(r.issued)||r.issued.length>r.requests))throw new Error('额度记录无法核验，禁止调用模型');
    if(Object.values(state.rounds).reduce((n,r)=>n+r.requests,0)>24)throw new Error('额度记录越界，禁止调用模型');
    return state;
  }
  summary(now=Date.now()){
    const state=this.read(now),rounds=Object.values(state.rounds),reserved=rounds.reduce((n,r)=>n+r.requests,0),issued=rounds.reduce((n,r)=>n+r.issued.length,0);
    return {day:state.day,timeZone:'UTC',limit:24,reserved,issued,remaining:24-reserved,reason:'额度含整轮预留；失败、超时及不确定请求不退还。独立跑单不占此额度。'};
  }
  reserve(roundId:string,requests:number,now=Date.now()):Reservation {
    if(!roundId||roundId.length>512)throw new Error('对照额度需要有效幂等键');
    if(!Number.isSafeInteger(requests)||requests<1||requests>24)throw new Error('本轮模型请求数必须为1–24');
    return this.store.transaction(()=>{
      const state=this.read(now),id=hash(roundId),existing=state.rounds[id];
      if(existing){if(existing.requests!==requests)throw new Error('同一轮次的预留配置不一致');return existing;}
      const allocated=Object.values(state.rounds).reduce((n,r)=>n+r.requests,0);
      if(allocated+requests>24)throw new Error('共享每日模型额度不足，整轮等待；规则账户也不执行');
      const reservation={requests,issued:[]};state.rounds[id]=reservation;this.store.set(this.key(now),state,1);return reservation;
    });
  }
  consume(roundId:string,requestId:string,now=Date.now()):boolean {
    if(!roundId||!requestId||requestId.length>512)return false;
    return this.store.transaction(()=>{
      const state=this.read(now),round=state.rounds[hash(roundId)],request=hash(requestId);
      if(!round||round.issued.includes(request)||round.issued.length>=round.requests)return false;
      round.issued.push(request);this.store.set(this.key(now),state,1);return true;
    });
  }
}
