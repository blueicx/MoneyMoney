import { createHash } from 'node:crypto';

interface EventRecord { id?: string; title: string; titleZh?: string; date: string; country?: string; impact?: string; actual?: string | null; forecast?: string | null; previous?: string | null; source?: string; }
interface Result { actual: string | null; status: string; reason?: string; source?: string; url?: string; publishedAt?: string; previous?: string | null; }
interface Store { get<T>(key: string): T | null; set<T>(key: string, value: T): void; acquireLease?(key: string, owner: string, now: number, ttl: number): boolean; refreshLease?(key: string, owner: string, now: number, ttl: number): boolean; releaseLease?(key: string, owner: string): void; }
interface Delivery { id: string; event: EventRecord; text: string; status: 'pending' | 'sent' | 'failed' | 'acknowledged'; attempts: number; nextAttempt: number; error?: string; actual?: string; publishedAt?: string; kind?: 'result' | 'revision' | 'waiting' | 'terminal'; originalMessageId?: number; messageId?: number; resultStatus?: string; reason?: string; nextCheckAt?: number | null; evidenceRefs?: string[]; }
interface State { events: Record<string, EventRecord>; deliveries: Delivery[]; checkedAt?: Record<string,number>; reminders?: Record<string,{messageId:number;at:number}>; }
export function hasEventActual(value: unknown): boolean {
  return value !== null && value !== undefined && !/^(?:|n\/a|na|null|unknown|pending|—|-)$/i.test(String(value).trim());
}
const escape = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const identity = (event: EventRecord) => createHash('sha256').update(JSON.stringify([event.country, event.title, event.date])).digest('hex');

