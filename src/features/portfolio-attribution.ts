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

export interface AiRunnerSelectionAttributionRunner {
  id: string;
  budgetUsd: number;
  positions?: readonly {
    id: string;
    status: 'OPEN' | 'CLOSED';
    instrumentId?: string;
    entryOrderId?: string;
    exitOrderId?: string;
    entryPrice: number;
    exitPrice?: number;
    quantity: number;
    entryTime: string;
    exitTime?: string;
    pnlUsd?: number;
    contractMultiplier?: number;
    entryFeeUsd?: number;
    entrySlippageUsd?: number;
    exitFeeUsd?: number;
    exitSlippageUsd?: number;
  }[];
  universe?: {
    kind: 'single' | 'watchlist';
    market: MarketId;
    hash: string;
    instruments: readonly { venue: string; symbolOrMarketId: string }[];
  };
  benchmarks?: Record<string, {
    market: MarketId;
    instrument: string;
    startPrice: number;
    currentPrice: number;
    allocationUsd: number;
    observedAt: string;
    updatedAt: string;
    source?: string;
  }>;
}

/**
 * A deliberately small, auditable decomposition for multi-stock runners.
 * "Selection" is the frozen universe's equal-weight buy-and-hold result;
 * "configuration" is realized, cost-adjusted account PnL less that baseline.
 * It is not Brinson attribution and is withheld unless every closed position is
 * linked to exact ledger fills and the benchmark interval ends at the closes.
 */
