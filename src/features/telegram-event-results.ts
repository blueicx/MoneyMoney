import { createHash } from 'node:crypto';

export interface EventRecord { id?: string; title: string; titleZh?: string; date: string; country?: string; impact?: string; actual?: string | null; forecast?: string | null; previous?: string | null; source?: string; retrievedAt?: string; kind?:'macro'|'earnings'|'research'|'funding'|'prediction';market?:string;instrument?:string;resourceId?:string;platform?:string;symbol?:string;reportPeriodEnd?:string|null; }
export interface Result { actual: string | null; status: string; reason?: string; source?: string; url?: string; publishedAt?: string; retrievedAt?: string; previous?: string | null; evidenceRefs?:string[]; }
interface Store { get<T>(key: string): T | null; set<T>(key: string, value: T): void; acquireLease?(key: string, owner: string, now: number, ttl: number): boolean; refreshLease?(key: string, owner: string, now: number, ttl: number): boolean; releaseLease?(key: string, owner: string): void; }
interface Delivery { id: string; event: EventRecord; text: string; status: 'pending' | 'sent' | 'failed' | 'acknowledged'; attempts: number; nextAttempt: number; error?: string; actual?: string; publishedAt?: string; retrievedAt?: string; resultSource?: string; resultUrl?: string; kind?: 'result' | 'revision' | 'waiting' | 'terminal'; originalMessageId?: number; messageId?: number; resultStatus?: string; reason?: string; nextCheckAt?: number | null; evidenceRefs?: string[]; controlRevision?: number; }
export interface EventResultDetail { id: string; title: string; eventDate: string; deliveryStatus: Delivery['status']; resultStatus: string; attempts: number; actual: string | null; publishedAt: string | null; retrievedAt: string | null; source: string; resultUrl: string | null; reason: string | null; error: string | null; nextCheckAt: string | null; evidenceRefs: string[]; }
interface State { events: Record<string, EventRecord>; deliveries: Delivery[]; checkedAt?: Record<string,number>; reminders?: Record<string,{messageId:number;at:number}>; }
export function hasEventActual(value: unknown): boolean {
  return value !== null && value !== undefined && !/^(?:|n\/a|na|null|unknown|pending|—|-)$/i.test(String(value).trim());
}
const escape = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const identity = (event: EventRecord) => createHash('sha256').update(JSON.stringify(event.kind&&event.kind!=='macro'?[event.kind,event.market,event.instrument,event.resourceId,event.date]:[event.country, event.title, event.date])).digest('hex');
function safeResultUrl(value?:string):string|null{
  try{const url=new URL(value||'');return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['www.bls.gov','www.bea.gov','www.sec.gov','api.gateio.ws','api.elections.kalshi.com','gamma-api.polymarket.com','polymarket.com','kalshi.com','nfs.faireconomy.media'].includes(url.hostname)?url.toString():null;}catch{return null;}
}
function reportedMacroCalendarActual(event:EventRecord,now:number):Result|null{
  if((event.kind&&event.kind!=='macro')||event.source!=='ForexFactory Public JSON'||!hasEventActual(event.actual))return null;
  const retrievedAtRaw=event.retrievedAt||'';
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(retrievedAtRaw))return null;
  const eventAt=Date.parse(event.date),retrievedAt=Date.parse(retrievedAtRaw);
  if(!Number.isFinite(eventAt)||!Number.isFinite(retrievedAt)||retrievedAt<eventAt||retrievedAt>now)return null;
  return {actual:String(event.actual),status:'published',source:'ForexFactory Public JSON',url:'https://nfs.faireconomy.media/ff_calendar_thisweek.json',retrievedAt:new Date(retrievedAt).toISOString(),previous:event.previous,reason:'第三方公开日历所报实际值；非官方核验结果'};
}