/** Durable follow-up queue; no result is inferred from a forecast or another release. */
export class TelegramEventResultMonitor {
  private readonly busy = new Set<string>();
  private readonly owner = 'event-results:' + process.pid + ':' + createHash('sha256').update(String(Math.random())).digest('hex');
  constructor(private readonly store: Store, private readonly lookup: (event: EventRecord) => Promise<Result>, private readonly clock = Date.now) {}
  history(chat: string): Delivery[] { return this.store.get<State>('telegram-event-results:' + chat)?.deliveries ?? []; }
  registerReminder(chat: string,event: EventRecord,messageId: number): void {
    if(!Number.isSafeInteger(messageId)||messageId<=0||!Number.isFinite(Date.parse(event.date)))return;
    const key='telegram-event-results:'+chat,state=this.store.get<State>(key)??{events:{},deliveries:[]},id=identity(event);
    state.reminders||={};state.reminders[id]||={messageId,at:this.clock()};state.events[id]=event;this.store.set(key,state);
  }
  update(chat: string, id: string, action: 'ack' | 'retry'): boolean {
    const key='telegram-event-results:'+chat, state=this.store.get<State>(key); if(!state) return false;
    const item=state.deliveries.find(row=>row.id===id); if(!item) return false;
    if(action==='ack') { if(item.status==='pending') return false; item.status='acknowledged'; }
    else { if(item.status!=='failed' && item.status!=='pending') return false; item.status='pending'; item.nextAttempt=this.clock(); item.attempts=0; delete item.error; }
    this.store.set(key,state); return true;
  }
  async run(chat: string, events: EventRecord[], send: (text: string,originalMessageId?:number) => Promise<unknown>, deliveryEnabled = true): Promise<void> {
    if (this.busy.has(chat)) return;
    const lease = 'telegram-event-results-monitor:' + chat;
    if (this.store.acquireLease && !this.store.acquireLease(lease, this.owner, this.clock(), 120000)) return;
    this.busy.add(chat);
    const timer=setInterval(()=>this.store.refreshLease?.(lease,this.owner,this.clock(),120000),30000);timer.unref();
    try {
      const key = 'telegram-event-results:' + chat, now = this.clock();
      const state = this.store.get<State>(key) ?? { events: {}, deliveries: [] };
      state.checkedAt ||= {};
      state.reminders ||= {};
      const knownReminders=new Set(Object.keys(state.reminders));
      for (const event of events) {
        const date = Date.parse(event.date);
        if (event.impact === 'high' && Number.isFinite(date) && (date >= now - 6 * 3600000 || state.events[identity(event)])) state.events[identity(event)] = event;
      }
      for (const [id, event] of Object.entries(state.events)) {
        const age = now - Date.parse(event.date);
        if (age > 72 * 3600000) {
          const resolved=state.deliveries.some(d=>d.id.startsWith(id+':result:'));
          if(!resolved&&!state.deliveries.some(d=>d.id===id+':terminal'))state.deliveries.push({id:id+':terminal',event,text:'⚠️ <b>事件结果追踪结束：无法核验</b>\n'+escape(event.titleZh||event.title)+'\n事件时间：'+escape(event.date)+'\n72小时内未取得可靠实际结果；不以预期值、前值或概率替代。',status:'pending',attempts:0,nextAttempt:now,kind:'terminal',resultStatus:'unverifiable',reason:'追踪窗口结束，未取得可靠结果',originalMessageId:state.reminders[id]?.messageId,nextCheckAt:null,evidenceRefs:[]});
          delete state.events[id];delete state.checkedAt[id];continue;
        }
        if (age < 0) continue;
        const previous = state.deliveries.filter(d => d.id.startsWith(id + ':result:')).at(-1);
        // Confirmed releases are rechecked hourly, not on every monitor tick.
        if (previous && now-(state.checkedAt[id] ?? 0)<3600000) continue;
        if (!previous && state.checkedAt[id] && now-state.checkedAt[id]<300000) continue;
        let result: Result;
        try { result = !previous && hasEventActual(event.actual) ? { actual: event.actual!, status: 'published', source: event.source, previous:event.previous } : await this.lookup(event); }
        catch { result = { actual: null, status: 'unavailable', reason: '结果来源请求失败，稍后重试' }; }
        state.checkedAt[id]=now;
        const published = ['published','revised'].includes(result.status) && hasEventActual(result.actual) && (!result.publishedAt || Number.isFinite(Date.parse(result.publishedAt)) && Date.parse(result.publishedAt) >= Date.parse(event.date) && Date.parse(result.publishedAt) <= now);
        if (previous && !published) continue;
        if (!published && age < 15 * 60000) continue;
        const deliveryId = published ? id + ':result:' + createHash('sha256').update(String(result.actual)).digest('hex') : id + ':waiting';
        const existing=state.deliveries.find(d=>d.id===deliveryId);if(existing){existing.nextCheckAt=now+(published?3600000:300000);if(!published){existing.resultStatus=result.status;existing.reason=result.reason;}continue;}
        const lines = [published ? previous ? '📊 <b>事件结果已修订</b>' : '📊 <b>事件结果已发布</b>' : '⏳ <b>事件结果暂不可用</b>', escape(event.titleZh || event.title), '事件时间：' + escape(event.date)];
        if (published) lines.push('实际值：' + escape(result.actual), '预期值：' + escape(event.forecast ?? '未提供'),'前值：'+escape(result.previous ?? event.previous ?? '未提供'),...(previous ? ['此前通知值：'+escape(previous.actual ?? '旧记录未保存结构化实际值')] : []),...(result.publishedAt ? ['结果时间：'+escape(result.publishedAt)] : []));
        else lines.push('原因：' + escape(result.reason || '来源尚未提供实际值'), '未编造实际值；取得可靠结果后继续通知。');
        lines.push('来源：' + escape(result.source || event.source || '未知'), '这是数据通知，不构成交易指令。');
        if (result.url?.startsWith('https://www.bls.gov/')) lines.push('<a href="' + escape(result.url) + '">官方原文</a>');
        state.deliveries.push({ id: deliveryId, event, text: lines.join('\n'), status: 'pending', attempts: 0, nextAttempt: now,kind:published ? previous ? 'revision':'result':'waiting',originalMessageId:state.reminders[id]?.messageId,resultStatus:published?previous?'revised':'published':result.status,reason:result.reason,nextCheckAt:now+(published?3600000:300000),evidenceRefs:result.url?.startsWith('https://www.bls.gov/')?[result.url]:[],...(published ? {actual:String(result.actual),publishedAt:result.publishedAt} : {}) });
      }
      state.deliveries = state.deliveries.filter(d => Date.parse(d.event.date) >= now - 30 * 86400000).slice(-600);
      const persist=()=>{
        if(this.store.refreshLease && !this.store.refreshLease(lease,this.owner,this.clock(),120000))throw new Error('事件结果租约已丢失');
        const acknowledgements=new Set(this.store.get<State>(key)?.deliveries.filter(d=>d.status==='acknowledged').map(d=>d.id));
        state.deliveries.forEach(d=>{if(acknowledgements.has(d.id))d.status='acknowledged';});
        const latest=this.store.get<State>(key);state.reminders={...latest?.reminders,...state.reminders};
        for(const id of Object.keys(latest?.reminders||{})){if(!knownReminders.has(id)&&latest?.events[id])state.events[id]=latest.events[id];}
        for(const [id,reminder] of Object.entries(state.reminders)){if(reminder.at<now-30*86400000)delete state.reminders[id];}
        this.store.set(key,state);
      };
      persist();
      if (!deliveryEnabled) return;
      for (const delivery of state.deliveries) {
        if (delivery.status !== 'pending' || delivery.nextAttempt > now) continue;
        delivery.attempts++;
        try { const messageId=await send(delivery.text,delivery.originalMessageId);if(typeof messageId==='number'&&Number.isSafeInteger(messageId)&&messageId>0)delivery.messageId=messageId;delivery.status = 'sent'; delete delivery.error; }
        catch { delivery.error = 'Telegram 投递失败'; delivery.nextAttempt = now + Math.min(3600000, 60000 * 2 ** (delivery.attempts - 1)); if (delivery.attempts >= 7) delivery.status = 'failed'; }
        persist();
      }
    } finally { clearInterval(timer);this.busy.delete(chat); this.store.releaseLease?.(lease, this.owner); }
  }
}

