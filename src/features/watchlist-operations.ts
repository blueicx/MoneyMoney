import type { ActionCenterItem, ActionCenterState } from './action-center';
import { assertMarketContext, type MarketId } from './research-contracts';
type Row=ActionCenterItem&Partial<ActionCenterState>&{snoozed?:boolean;changePct?:number;volumeRatio?:number};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const exactTime=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
export function buildWatchlistOperations(input:Row[],watchlist:{market:MarketId;instrument:string}[],market:MarketId,now=new Date().toISOString()) {
  const at=Date.parse(now);if(!Number.isFinite(at))throw Error('观察时间无效');
  const watched=watchlist.filter(row=>row.market===market).filter(row=>{try{assertMarketContext({...row,workspace:'watchlist'});return true;}catch{return false;}});
  const ids=new Set(watched.map(row=>row.instrument)),unique=new Map<string,Row>();
  for(const row of input){if(row.market!==market||row.instrument&&!ids.has(row.instrument)||!Number.isFinite(Date.parse(row.observedAt))||Date.parse(row.observedAt)>at)continue;
    try{assertMarketContext({market:row.market,instrument:row.instrument,workspace:'action-center'});}catch{continue;}unique.set(row.id,row);}
  const rows=[...unique.values()],scheduled=rows.filter(row=>row.kind==='event'&&exactTime(row.scheduledAt)&&Date.parse(row.scheduledAt!)>=at&&Date.parse(row.scheduledAt!)<=at+7*86400000),
    unknownTime=rows.filter(row=>row.kind==='event'&&!exactTime(row.scheduledAt)&&!exactTime(row.occurredAt)),
    sourceFailures=rows.filter(row=>row.kind==='source'&&['failed','unavailable','partial','unsupported'].includes(row.dataStatus));
  const map=[...new Map(watched.map(row=>[row.instrument,row])).values()].map(ref=>{
    const records=rows.filter(row=>row.instrument===ref.instrument).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
    const price=records.find(row=>row.kind==='price'&&finite(row.changePct)),events=scheduled.filter(row=>row.instrument===ref.instrument).sort((a,b)=>Date.parse(a.scheduledAt!)-Date.parse(b.scheduledAt!));
    const failed=records.some(row=>['failed','unavailable','partial'].includes(row.dataStatus));
    return {...ref,pending:records.filter(row=>!row.read&&!row.snoozed).length,signalChanges:records.filter(row=>row.kind==='signal').length,
      changePct:price?.changePct??null,volumeRatio:records.find(row=>finite(row.volumeRatio))?.volumeRatio??null,nextEventAt:events[0]?.scheduledAt??null,
      dataStatus:failed?'partial':records.length?'cached':'empty',updatedAt:records[0]?.observedAt??null,
      source:[...new Set(records.map(row=>row.source))],evidenceRefs:[...new Set(records.flatMap(row=>row.evidenceRefs))],
      reason:records.length?'按已收集记录汇总；未关联的行情涨跌/成交量不从文字推算':'当前自选暂无已关联记录；不表示该标的没有行情或事件'};
  });
  return {map,calendar:{market,scheduled:scheduled.sort((a,b)=>Date.parse(a.scheduledAt!)-Date.parse(b.scheduledAt!)),unknownTime,sourceFailures,
    reason:'仅列来源明确的未来七天时间；日期不含时区或事件时间未知时单列，不以抓取时间代替截止或结算时间。无来源的市场能力保持不可用。'},updatedAt:now};
}
