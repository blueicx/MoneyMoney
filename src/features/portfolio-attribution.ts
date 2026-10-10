import type { PortfolioRow } from './decision-intelligence';
import type { UnifiedPaperOrder, UnifiedPaperRunnerAccount } from './unified-paper-trading';
import { assertMarketContext, type MarketId } from './research-contracts';

/** No second ledger. Every figure is derived from selected accounts and explicit records. */
export function portfolioAttribution(market:MarketId,positions:PortfolioRow[],orders:UnifiedPaperOrder[]) {
  const type=({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'} as const)[market],warnings:string[]=[];
  for(const row of positions){if(row.market!==market)throw new Error('组合归因市场不一致');assertMarketContext({market,workspace:'portfolio',instrument:row.instrument});}
  if(orders.some(order=>order.instrumentType!==type))throw new Error('订单归因市场不一致');
  orders.forEach(order=>assertMarketContext({market,workspace:'portfolio',instrument:order.instrumentId}));
  const finite=(value:unknown):value is number=>typeof value==='number' && Number.isFinite(value);
  const byCurrency:Record<string,{positions:number;marketValue:number|null;unrealizedPnl:number|null;cashFlows:number}>= {};
  for(const currency of new Set(positions.map(row=>row.currency || 'UNKNOWN'))) {
    const rows=positions.filter(row=>(row.currency || 'UNKNOWN')===currency),known=currency!=='UNKNOWN';
    const costKnown=known && rows.every(row=>finite(row.averageCost) && finite(row.price) && finite(row.quantity));
    byCurrency[currency]={positions:rows.length,marketValue:known ? rows.reduce((sum,row)=>sum+row.quantity*row.price,0):null,unrealizedPnl:costKnown ? rows.reduce((sum,row)=>sum+(row.price-row.averageCost!)*row.quantity,0):null,cashFlows:0};
    if(!costKnown)warnings.push(currency+'：币种或历史成本缺失，不估算该组盈亏');
  }
  // Cash flows keep their own declared units; they are not assumed to be dividends or performance.
  for(const row of positions)for(const flow of row.cashFlows || []) {
    if(!finite(flow.amount) || !Number.isFinite(Date.parse(flow.at)) || !flow.currency){warnings.push(row.instrument+'：存在无效现金流记录');continue;}
    byCurrency[flow.currency] ||= {positions:0,marketValue:0,unrealizedPnl:0,cashFlows:0};
    byCurrency[flow.currency].cashFlows+=flow.amount;
  }
  const groups=new Map<string,UnifiedPaperOrder[]>();
  orders.forEach(order=>{const key=JSON.stringify([order.accountId || 'manual-paper',order.instrumentId,order.strategy || '未关联',order.strategyVersion || '未关联']);const list=groups.get(key) || [];list.push(order);groups.set(key,list);});
  const strategies=[...groups.values()].map(rows=>{
    const first=rows[0],closed=rows.filter(order=>order.side==='SELL'),feesKnown=rows.every(order=>finite(order.feeUsd)),slippageKnown=rows.every(order=>finite(order.slippageUsd)),realizedKnown=closed.length>0&&closed.every(order=>finite(order.pnlUsd));
    if(!feesKnown || !slippageKnown)warnings.push(first.instrumentId+'：旧订单成本字段缺失，未按零费用补齐');
    if(!closed.length)warnings.push(first.instrumentId+'：尚无明确平仓成交，已实现盈亏未知');
    return {accountId:first.accountId || 'manual-paper',runnerId:first.runnerId || null,instrument:first.instrumentId,strategy:first.strategy || '未关联',strategyVersion:first.strategyVersion || '未关联',currency:'UNKNOWN',orders:rows.length,realizedQuotePnl:realizedKnown ? closed.reduce((sum,row)=>sum+row.pnlUsd!,0):null,
      recordedFeesUsd:feesKnown ? rows.reduce((sum,row)=>sum+Math.abs(row.feeUsd!),0):null,recordedSlippageUsd:slippageKnown ? rows.reduce((sum,row)=>sum+Math.abs(row.slippageUsd!),0):null,unrealizedPnl:null,
      reason:'平仓价差保留原始报价单位；旧订单没有币种契约。未把汇率缺失当1，也未按时间猜测未平仓策略归属。',
      lineage:rows.map(row=>({orderId:row.id || null,signalId:row.signalId || null,experimentId:row.experimentId || null,snapshotId:row.dataSnapshotId || null,timestamp:row.timestamp})),
    };
  });
  const accounts=[...new Set(positions.map(row=>JSON.stringify([row.accountSource || '未关联',row.accountId || '未关联'])))].map(key=>{const [source,id]=JSON.parse(key);return {source,id,positions:positions.filter(row=>(row.accountSource || '未关联')===source && (row.accountId || '未关联')===id).length};});
  return {market,byCurrency,accounts,strategies,totalConvertedValue:null,dataStatus:positions.length || orders.length ? 'partial':'empty',warnings:[...new Set(warnings)],executionEnabled:false,
    reason:'按币种、账户、证券和显式策略关联分列。未记录的汇率、股息或持仓批次不推算；不是完整投资收益或再平衡订单。'};
}

/** Derive attribution from one explicitly linked AI runner account only. */
export function aiRunnerPortfolioAttribution(market: MarketId, runnerId: string, account: UnifiedPaperRunnerAccount | null) {
  const expectedAccountId = `ai-runner:${runnerId}`;
  if (!runnerId.trim()) throw new Error('跑单账户归属标识缺失');
  if (!account) return { ...portfolioAttribution(market, [], []), runnerId, accountId: expectedAccountId, excludedOrderCount: 0 };
  if (account.runnerId !== runnerId || !account.accountId.trim()) throw new Error('AI 跑单账户归属与请求不一致');
  const accountId = account.accountId;
  const expectedType = ({ stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' } as const)[market];
  if (account.positions.some(position => position.instrumentType !== expectedType)) throw new Error('AI 跑单持仓市场与请求不一致');
  const linkedOrders = account.orders.filter(order => order.runnerId === runnerId && order.accountId === accountId);
  const excludedOrderCount = account.orders.length - linkedOrders.length;
  const positions: PortfolioRow[] = account.positions.map(position => ({
    market,
    instrument: position.instrumentId,
    quantity: position.quantity,
    price: position.currentPrice,
    averageCost: position.averageEntryPrice,
    currency: position.currency || 'UNKNOWN',
    accountSource: 'ai-runner',
    accountId,
  }));
  const result = portfolioAttribution(market, positions, linkedOrders);
  const warnings = [...result.warnings];
  if (excludedOrderCount) warnings.push(`${excludedOrderCount} 笔订单未显式关联到该跑单账户，已排除，未按时间猜配`);
  return { ...result, runnerId, accountId, excludedOrderCount, warnings: [...new Set(warnings)] };
}