export function parseBlsResult(html: string, event: Pick<EventRecord, 'title' | 'date' | 'country'>): Result {
  const unavailable: Result = { actual: null, status: 'unavailable', source: 'BLS', reason: '官方发布日期或指标未匹配，不能使用上一期结果' };
  if (event.country !== 'USD') return unavailable;
  const text = (html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const date = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!date || new Date(date[1] + ' UTC').toISOString().slice(0, 10) !== event.date.slice(0, 10)) return unavailable;
  let match: RegExpMatchArray | null = null;
  if (/^(Non-Farm Employment Change|Nonfarm Payrolls)$/i.test(event.title)) {
    match = text.match(/Total nonfarm payroll employment (increased|decreased)(?: by)? ([\d,]+)/i);
    if (match) return { actual: (match[1].toLowerCase() === 'decreased' ? '-' : '') + match[2].replace(/,/g, ''), status: 'published', source: 'BLS', publishedAt: event.date };
  } else if (/^Unemployment Rate$/i.test(event.title)) {
    match = text.match(/unemployment rate[^.]{0,100}? at ([\d.]+) percent/i);
    if (match) return { actual: match[1] + '%', status: 'published', source: 'BLS', publishedAt: event.date };
  } else if (/^(Core )?CPI (m\/m|y\/y)$/i.test(event.title)) {
    const core = /^Core /i.test(event.title), annual = /y\/y$/i.test(event.title);
    const patterns = core
      ? annual ? [/all items less food and energy index (rose|increased|decreased|fell) ([\d.]+) percent over the (?:year|last 12 months)/i] : [/index for all items less food and energy (rose|increased|decreased|fell) ([\d.]+) percent/i]
      : annual ? [/Over the last 12 months, the all items index (rose|increased|decreased|fell) ([\d.]+) percent/i] : [/Consumer Price Index for All Urban Consumers \(CPI-U\) (rose|increased|decreased|fell) ([\d.]+) percent on a seasonally adjusted basis/i];
    for (const pattern of patterns) {
      match = text.match(pattern);
      if (match) return { actual: (/decreased|fell/i.test(match[1]) ? '-' : '') + match[2] + '%', status: 'published', source: 'BLS', publishedAt: event.date };
    }
  }
  return unavailable;
}

const officialCache = new Map<string, { at: number; html: string }>();
export async function lookupOfficialEventResult(event: EventRecord): Promise<Result> {
  if (event.country !== 'USD' || !/^(Non-Farm Employment Change|Nonfarm Payrolls|Unemployment Rate|(Core )?CPI (m\/m|y\/y))$/i.test(event.title)) {
    return { actual: null, status: 'unsupported', reason: '当前日历只提供倒计时和预期；该指标尚无已核验的结果来源' };
  }
  const url = /^((Core )?CPI)/i.test(event.title) ? 'https://www.bls.gov/news.release/cpi.nr0.htm' : 'https://www.bls.gov/news.release/empsit.nr0.htm';
  try {
    let cached = officialCache.get(url);
    if (!cached || Date.now() - cached.at > 300000) {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'MoneyMoney research contact via website' } });
      if (!response.ok) return { actual: null, status: 'unavailable', source: 'BLS', reason: '官方结果来源不可用（HTTP ' + response.status + '）', url };
      cached = { at: Date.now(), html: await response.text() }; officialCache.set(url, cached);
    }
    return { ...parseBlsResult(cached.html, event), url };
  } catch { return { actual: null, status: 'unavailable', source: 'BLS', reason: '官方结果来源请求失败，稍后重试', url }; }
}
