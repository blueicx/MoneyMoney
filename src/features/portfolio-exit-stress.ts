interface Position {instrumentId:string;quantity:number;currency?:string}
interface Book {instrument:string;source:string;retrievedAt:number;bids:number[][];asks:number[][];quantityUnit:string}
/** Snapshot-only executable-depth estimate. No extrapolation, FX conversion or order mutation. */
export function estimatePortfolioExit(position:Position,book:Book|null,now=Date.now()){
  const missing=(reason:string)=>({instrument:position.instrumentId,currency:position.currency||'UNKNOWN',dataStatus:'unavailable',proceeds:null as number|null,impactBps:null as number|null,reason,orderChanges:0,source:book?.source||null,retrievedAt:book?.retrievedAt||null});
  if(!book||book.instrument!==position.instrumentId||!book.source||book.quantityUnit!=='base')return missing('缺少同标的、同交易场所及基础资产单位的盘口证据');
  if(!Number.isFinite(position.quantity)||position.quantity<=0||!position.currency||position.currency==='UNKNOWN')return missing('仓位数量或结算币种未知');
  if(!Number.isFinite(book.retrievedAt)||book.retrievedAt>now||now-book.retrievedAt>60000)return missing('盘口快照过期或时间无效');
  const valid=(rows:number[][],direction:number)=>rows.length>0&&rows.every((row,index)=>row.length>=2&&row.slice(0,2).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0)&&(!index||(row[0]-rows[index-1][0])*direction>=0));
  if(!valid(book.bids,-1)||!valid(book.asks,1)||book.bids[0][0]>=book.asks[0][0])return missing('盘口缺失、排序无效或买卖报价交叉');
  let remaining=position.quantity,proceeds=0;
  for(const [price,quantity] of book.bids){const filled=Math.min(quantity,remaining);proceeds+=filled*price;remaining-=filled;if(remaining<=1e-10)break;}
  if(remaining>1e-10)return missing('可见深度不足以退出全部仓位，不外推剩余成交价');
  const reference=book.bids[0][0]*position.quantity;
  return {...missing('仅为当前可见盘口估计；不含未核验费用、未来冲击或成交保证'),dataStatus:'delayed',proceeds,impactBps:(reference-proceeds)/reference*10000};
}
