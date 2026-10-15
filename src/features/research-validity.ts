import { createHash } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
import { assertMarketContext, type MarketId } from './research-contracts';
interface Identity {id:string;market:MarketId;instrument?:string;strategyVersion?:string}
interface Freshness {status:string;reason:string;findings:unknown[]}
interface Entry {at:string;status:string;reasons:string[];evidenceHash:string}
export class ResearchValidityTracker {
  constructor(private store:Pick<SQLiteStateStore,'get'|'set'|'transaction'>){}
  observe(identity:Identity,freshness:Freshness,drift:{status:string;reason:string}[],at=new Date().toISOString()){
    assertMarketContext({...identity,workspace:'research-lab'});if(!Number.isFinite(Date.parse(at)))throw Error('复核观察时间无效');
    const reasons=[...(freshness.status==='stale'?[freshness.reason]:[]),...drift.filter(row=>row.status==='paused').map(row=>row.reason)];
    const status=reasons.length?'needs-review':freshness.status==='unknown'?'unknown':'unchanged';
    const evidenceHash=createHash('sha256').update(JSON.stringify({identity,freshness,drift})).digest('hex'),key='research-validity:'+identity.market+':'+identity.id;
    return this.store.transaction(()=>{const history=this.store.get<Entry[]>(key)||[];
      if(history.at(-1)?.evidenceHash!==evidenceHash){history.push({at,status,reasons:reasons.length?reasons:[freshness.reason],evidenceHash});this.store.set(key,history.slice(-100));}
      return {status,reasons,history:history.slice(-100),strategyChanges:0,orderChanges:0,reason:'仅提示人工复核；没有自动修改策略、提醒或订单。未保存的假设条件保持未知。'};
    });
  }
}