export function formatEventResultDetail(detail: EventResultDetail): string {
  const deliveryStatus: Record<Delivery['status'], string> = { pending: '待发送/重试', sent: '已发送', failed: '发送失败', acknowledged: '已确认' };
  const resultStatus: Record<string, string> = { published: '已发布', revised: '已修订', pending: '等待来源结果', unavailable: '来源不可用', unsupported: '不支持追踪', unverifiable: '无法核验', stopped: '已停止' };
  return [
    '<b>事件结果详情</b>',
    escape(detail.title),
    '事件时间：' + escape(detail.eventDate),
    '投递状态：' + escape(deliveryStatus[detail.deliveryStatus] || detail.deliveryStatus),
    '结果状态：' + escape(resultStatus[detail.resultStatus] || detail.resultStatus),
    '实际值：' + escape(detail.actual || '暂无可核验实际值'),
    ...(detail.publishedAt ? ['结果发布时间：' + escape(detail.publishedAt)] : []),
    ...(detail.retrievedAt ? ['来源抓取时间：' + escape(detail.retrievedAt)] : []),
    '结果来源：' + escape(detail.source || '未知'),
    ...(detail.reason ? ['说明：' + escape(detail.reason)] : []),
    ...(detail.error ? ['最近投递错误：' + escape(detail.error)] : []),
    '投递尝试：' + escape(detail.attempts),
    ...(detail.nextCheckAt ? ['下次检查：' + escape(detail.nextCheckAt)] : []),
    ...(detail.evidenceRefs.length ? ['证据引用：' + escape(detail.evidenceRefs.join('、'))] : []),
  ].join('\n');
}

