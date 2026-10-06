import { randomUUID } from 'node:crypto';
import type { AlertDelivery } from './research-contracts';
import type { researchRepository } from './research-repository';
import type { SQLiteStateStore } from '../storage/sqlite-state';

export class TelegramSignalOutbox {
  constructor(private readonly repository:Pick<typeof researchRepository,'getAlertDelivery'|'saveAlertDelivery'|'listAlertDeliveries'>,private readonly store:Pick<SQLiteStateStore,'acquireLease'|'refreshLease'|'releaseLease'>,private readonly clock=Date.now) {}
  enqueue(delivery:AlertDelivery) {
    if(delivery.expiresAt && !Number.isFinite(Date.parse(delivery.expiresAt)))throw new Error('信号通知过期时间无效');
    const existing=this.repository.getAlertDelivery(delivery.id);if(existing)return existing;
    return this.repository.saveAlertDelivery({...delivery,status:'queued',attempts:0});
  }
  async flush(chat:string,allowed:()=>boolean,send:(text:string)=>Promise<unknown>) {
    if(!allowed())return;
    const key='telegram:stock-signal-outbox:'+chat,owner=randomUUID();
    if(!this.store.acquireLease(key,owner,this.clock(),120000))return;
    const timer=setInterval(()=>this.store.refreshLease(key,owner,this.clock(),120000),30000);timer.unref();
    try {
      for(const item of this.repository.listAlertDeliveries(200).filter(row=>row.id.startsWith('stock-signal:') && row.channel==='telegram' && row.payload?.chatId===chat).slice(0,20)) {
        if(!allowed() || !this.store.refreshLease(key,owner,this.clock(),120000))break;
        const current=this.repository.getAlertDelivery(item.id);if(!current || !['queued','failed'].includes(current.status) || (current.attempts || 0)>=7)continue;
        if(current.expiresAt && (!Number.isFinite(Date.parse(current.expiresAt)) || this.clock()>=Date.parse(current.expiresAt))){this.repository.saveAlertDelivery({...current,status:'failed',attempts:7,lastError:'信号通知已过期或时间无效，不发送旧信号；可重新扫描'});continue;}
        const attempts=current.attempts || 0,last=current.lastAttemptAt ? Date.parse(current.lastAttemptAt):0;
        if(attempts && this.clock()-last<Math.min(3600000,60000*2**(attempts-1)))continue;
        const queued={...current,status:'queued',attempts:attempts+1,lastAttemptAt:new Date(this.clock()).toISOString()};
        this.repository.saveAlertDelivery(queued);
        let final:AlertDelivery;
        try{await send(current.payload?.message || '信号内容不可用');final={...queued,status:'sent',deliveredAt:new Date(this.clock()).toISOString(),lastError:undefined};}
        catch{final={...queued,status:'failed',lastError:'Telegram投递失败，将按退避规则重试；最多7次'};}
        if(!this.store.refreshLease(key,owner,this.clock(),120000))break;
        if(this.repository.getAlertDelivery(item.id)?.status!=='acknowledged')this.repository.saveAlertDelivery(final);
      }
    }finally{clearInterval(timer);this.store.releaseLease(key,owner);}
  }
}
