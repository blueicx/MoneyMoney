import type { AlertDelivery } from './research-contracts';

/** A read-only explanation of persisted delivery state, not a reconstruction of unrecorded gates. */
export function diagnoseAlertDelivery(row:AlertDelivery,now=Date.now()) {
  const result=(code:string,reason:string,nextRetryAt:string|null=null)=>({code,reason,nextRetryAt,readOnly:true});
  if(row.status==='acknowledged')return result('acknowledged','收件人已确认；不再自动重发');
  if(row.status==='sent')return result('sent','渠道已记录发送成功；不等于收件人已经阅读');
  if(row.status==='suppressed')return result('suppressed','已记录抑制；旧记录未记录具体去重、冷却或静默条件时不猜测');
  if(!Number.isFinite(now))return result('unknown','当前时间无效，不能判断重试窗口');
  if(row.expiresAt){const expiry=Date.parse(row.expiresAt);if(!Number.isFinite(expiry)||expiry<=now)return result('expired','通知已过期或有效期无效；不发送旧信号');}
  const stockOutbox=row.id.startsWith('stock-signal:')&&row.channel==='telegram';
  if(!stockOutbox)return result(row.status==='failed'?'failed':'unknown','非股票信号队列；仅显示已保存投递状态，未关联专属调度规则');
  const attempts=row.attempts??0;
  if(!Number.isSafeInteger(attempts)||attempts<0)return result('unknown','投递尝试次数无效');
  if(attempts>=7)return result('exhausted','已达到股票信号队列7次尝试上限；等待管理员检查，不自动重复投递');
  if(attempts){
    const last=Date.parse(row.lastAttemptAt||'');
    if(!Number.isFinite(last)||last>now)return result('unknown','最近尝试时间缺失或处于未来，无法核验重试窗口');
    const next=last+Math.min(3600000,60000*2**(attempts-1));
    if(next>now)return result('retry_wait','正在按已记录尝试次数退避；到期后仍需通过当前通知策略',new Date(next).toISOString());
  }
  if(row.lastError==='当前通知策略暂缓投递，未消耗次数')return result('policy_deferred','队列记录为通知策略暂缓，未消耗次数；具体全局/市场/标的静默未保存则不推断');
  return result('queued','等待下一次队列调度；仍需校验白名单、有效期和当前静默策略');
}
