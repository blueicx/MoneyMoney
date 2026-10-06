import { randomUUID } from 'node:crypto';
import type { SQLiteStateStore } from '../storage/sqlite-state';
type Store = Pick<SQLiteStateStore, 'get' | 'set' | 'acquireLease' | 'refreshLease' | 'releaseLease'>;
interface Config { enabled: boolean; intervalMinutes: number; }
interface Run { at: string; status: string; reason?: string; }

/** Parse provider observation time, never the time at which we fetched the quote. */
export function stockQuoteObservationTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let text = raw.trim();
  const named = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s+(?:AM|PM))\s+ET$/i.exec(text);
  if (named) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[1].toLowerCase()) + 1;
    text = `${month}/${named[2]}/${named[3]} ${named[4]} ET`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(text);
  if (iso) {
    const [, year, month, day, hour, minute, second = '0'] = iso;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month)
      || date.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(AM|PM)(?:\s+ET)?$/i.exec(text);
  if (!local) return null;
  const [, month, day, year, twelveHour, minute, second = '0', meridiem] = local;
  const hour = Number(twelveHour) % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  const wallTime = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second));
  const date = new Date(wallTime);
  if (Number(twelveHour) < 1 || Number(twelveHour) > 12 || Number(minute) > 59 || Number(second) > 59
    || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  const matches = [4, 5].map(offset => wallTime + offset * 3600000).filter(candidate => {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (key: string) => Number(parts.find(row => row.type === key)?.value);
    return value('year') === Number(year) && value('month') === Number(month) && value('day') === Number(day)
      && value('hour') === hour && value('minute') === Number(minute) && value('second') === Number(second);
  });
  // A non-existent or ambiguous DST wall time is not reliable evidence.
  return matches.length === 1 ? matches[0] : null;
}

export function isStockSignalNotificationFresh(row: { updatedAt: string | null; dataStatus?: string }, now=Date.now()): boolean {
  const at=stockQuoteObservationTime(row.updatedAt);
  return ['live','delayed','cached'].includes(row.dataStatus || '') && at!=null && at<=now && now-at<=30*60000;
}

export function stockExchangeSession(venue: 'us' | 'cn' | 'hk', now: number, closedDates: readonly string[] = []) {
  const timezone = venue === 'us' ? 'America/New_York' : venue === 'hk' ? 'Asia/Hong_Kong' : 'Asia/Shanghai';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date(now));
  const value = (key: string) => parts.find(row => row.type === key)?.value || '';
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  const minute = Number(value('hour')) * 60 + Number(value('minute'));
  const windows = venue === 'us' ? [[570, 960]] : venue === 'cn' ? [[570,690],[780,900]] : [[570,720],[780,960]];
  const open = !['Sat','Sun'].includes(value('weekday')) && !closedDates.includes(date) && windows.some(([start,end]) => minute >= start && minute < end);
  return { open, timezone, date, reason: open ? '交易所常规时段；是否有节假日/临时停市仍以来源状态为准' : '周末、已配置停市日或常规交易时段之外' };
}

export class StockSignalSchedule {
  constructor(private readonly store: Store) {}
  get(chat: string): Config { return this.store.get<Config>('telegram:stock-signal-schedule:'+chat) || { enabled:false,intervalMinutes:30 }; }
  configure(chat: string, changes: Partial<Config>): Config {
    const config = { ...this.get(chat), ...changes };
    if (typeof config.enabled !== 'boolean' || !Number.isInteger(config.intervalMinutes) || config.intervalMinutes < 15 || config.intervalMinutes > 240) throw new Error('自动扫描间隔应为15–240分钟');
    this.store.set('telegram:stock-signal-schedule:'+chat,config); return config;
  }
  history(chat: string): Run[] { return this.store.get<Run[]>('telegram:stock-signal-schedule-history:'+chat) || []; }
  async run(chat: string, context: { market: string; paused: boolean; now?: number; closedDates?: string[] }, scan: () => Promise<unknown>): Promise<Run> {
    const now = context.now ?? Date.now(), at = new Date(now).toISOString(), config = this.get(chat);
    if (!config.enabled) return {at,status:'disabled'};
    if (context.market !== 'stocks') return {at,status:'wrong-market'};
    if (context.paused) return {at,status:'paused'};
    if (!stockExchangeSession('us',now,context.closedDates).open) return {at,status:'closed',reason:'自动池以美股常规时段调度；其他交易所可手动扫描'};
    const previous = this.history(chat).at(-1);
    if (previous && now-Date.parse(previous.at)<config.intervalMinutes*60000) return {at,status:'cooldown'};
    const key='telegram:stock-signal-schedule-lease:'+chat, owner=randomUUID();
    if (!this.store.acquireLease(key,owner,now,120000)) return {at,status:'busy'};
    const timer=setInterval(()=>this.store.refreshLease(key,owner,Date.now(),120000),30000);timer.unref();
    try {
      const current = this.get(chat), latest = this.history(chat).at(-1);
      if (!current.enabled) return {at,status:'disabled'};
      if (latest && now-Date.parse(latest.at)<current.intervalMinutes*60000) return {at,status:'cooldown'};
      let record: Run;
      try { await scan(); record={at,status:'completed'}; }
      catch (error) { record={at,status:'failed',reason:error instanceof Error ? error.message:'来源扫描失败'}; }
      if (!this.store.refreshLease(key,owner,Date.now(),120000)) return {at,status:'busy',reason:'扫描租约已丢失，未覆盖调度记录'};
      this.store.set('telegram:stock-signal-schedule-history:'+chat,[...this.history(chat),record].slice(-100));
      return record;
    } finally { clearInterval(timer);this.store.releaseLease(key,owner); }
  }
}