/** Durable follow-up queue; no result is inferred from a forecast or another release. */
export class TelegramEventResultMonitor {
  private readonly busy = new Set<string>();
  private readonly owner = 'event-results:' + process.pid + ':' + createHash('sha256').update(String(Math.random())).digest('hex');
  constructor(private readonly store: Store, private readonly lookup: (event: EventRecord) => Promise<Result>, private readonly clock = Date.now) {}
  history(chat: string): Delivery[] { return this.store.get<State>('telegram-event-results:' + chat)?.deliveries ?? []; }
  detail(chat: string, id: string): EventResultDetail | null {
    const row = this.history(chat).find(item => item.id === id);
    if (!row) return null;
    return {
      id: row.id,
      title: row.event.titleZh || row.event.title,
      eventDate: row.event.date,
      deliveryStatus: row.status,
      resultStatus: row.resultStatus || (row.status === 'failed' ? 'unavailable' : row.status === 'sent' || row.status === 'acknowledged' ? 'published' : 'pending'),
      attempts: row.attempts,
      actual: row.actual || null,
      publishedAt: row.publishedAt || null,
      retrievedAt: row.retrievedAt || null,
      source: row.resultSource || row.event.source || '未知',
      resultUrl: safeResultUrl(row.resultUrl),
      reason: row.reason || null,
      error: row.error || null,
      nextCheckAt: row.nextCheckAt ? new Date(row.nextCheckAt).toISOString() : null,
      evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs.filter(item => typeof item === 'string').slice(0, 12) : [],
    };
  }
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
    item.controlRevision=(item.controlRevision||0)+1;
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
        const eventAt=Date.parse(event.date);
        if(!Number.isFinite(eventAt)){
          const terminalId=id+':terminal';
          if(!state.deliveries.some(d=>d.id===terminalId))state.deliveries.push({id:terminalId,event,text:'⚠️ <b>事件结果追踪结束：无法核验</b>\n'+escape(event.titleZh||event.title)+'\n事件时间无法验证；不会发布来源结果。',status:'pending',attempts:0,nextAttempt:now,kind:'terminal',resultStatus:'unverifiable',reason:'事件时间无效，无法核验结果先后关系',originalMessageId:state.reminders[id]?.messageId,nextCheckAt:null,evidenceRefs:[]});
          delete state.events[id];delete state.checkedAt[id];continue;
        }
        const age = now - eventAt;
        if (now-Math.max(eventAt,state.reminders[id]?.at??0) > 72 * 3600000) {
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
        try { result = await this.lookup(event); }
        catch { result = { actual: null, status: 'unavailable', reason: '结果来源请求失败，稍后重试' }; }
        if((!event.kind||event.kind==='macro')&&(!['published','revised'].includes(result.status)||!hasEventActual(result.actual))){
          const reported=reportedMacroCalendarActual(event,now);
          if(reported)result=reported;
        }
        state.checkedAt[id]=now;
        const publishedAt=result.publishedAt?Date.parse(result.publishedAt):NaN,retrievedAt=result.retrievedAt?Date.parse(result.retrievedAt):NaN,claimsPublication=['published','revised'].includes(result.status)&&hasEventActual(result.actual),requiresPublicationTime=!!event.kind&&event.kind!=='macro';
        const earningsEventDay=event.kind==='earnings'?Date.parse(`${event.date.slice(0,10)}T00:00:00.000Z`):NaN;
        const resultNotBefore=event.kind==='earnings'&&Number.isFinite(earningsEventDay)?earningsEventDay:eventAt;
        if(claimsPublication){
          const invalidTime=requiresPublicationTime&&!Number.isFinite(publishedAt)?'类型化结果缺少可核验的来源发布时间，暂不发布为实际结果'
            :result.publishedAt&&!Number.isFinite(publishedAt)?'来源发布时间格式无效，暂不发布为实际结果'
            :Number.isFinite(publishedAt)&&publishedAt<resultNotBefore?'来源发布时间早于事件时间，无法确认是本次结果'
            :Number.isFinite(publishedAt)&&publishedAt>now?'来源发布时间晚于当前时间，等待来源校验'
            :result.retrievedAt&&!Number.isFinite(retrievedAt)?'来源抓取时间格式无效，暂不发布为实际结果'
            :Number.isFinite(retrievedAt)&&retrievedAt<resultNotBefore?'来源抓取时间早于事件时间，无法确认该实际值属于本次发布'
            :Number.isFinite(retrievedAt)&&retrievedAt>now?'来源抓取时间晚于当前时间，等待来源校验'
            :null;
          if(invalidTime)result={...result,actual:null,status:'pending',reason:invalidTime};
        }
        const published = ['published','revised'].includes(result.status) && hasEventActual(result.actual) && (!result.publishedAt || Number.isFinite(publishedAt) && publishedAt >= resultNotBefore && publishedAt <= now) && (!result.retrievedAt || Number.isFinite(retrievedAt) && retrievedAt >= resultNotBefore && retrievedAt <= now);
        if (previous && !published) continue;
        const terminal=!!event.kind&&event.kind!=='macro'&&['stopped','unsupported'].includes(result.status);
        if (!published && !terminal && age < 15 * 60000) continue;
        const deliveryId = terminal?id+':terminal':published ? id + ':result:' + createHash('sha256').update(String(result.actual)).digest('hex') : id + ':waiting';
        const url=safeResultUrl(result.url);
        const existing=state.deliveries.find(d=>d.id===deliveryId);if(existing){existing.nextCheckAt=now+(published?3600000:300000);existing.resultSource=result.source||event.source||existing.resultSource;existing.resultUrl=url||existing.resultUrl;if(!published){existing.resultStatus=result.status;existing.reason=result.reason;}continue;}
        const lines = [terminal?'⚠️ <b>结果追踪已停止</b>':published ? previous ? '📊 <b>事件结果已修订</b>' : '📊 <b>事件结果已发布</b>' : '⏳ <b>事件结果暂不可用</b>', escape(event.titleZh || event.title), '事件时间：' + escape(event.date)];
        if (published) lines.push('实际值：' + escape(result.actual),...(!event.kind||event.kind==='macro'?['预期值：' + escape(event.forecast ?? '未提供'),'前值：'+escape(result.previous ?? event.previous ?? '未提供')]:[]),...(event.kind==='earnings'&&event.forecast?['Nasdaq EPS 预期：'+escape(event.forecast)+'（可能与 SEC GAAP 口径不同）']:[]),...(event.kind==='earnings'&&result.reason?['口径说明：'+escape(result.reason)]:[]),...(result.source==='ForexFactory Public JSON'&&result.reason?['口径说明：'+escape(result.reason)]:[]),...(previous ? ['此前通知值：'+escape(previous.actual ?? '旧记录未保存结构化实际值')] : []),...(result.publishedAt ? ['结果时间：'+escape(result.publishedAt)] : []),...(result.retrievedAt ? ['来源抓取时间：'+escape(result.retrievedAt)] : []));
        else lines.push('原因：' + escape(result.reason || '来源尚未提供实际值'), terminal?'追踪已停止；不会通知虚构结果。':'未编造实际值；取得可靠结果后继续通知。');
        lines.push('来源：' + escape(result.source || event.source || '未知'), '这是数据通知，不构成交易指令。');
        if(url)lines.push('<a href="'+escape(url)+'">'+(result.source==='ForexFactory Public JSON'?'来源数据':'官方原文')+'</a>');
        state.deliveries.push({ id: deliveryId, event, text: lines.join('\n'), status: 'pending', attempts: 0, nextAttempt: now,kind:terminal?'terminal':published ? previous ? 'revision':'result':'waiting',originalMessageId:state.reminders[id]?.messageId,resultStatus:published?previous?'revised':'published':result.status,reason:result.reason,resultSource:result.source||event.source,resultUrl:url||undefined,nextCheckAt:terminal?null:now+(published?3600000:300000),evidenceRefs:[...(result.evidenceRefs||[]),...(url?[url]:[])],...(published ? {actual:String(result.actual),publishedAt:result.publishedAt,retrievedAt:result.retrievedAt} : {}) });
        if(terminal){delete state.events[id];delete state.checkedAt[id];}
      }
      state.deliveries = state.deliveries.filter(d => {
        const eventAt=Date.parse(d.event.date),reminderAt=state.reminders?.[d.id.split(':')[0]]?.at??0;
        return Math.max(Number.isFinite(eventAt)?eventAt:0,Number.isFinite(reminderAt)?reminderAt:0)>=now-30*86400000;
      }).slice(-600);
      const persist=()=>{
        if(this.store.refreshLease && !this.store.refreshLease(lease,this.owner,this.clock(),120000))throw new Error('事件结果租约已丢失');
        const acknowledgements=new Set(this.store.get<State>(key)?.deliveries.filter(d=>d.status==='acknowledged').map(d=>d.id));
        state.deliveries.forEach(d=>{if(acknowledgements.has(d.id))d.status='acknowledged';});
        const latest=this.store.get<State>(key);state.reminders={...latest?.reminders,...state.reminders};
        const latestDeliveries=new Map(latest?.deliveries.map(d=>[d.id,d]));
        for(const delivery of state.deliveries){
          const current=latestDeliveries.get(delivery.id);
          if(current&&(current.controlRevision||0)>(delivery.controlRevision||0)){
            delivery.status=current.status;delivery.attempts=current.attempts;delivery.nextAttempt=current.nextAttempt;delivery.error=current.error;delivery.controlRevision=current.controlRevision;
          }
        }
        // A reminder can be registered while the source request is in flight.
        // Fill only explicit event identity links; never guess from dates or titles.
        for(const delivery of state.deliveries){delivery.originalMessageId??=state.reminders[identity(delivery.event)]?.messageId;}
        for(const id of Object.keys(latest?.reminders||{})){if(!knownReminders.has(id)&&latest?.events[id])state.events[id]=latest.events[id];}
        for(const [id,reminder] of Object.entries(state.reminders)){if(reminder.at<now-30*86400000)delete state.reminders[id];}
        this.store.set(key,state);
      };
      persist();
      if (!deliveryEnabled) return;
      for (const delivery of state.deliveries) {
        if (delivery.status !== 'pending' || delivery.nextAttempt > now) continue;
        if(this.store.refreshLease && !this.store.refreshLease(lease,this.owner,this.clock(),120000))throw new Error('事件结果租约已丢失，未投递');
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

function eventEasternParts(eventDate: string): Record<string, string> | null {
  const timestamp = Date.parse(eventDate);
  if (!Number.isFinite(timestamp)) return null;
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestamp).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function beaHtmlText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&ndash;|&#8211;/gi, '–').replace(/&mdash;|&#8212;/gi, '—').replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim();
}

interface BeaGdpReleaseLink { title: string; url: string; }
function findBeaGdpRelease(scheduleHtml: string, event: Pick<EventRecord, 'title' | 'date' | 'country'>): BeaGdpReleaseLink | Result {
  const unavailable = (reason: string, status = 'unavailable'): Result => ({ actual: null, status, source: 'U.S. Bureau of Economic Analysis (BEA)', reason });
  if (event.country !== 'USD' || !/^(?:GDP\s+q\/q(?:\s+(?:advance|second|third|final))?|GDP|Gross Domestic Product)$/i.test(event.title.trim())) return unavailable('仅支持美元 GDP 季度发布事件', 'unsupported');
  const parts = eventEasternParts(event.date);
  if (!parts || parts.hour !== '08' || parts.minute !== '30') return unavailable('事件时间与 BEA 官方 8:30 a.m. 东部时间发布时刻不一致');
  const monthDay = `${parts.month} ${Number(parts.day)}`;
  const year = parts.year;
  const rows = [...scheduleHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(match => {
    const row = match[1];
    const date = row.match(/class=["'][^"']*\brelease-date\b[^"']*["'][^>]*>([^<]+)</i)?.[1]?.trim();
    const time = row.match(/<small\b[^>]*>([^<]+)</i)?.[1]?.trim();
    const titleHtml = row.match(/<td\b[^>]*class=["'][^"']*\brelease-title\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const title = titleHtml ? beaHtmlText(titleHtml) : '';
    if (date !== monthDay || !/^GDP\b/i.test(title)) return [];
    const href = row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    return [{ date, time, title, href }];
  });
  if (!rows.length) return unavailable('BEA 官方发布日程尚无该日期可匹配的 GDP 发布；不以事后历史值代替', 'pending');
  if (rows.length !== 1) return unavailable('BEA 官方日程在该日期有多个 GDP 条目，无法唯一匹配', 'unsupported');
  const row = rows[0];
  if (!/^8:30\s*AM$/i.test(row.time || '')) return unavailable('BEA 官方日程发布时间不是 8:30 a.m.，拒绝按日期猜测', 'unsupported');
  if (!row.href) return unavailable('BEA 官方 GDP 发布页面尚未发布，继续等待', 'pending');
  try {
    const url = new URL(row.href, 'https://www.bea.gov');
    if (url.protocol !== 'https:' || url.hostname !== 'www.bea.gov' || url.username || url.password || url.port || !/^\/news\/\d{4}\/[a-z0-9-]+$/i.test(url.pathname)) return unavailable('BEA 日程中的 GDP 原文链接不符合官方页面格式', 'unsupported');
    return { title: row.title, url: url.toString() };
  } catch { return unavailable('BEA 日程中的 GDP 原文链接无效', 'unsupported'); }
}

/** Parse a single BEA release vintage; no current/revised series is substituted for the event release. */
export function parseBeaGdpResult(scheduleHtml: string, releaseHtml: string, event: Pick<EventRecord, 'title' | 'date' | 'country'>, retrievedAt = new Date().toISOString()): Result {
  const link = findBeaGdpRelease(scheduleHtml, event);
  if ('actual' in link) return link;
  const url = link.url;
  const parts = eventEasternParts(event.date);
  const retrieved = Date.parse(retrievedAt), eventAt = Date.parse(event.date);
  if (!parts || !Number.isFinite(retrieved) || !Number.isFinite(eventAt) || retrieved < eventAt) return { actual: null, status: 'pending', source: 'U.S. Bureau of Economic Analysis (BEA)', url, reason: '事件发布时间或来源抓取时间尚不能核验' };
  const text = beaHtmlText(releaseHtml);
  const embargo = text.match(/EMBARGOED\s+UNTIL\s+RELEASE\s+AT\s+8:30\s*a\.m\.\s+(?:EDT|EST),\s*\w+,\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
  if (!embargo || Date.parse(`${embargo[1]} UTC`) !== Date.UTC(Number(parts.year), new Date(`${parts.month} 1, ${parts.year} UTC`).getUTCMonth(), Number(parts.day))) return { actual: null, status: 'unavailable', source: 'U.S. Bureau of Economic Analysis (BEA)', url, reason: 'BEA 原文的解禁日期与事件日期不一致' };
  const heading = releaseHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = heading ? beaHtmlText(heading) : '';
  const scheduled = text.match(/Real gross domestic product\s*\(GDP\)\s+(increased|decreased)\s+at\s+an\s+annual\s+rate\s+of\s+([\d.]+)\s+percent\s+in\s+the\s+(first|second|third|fourth)\s+quarter\s+of\s+(\d{4})/i);
  const estimate = text.match(/according to the (advance|second|third) estimate released today/i)?.[1]?.toLowerCase();
  const scheduledStage = title.match(/\b(advance|second|third)\s+estimate\b/i)?.[1]?.toLowerCase();
  const releaseStage = title.match(/(1st|first|2nd|second|3rd|third|4th|fourth)\s+quarter\s+(\d{4})/i);
  const quarterNumber = (value: string) => ({ '1st': 'first', first: 'first', '2nd': 'second', second: 'second', '3rd': 'third', third: 'third', '4th': 'fourth', fourth: 'fourth' } as Record<string, string>)[value.toLowerCase()];
  if (!title || !title.includes(link.title) || !scheduled || !estimate || estimate !== scheduledStage || !releaseStage
    || quarterNumber(releaseStage[1]) !== scheduled[3].toLowerCase() || releaseStage[2] !== scheduled[4]) {
    return { actual: null, status: 'unavailable', source: 'U.S. Bureau of Economic Analysis (BEA)', url, reason: 'BEA 原文标题、报告季度或估算阶段与官方日程不一致；未发布实际值' };
  }
  const numericValue = Number(scheduled[2]);
  const value = /decreased/i.test(scheduled[1]) ? (numericValue === 0 ? '0' : `-${scheduled[2]}`) : scheduled[2];
  if (!Number.isFinite(numericValue)) return { actual: null, status: 'unavailable', source: 'U.S. Bureau of Economic Analysis (BEA)', url, reason: 'BEA GDP 数值无法解析' };
  const stage = scheduledStage![0].toUpperCase() + scheduledStage!.slice(1) + ' Estimate';
  return {
    actual: `Real GDP ${value}% annualized (${stage})`, status: 'published', source: 'U.S. Bureau of Economic Analysis (BEA)', url,
    publishedAt: new Date(eventAt).toISOString(), retrievedAt: new Date(retrieved).toISOString(),
    reason: 'BEA 季调 GDP 按年率（SAAR）发布；保留本次发布版本，不以之后修订替代。', evidenceRefs: [url, `BEA ${releaseStage[1]} Quarter ${releaseStage[2]} ${stage}`],
  };
}

const officialCache = new Map<string, { at: number; html: string }>();
export async function lookupOfficialEventResult(event: EventRecord): Promise<Result> {
  const beaGdpEvent = /^(?:GDP\s+q\/q(?:\s+(?:advance|second|third|final))?|GDP|Gross Domestic Product)$/i.test(event.title.trim());
  if (beaGdpEvent && event.country === 'USD') {
    const parts = eventEasternParts(event.date);
    if (!parts) return { actual: null, status: 'unavailable', source: 'U.S. Bureau of Economic Analysis (BEA)', reason: 'GDP 事件日期无效，无法匹配 BEA 发布日程' };
    try {
      const scheduleUrl = `https://www.bea.gov/news/schedule/full?year=${encodeURIComponent(parts.year)}`;
      let schedule = officialCache.get(scheduleUrl);
      if (!schedule || Date.now() - schedule.at > 300000) {
        const response = await fetch(scheduleUrl, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'MoneyMoney research contact via website' } });
        if (!response.ok) return { actual: null, status: 'unavailable', source: 'U.S. Bureau of Economic Analysis (BEA)', reason: `BEA 官方日程不可用（HTTP ${response.status}）`, url: scheduleUrl };
        schedule = { at: Date.now(), html: await response.text() }; officialCache.set(scheduleUrl, schedule);
      }
      const release = findBeaGdpRelease(schedule.html, event);
      if ('actual' in release) return release;
      let page = officialCache.get(release.url);
      if (!page || Date.now() - page.at > 300000) {
        const response = await fetch(release.url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'MoneyMoney research contact via website' } });
        if (!response.ok) return { actual: null, status: 'unavailable', source: 'U.S. Bureau of Economic Analysis (BEA)', reason: `BEA 官方 GDP 原文不可用（HTTP ${response.status}）`, url: release.url };
        page = { at: Date.now(), html: await response.text() }; officialCache.set(release.url, page);
      }
      return parseBeaGdpResult(schedule.html, page.html, event, new Date(Math.max(schedule.at, page.at)).toISOString());
    } catch { return { actual: null, status: 'unavailable', source: 'U.S. Bureau of Economic Analysis (BEA)', reason: 'BEA 官方 GDP 日程或原文请求失败，稍后重试' }; }
  }
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
