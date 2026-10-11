/** Bounded source windows, not a reconstructed exchange calendar or as-of query. */
export function klinePageStatus(sourceStatus:string,paged:boolean) { return paged&&sourceStatus==='live'?'historical':sourceStatus; }
export function klinePageWindow(market:string,interval:string,before:number,limit=200,now=Date.now()) {
  const durations:Record<string,number>={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
  if(!['stocks','crypto'].includes(market)||!durations[interval]||market==='stocks'&&!['1m','5m','15m','1h','1d'].includes(interval))throw Error('当前市场或聚合周期不支持来源历史分页');
  if(!Number.isSafeInteger(before)||before<=1||before>now)throw Error('历史分页游标无效或来自未来');
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('历史分页条数必须为1–1000');
  // Extra stock calendar span only enlarges the request, never invents holiday bars.
  return {before,startTime:Math.max(1,before-durations[interval]*limit*(market==='stocks'?3:1)),endTime:before-1,limit};
}

const STOCK_CHART_INITIAL_LOOKBACK_MS:Record<string,number>={
  '1m':7*86400000-2*60000,
  '5m':30*86400000,
  '15m':60*86400000-2*60000,
  '1h':180*86400000,
  '1d':2*365*86400000,
};

/**
 * Optional, paginatable stock-chart bootstrap window. General history/research,
 * as-of, intraday-date, aggregate-period and adjusted-basis callers stay full-range.
 */
export function stockKlineChartInitialWindow(
  interval:string,
  context:{enabled?:boolean;asOf?:boolean;tradingDate?:boolean;paginated?:boolean;adjustment?:string}={},
  now=Date.now(),
) {
  if(context.enabled!==true||context.asOf||context.tradingDate||context.paginated||context.adjustment!=='source')return undefined;
  const lookback=STOCK_CHART_INITIAL_LOOKBACK_MS[interval];
  if(!lookback)return undefined;
  if(!Number.isSafeInteger(now)||now<=0)throw Error('股票图表首屏窗口时间无效');
  // Minute alignment keeps the 30s chart refreshes on a stable provider-cache key
  // while still including the current session's evolving bars.
  const endTime=Math.floor(now/60000)*60000;
  const startTime=endTime-lookback;
  if(startTime<=0)throw Error('股票图表首屏窗口超出有效时间范围');
  return {startTime,endTime,limit:300};
}