export function aiRunnerSelectionAttribution(
  market: MarketId,
  runner: AiRunnerSelectionAttributionRunner,
  account: UnifiedPaperRunnerAccount | null,
  maxQuoteSkewMs = 120_000,
) {
  const unavailable = (status: 'unsupported' | 'unavailable', reason: string) => ({
    status, reason, netPnlUsd: null, selectionPnlUsd: null, configurationPnlUsd: null,
    universeHash: runner.universe?.hash || null, baselineAt: null, asOf: null,
    sources: [] as string[], method: '非标准 Brinson：已平仓净盈亏 + 冻结自选等权持有基准',
  });
  if (market !== 'stocks') return unavailable('unsupported', '当前只对美股多标的跑单提供等权基准分解；其他市场不套用股票口径');
  const universe = runner.universe;
  if (!universe || universe.market !== 'stocks' || universe.kind !== 'watchlist' || universe.instruments.length < 2) {
    return unavailable('unsupported', '该跑单不是至少包含两个标的的冻结美股自选组');
  }
  if (!universe.hash || !runner.id.trim() || !Number.isFinite(runner.budgetUsd) || runner.budgetUsd <= 0) {
    return unavailable('unavailable', '冻结标的哈希或账户预算缺失，不能建立可复现归因');
  }
  const symbols = universe.instruments.map(item => String(item.symbolOrMarketId || '').trim().toUpperCase());
  if (universe.instruments.some(item => item.venue !== 'Stocks') || symbols.some(symbol => !symbol) || new Set(symbols).size !== symbols.length) {
    return unavailable('unavailable', '冻结自选存在无效或重复股票身份');
  }
  if (!account || account.runnerId !== runner.id || account.accountId !== `ai-runner:${runner.id}`) {
    return unavailable('unavailable', '独立模拟账户缺失或归属与跑单不一致');
  }
  if (!Number.isFinite(account.startingCash) || !Number.isFinite(account.cash) || Math.abs(account.startingCash - runner.budgetUsd) > 0.01) {
    return unavailable('unavailable', '账户初始资金与冻结跑单预算不一致');
  }
  if (!Array.isArray(account.positions) || !Array.isArray(account.orders)) {
    return unavailable('unavailable', '模拟账户持仓或成交账本字段不完整');
  }
  if (!Array.isArray(runner.positions) || runner.positions.length === 0) {
    return unavailable('unavailable', '跑单没有可核验的已平仓仓位记录');
  }
  if (runner.positions.some(position => position.status !== 'CLOSED') || account.positions.length > 0) {
    return unavailable('unavailable', '跑单仍有未平仓持仓；为避免浮盈混入，只统计全部平仓后的已实现归因');
  }
  if (runner.positions.some(position => !position.entryOrderId || !position.exitOrderId)) {
    return unavailable('unavailable', '旧仓位缺少入场或退出订单 ID，不能按时间猜测配对');
  }
  const benchmarks = runner.benchmarks || {};
  const rows = symbols.map(symbol => benchmarks[symbol]);
  if (rows.some(row => !row)) return unavailable('unavailable', '冻结自选尚未全部取得有效基准报价');
  const validRows = rows as NonNullable<(typeof rows)[number]>[];
  const nowMs = Date.now();
  if (Object.keys(benchmarks).length !== symbols.length || validRows.some((row, index) =>
    row.market !== 'stocks' || typeof row.instrument !== 'string' || row.instrument.toUpperCase() !== symbols[index]
      || !Number.isFinite(row.startPrice) || row.startPrice <= 0 || !Number.isFinite(row.currentPrice) || row.currentPrice <= 0
      || !Number.isFinite(row.allocationUsd) || !Number.isFinite(Date.parse(row.observedAt)) || !Number.isFinite(Date.parse(row.updatedAt))
      || Date.parse(row.observedAt) > Date.parse(row.updatedAt)
      || Date.parse(row.observedAt) > nowMs || Date.parse(row.updatedAt) > nowMs)) {
    return unavailable('unavailable', '基准报价身份、价格或时间字段不完整，或报价时间来自未来');
  }
  const baselineTimes = validRows.map(row => Date.parse(row.observedAt));
  const updateTimes = validRows.map(row => Date.parse(row.updatedAt));
  const baselineAtMs = Math.max(...baselineTimes);
  const asOfMs = Math.max(...updateTimes);
  if (Math.max(...baselineTimes) - Math.min(...baselineTimes) > maxQuoteSkewMs
    || Math.max(...updateTimes) - Math.min(...updateTimes) > maxQuoteSkewMs) {
    return unavailable('unavailable', '冻结自选基准报价时间不一致，超过两分钟，不能进行同区间比较');
  }
  if (validRows.some(row => Math.abs(row.allocationUsd - account.startingCash / symbols.length) > 0.01)) {
    return unavailable('unavailable', '等权基准配置与跑单初始资金不一致');
  }
  const allowedIds = new Set(symbols.map(symbol => `stock:us:${symbol}`));
  const ordersById = new Map<string, UnifiedPaperOrder>();
  for (const order of account.orders) {
    if (!order.id || ordersById.has(order.id) || order.runnerId !== runner.id || order.accountId !== account.accountId
      || order.instrumentType !== 'stock' || !allowedIds.has(order.instrumentId)
      || !['BUY', 'SELL'].includes(order.side)
      || !Number.isFinite(order.price) || order.price <= 0 || !Number.isFinite(order.quantity) || order.quantity <= 0
      || (order.contractMultiplier != null && order.contractMultiplier !== 1)
      || !Number.isFinite(Date.parse(order.timestamp)) || Date.parse(order.timestamp) < baselineAtMs || Date.parse(order.timestamp) > nowMs
      || !Number.isFinite(order.feeUsd) || !Number.isFinite(order.slippageUsd)) {
      return unavailable('unavailable', '成交身份、价格、时间、费用或滑点不完整，不能进行已实现归因');
    }
    ordersById.set(order.id, order);
  }
  if (account.orders.length !== runner.positions.length * 2) {
    return unavailable('unavailable', '账本成交数量与已平仓仓位记录不一致');
  }
  let realizedNet = 0;
  let latestCloseMs = 0;
  const consumedOrderIds = new Set<string>();
  for (const position of runner.positions) {
    const instrumentId = String(position.instrumentId || '');
    const entry = ordersById.get(position.entryOrderId!);
    const exit = ordersById.get(position.exitOrderId!);
    const entryAt = Date.parse(position.entryTime);
    const exitAt = Date.parse(String(position.exitTime || ''));
    if (!allowedIds.has(instrumentId) || !entry || !exit || consumedOrderIds.has(entry.id!) || consumedOrderIds.has(exit.id!)
      || entry.side !== 'BUY' || exit.side !== 'SELL' || entry.instrumentId !== instrumentId || exit.instrumentId !== instrumentId
      || !Number.isFinite(position.entryPrice) || !Number.isFinite(position.exitPrice) || !Number.isFinite(position.quantity) || position.quantity <= 0
      || (position.contractMultiplier != null && position.contractMultiplier !== 1)
      || typeof position.pnlUsd !== 'number' || !Number.isFinite(position.pnlUsd) || !Number.isFinite(entryAt) || !Number.isFinite(exitAt) || exitAt < entryAt
      || entry.timestamp !== position.entryTime || exit.timestamp !== position.exitTime
      || entry.price !== position.entryPrice || exit.price !== position.exitPrice || entry.quantity !== position.quantity || exit.quantity !== position.quantity
      || typeof exit.pnlUsd !== 'number' || !Number.isFinite(exit.pnlUsd) || Math.abs(exit.pnlUsd - position.pnlUsd) > 0.01
      || Math.abs(position.pnlUsd - (position.exitPrice! - position.entryPrice) * position.quantity) > 0.01
      || Math.abs(Number(entry.feeUsd) - Number(position.entryFeeUsd)) > 0.01 || Math.abs(Number(entry.slippageUsd) - Number(position.entrySlippageUsd)) > 0.01
      || Math.abs(Number(exit.feeUsd) - Number(position.exitFeeUsd)) > 0.01 || Math.abs(Number(exit.slippageUsd) - Number(position.exitSlippageUsd)) > 0.01
      || entryAt < baselineAtMs || exitAt > nowMs) {
      return unavailable('unavailable', '仓位与入场/退出成交血缘、价格或成本不一致；不会按时间推测');
    }
    consumedOrderIds.add(entry.id!);
    consumedOrderIds.add(exit.id!);
    latestCloseMs = Math.max(latestCloseMs, exitAt);
    const costs = Math.abs(entry.feeUsd!) + Math.abs(entry.slippageUsd!) + Math.abs(exit.feeUsd!) + Math.abs(exit.slippageUsd!);
    realizedNet += position.pnlUsd - costs;
  }
  if (consumedOrderIds.size !== ordersById.size) return unavailable('unavailable', '存在未关联到已平仓仓位的账本成交');
  if (latestCloseMs - asOfMs > maxQuoteSkewMs) {
    return unavailable('unavailable', '等权基准报价早于最后平仓超过两分钟，无法覆盖已实现账户区间');
  }
  if (!Number.isFinite(realizedNet) || Math.abs((account.cash - account.startingCash) - realizedNet) > 0.01) {
    return unavailable('unavailable', '已平仓成交净盈亏与模拟账户现金变动不一致');
  }
  const selectionRaw = validRows.reduce((sum, row) => sum + (account.startingCash / symbols.length) * (row.currentPrice / row.startPrice - 1), 0);
  const netCents = Math.round(realizedNet * 100);
  const selectionCents = Math.round(selectionRaw * 100);
  const configurationCents = netCents - selectionCents;
  const cents = (value: number) => value / 100;
  return {
    status: 'available' as const,
    reason: '仅统计全部平仓且具备精确订单血缘的成交；已扣除入场与退出费用/滑点，未计入任何未实现盈亏。',
    method: '非标准 Brinson：已平仓净盈亏=真实出场毛盈亏−入场/出场费用与滑点；选股基准=冻结自选等权持有（不计交易摩擦）；配置差额=已平仓净盈亏−基准。',
    universeHash: universe.hash,
    baselineAt: new Date(baselineAtMs).toISOString(),
    asOf: new Date(asOfMs).toISOString(),
    quoteSkewMs: Math.max(...updateTimes) - Math.min(...updateTimes),
    instrumentCount: symbols.length,
    closedPositionCount: runner.positions.length,
    netPnlUsd: cents(netCents),
    selectionPnlUsd: cents(selectionCents),
    configurationPnlUsd: cents(configurationCents),
    sources: [...new Set(validRows.map(row => String(row.source || '').trim()).filter(Boolean))].sort(),
    benchmark: validRows.map(row => ({ instrument: row.instrument, startPrice: row.startPrice, currentPrice: row.currentPrice, observedAt: row.observedAt, updatedAt: row.updatedAt, source: row.source || null })),
  };
}
