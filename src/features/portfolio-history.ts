import type { MarketId } from './research-contracts';
import type { CorporateAction } from '../storage/data-lake';

interface HistoryCatalog {
  resolveInstrument?(market: MarketId, query: string): {id: string} | null;
  queryBarsAsOf(input: { market: MarketId; instrument: string; timeframe: string; asOf: string }): Promise<{ rows: Array<Record<string, unknown>>; source: string | null; updatedAt?: string | null; reason?: string; snapshot?: { id: string; contentHash: string } }>;
  listCorporateActions(market: MarketId, instrument: string): CorporateAction[];
}
export interface HistoricalSeries {
  instrument: string; source: string | null; updatedAt: string | null; dataStatus: string; reason: string | null;
  points: Array<{ date: string; close: number | null; value: number | null }>;
  datedReturns: Array<{ date: string; value: number }>; evidenceRefs: string[];
}
export function historyIdentity(market: MarketId, id: string): { symbol: string; supported: boolean } {
  const match = id.match(/^(stock|crypto|option|prediction):([^:]+):(.+)$/i);
  if (!match || ({ stock:'stocks',crypto:'crypto',option:'options',prediction:'prediction' } as Record<string,string>)[match[1].toLowerCase()] !== market) throw new Error('标的与当前市场不一致');
  const symbol = match[3].toUpperCase();
  if (!/^[A-Z0-9._-]{1,80}$/.test(symbol)) throw new Error('标的代码无效');
  return { symbol, supported: market === 'stocks' ? match[2].toLowerCase() === 'us' : market === 'crypto' && match[2].toLowerCase() === 'binance' };
}

/** Reads only already published partitions. Venue fallback and invented historical prices are forbidden. */
export async function assembleHistory(catalog: HistoryCatalog, market: MarketId, instruments: string[], asOf: string, days = 365) {
  if (!['stocks','crypto','options','prediction'].includes(market)) throw new Error('市场无效');
  if (!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf) > Date.now() + 60_000) throw new Error('asOf 时间无效');
  if (!instruments.length || instruments.length > 20 || new Set(instruments).size !== instruments.length) throw new Error('请选择 1–20 个不同标的');
  if (!Number.isInteger(days) || days < 5 || days > 1826) throw new Error('历史范围应为 5–1826 天');
  const refs = instruments.map(instrument => {
    if (instrument.includes(':')) return {instrument,...historyIdentity(market,instrument),identityReason:null};
    try { const resolved=catalog.resolveInstrument?.(market,instrument);return resolved ? {instrument,...historyIdentity(market,resolved.id),identityReason:null} : {instrument,symbol:'',supported:false,identityReason:'旧记录标的身份未核验，未猜测市场或交易场所'}; }
    catch {return {instrument,symbol:'',supported:false,identityReason:'旧记录标的身份有歧义，请选择交易场所'};}
  });
  const series: HistoricalSeries[] = [];
  const dateFormatter = new Intl.DateTimeFormat('en-CA',{ timeZone:market === 'stocks' ? 'America/New_York':'UTC',year:'numeric',month:'2-digit',day:'2-digit' });
  for (const ref of refs) {
    const entry: HistoricalSeries = { instrument:ref.instrument,source:null,updatedAt:null,dataStatus:'unavailable',reason:null,points:[],datedReturns:[],evidenceRefs:[] };
    series.push(entry);
    if (!ref.supported) { entry.dataStatus=ref.identityReason ? 'unavailable':'unsupported';entry.reason=ref.identityReason || '当前交易场所没有可用的同口径日线历史，未回退其他市场或交易所';continue; }
    try {
      const history = await catalog.queryBarsAsOf({ market,instrument:ref.symbol,timeframe:'1d',asOf });
      entry.source=history.source;entry.updatedAt=history.updatedAt || null;
      if (history.snapshot) entry.evidenceRefs=[history.snapshot.id];
      const byDate = new Map<string,{ at:number;close:number | null }>();
      for (const row of history.rows) {
        const at=Date.parse(String(row.timestamp));
        if (!Number.isFinite(at) || at > Date.parse(asOf) || at < Date.parse(asOf)-days*86400_000) continue;
        const close=typeof row.close === 'number' && Number.isFinite(row.close) && row.close > 0 ? row.close : null;
        const date=dateFormatter.format(new Date(at));
        const old=byDate.get(date);
        if (!old || at > old.at) byDate.set(date,{ at,close });
        else if (at === old.at && close !== old.close) byDate.set(date,{at,close:null});
      }
      const points=[...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,point])=>({date,close:point.close,value:null as number|null}));
      const start=points[0]?.date;
      const actions=market === 'stocks' ? catalog.listCorporateActions('stocks',ref.symbol).filter(action=>start && action.effectiveAt.slice(0,10)>=start && Date.parse(action.effectiveAt)<=Date.parse(asOf)) : [];
      if (actions.length) {entry.reason='区间内存在公司行动，分区复权口径尚不能核验，暂停计算收益；可查看原始证据';continue;}
      entry.points=points;
      for (let i=1;i<points.length;i++) if (points[i-1].close != null && points[i].close != null) entry.datedReturns.push({date:points[i].date,value:points[i].close!/points[i-1].close!-1});
      entry.dataStatus=points.length>=2 ? 'historical':'unavailable';
      entry.reason=points.length>=2 ? points.some(point=>point.close==null) ? '存在无效或冲突价格，缺口保留且不计算跨缺口收益':null : history.reason || '不足两根已发布日线，无法计算历史收益';
    } catch(error) {entry.reason=error instanceof Error ? error.message:'历史来源不可用';}
  }
  const usable=series.filter(row=>row.dataStatus==='historical');
  const validDates=usable.map(row=>new Set(row.points.filter(point=>point.close!=null).map(point=>point.date)));
  const shared=usable.length ? usable[0].points.filter(point=>point.close!=null && validDates.every(dates=>dates.has(point.date))).map(point=>point.date) : [];
  const start=shared[0] || null;
  for (const row of usable) {
    const base=row.points.find(point=>point.date===start)?.close;
    if (base) for (const point of row.points) if (point.date>=start! && point.close!=null) point.value=Number(((point.close/base-1)*100).toPrecision(12));
  }
  return {market,series,asOf,commonStart:start,sharedDates:shared,evidenceRefs:series.flatMap(row=>row.evidenceRefs),dataStatus:usable.length===series.length && shared.length>=2 ? 'historical':usable.length ? 'partial':'unavailable',reason:shared.length<2 ? '同日期可比历史不足，未生成完整比较':series.some(row=>row.reason) ? '部分标的有历史缺口或来源限制':null};
}
