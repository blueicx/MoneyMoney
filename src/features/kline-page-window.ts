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
