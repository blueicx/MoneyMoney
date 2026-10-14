import { MARKET_SCOPES, type MarketScope } from './market-scope';

export type WorkspaceId =
  | 'overview'
  | 'stock-quotes'
  | 'crypto-quotes'
  | 'events'
  | 'radar'
  | 'analysis'
  | 'backtest'
  | 'screener'
  | 'watchlist'
  | 'positions'
  | 'paper'
  | 'orders'
  | 'risk'
  | 'decision-intelligence'
  | 'research-lab'
  | 'action-center'
  | 'breadth'
  | 'insider'
  | 'institutional'
  | 'guru-holdings'
  | 'analyst'
  | 'fundamentals'
  | 'short-interest'
  | 'option-chain'
  | 'volatility'
  | 'greeks'
  | 'funding-rate'
  | 'open-interest'
  | 'on-chain'
  | 'order-flow'
  | 'contracts'
  | 'prediction-radar';

export interface WorkspaceItem {
  id: WorkspaceId;
  label: string;
  icon: string;
  scopes: readonly MarketScope[];
  requiresInstrument?: boolean;
  requiresAdmin?: boolean;
  availability?: 'live' | 'degraded' | 'unavailable';
  contract?: WorkspaceAssetContract;
}
export interface WorkspaceAssetContract { market:MarketScope; workspace:WorkspaceId; contentOwner:WorkspaceId; requiresAdmin:boolean; requiresInstrument:boolean; modules:string[]; readEndpoints:string[] }

export interface WorkspaceGroup {
  id: 'market' | 'research' | 'intelligence' | 'portfolio' | 'market-specific';
  label: string;
  items: WorkspaceItem[];
}

const ALL_SCOPES = MARKET_SCOPES;
const ASSET_SCOPES: readonly MarketScope[] = ['stocks', 'options', 'crypto', 'prediction'];

const ITEMS: Record<WorkspaceId, WorkspaceItem> = {
  overview: { id: 'overview', label: '市场总览', icon: '⌂', scopes: ALL_SCOPES },
  'stock-quotes': { id: 'stock-quotes', label: '行情与选股', icon: '▥', scopes: ['stocks'] },
  'crypto-quotes': { id: 'crypto-quotes', label: '行情与K线', icon: '₿', scopes: ['crypto'], requiresInstrument: true },
  events: { id: 'events', label: '市场事件与新闻', icon: '▤', scopes: ASSET_SCOPES },
  radar: { id: 'radar', label: '市场雷达', icon: '◉', scopes: ASSET_SCOPES },
  analysis: { id: 'analysis', label: '标的分析', icon: '⌁', scopes: ASSET_SCOPES, requiresInstrument: true },
  backtest: { id: 'backtest', label: '策略回测', icon: '⌘', scopes: ASSET_SCOPES, requiresInstrument: true },
  screener: { id: 'screener', label: '筛选与比较', icon: '⌕', scopes: ASSET_SCOPES },
  watchlist: { id: 'watchlist', label: '我的自选', icon: '★', scopes: ALL_SCOPES, requiresAdmin:true },
  positions: { id: 'positions', label: '我的持仓', icon: '▣', scopes: ALL_SCOPES, requiresAdmin:true },
  paper: { id: 'paper', label: '模拟盘与 AI 跑单', icon: '▧', scopes: ALL_SCOPES, requiresAdmin:true },
  orders: { id: 'orders', label: '模拟订单', icon: '≡', scopes: ALL_SCOPES, requiresAdmin:true },
  risk: { id: 'risk', label: '风险监控', icon: '♡', scopes: ASSET_SCOPES, requiresInstrument: true },
  'decision-intelligence': { id: 'decision-intelligence', label: '可信决策', icon: '◇', scopes: ASSET_SCOPES },
  'research-lab': { id: 'research-lab', label: '研究实验室', icon: '▧', scopes: ASSET_SCOPES, requiresAdmin:true },
  'action-center': { id: 'action-center', label: '自选行动', icon: '✓', scopes: ALL_SCOPES, requiresAdmin:true },
  breadth: { id: 'breadth', label: '市场宽度', icon: '▥', scopes: ['stocks'] },
  insider: { id: 'insider', label: '内部人交易', icon: '♟', scopes: ['stocks'], requiresInstrument: true },
  institutional: { id: 'institutional', label: '机构持仓', icon: '♜', scopes: ['stocks'], requiresInstrument: true },
  'guru-holdings': { id: 'guru-holdings', label: '大神持仓', icon: '◈', scopes: ['stocks'] },
  analyst: { id: 'analyst', label: '分析师共识', icon: '◎', scopes: ['stocks'], requiresInstrument: true },
  fundamentals: { id: 'fundamentals', label: '基本面质量', icon: '▥', scopes: ['stocks'], requiresInstrument: true },
  'short-interest': { id: 'short-interest', label: '空头利息', icon: '♟', scopes: ['stocks'], requiresInstrument: true },
  'option-chain': { id: 'option-chain', label: '期权链', icon: '◌', scopes: ['options'], requiresInstrument: true },
  volatility: { id: 'volatility', label: '隐含波动率', icon: '∿', scopes: ['options'], requiresInstrument: true },
  greeks: { id: 'greeks', label: 'Greeks', icon: 'Δ', scopes: ['options'], requiresInstrument: true },
  'funding-rate': { id: 'funding-rate', label: '资金费率', icon: '⇄', scopes: ['crypto'], requiresInstrument: true },
  'open-interest': { id: 'open-interest', label: '未平仓量', icon: '◫', scopes: ['crypto'], requiresInstrument: true },
  'on-chain': { id: 'on-chain', label: '链上数据', icon: '⌁', scopes: ['crypto'], requiresInstrument: true },
  'order-flow': { id: 'order-flow', label: '主动资金流', icon: 'ϟ', scopes: ['crypto'], requiresInstrument: true },
  contracts: {id:'contracts',label:'永续与交割合约',icon:'⇋',scopes:['crypto'],requiresInstrument:true},
  'prediction-radar': { id: 'prediction-radar', label: '预测雷达', icon: '◎', scopes: ['prediction'] },
};

const BASE_GROUPS: readonly { id: WorkspaceGroup['id']; label: string; items: readonly WorkspaceId[] }[] = [
  { id: 'market', label: '市场', items: ['overview', 'radar', 'analysis'] },
  { id: 'research', label: '研究', items: ['screener', 'backtest', 'risk'] },
  { id: 'intelligence', label: '决策', items: ['decision-intelligence', 'research-lab', 'action-center'] },
  { id: 'portfolio', label: '私人模拟账户', items: ['paper','orders'] },
];

const SPECIFIC_ITEMS: Record<MarketScope, readonly WorkspaceId[]> = {
  overview: [],
  stocks: ['stock-quotes', 'events', 'breadth', 'insider', 'institutional', 'guru-holdings', 'analyst', 'fundamentals', 'short-interest'],
  options: ['events', 'option-chain', 'volatility', 'greeks'],
  crypto: ['crypto-quotes', 'events', 'contracts', 'funding-rate', 'open-interest', 'on-chain', 'order-flow'],
  prediction: ['events', 'prediction-radar'],
  watchlist: [],
};

function item(id: WorkspaceId, scope:MarketScope,contracts:Record<string,WorkspaceAssetContract>): WorkspaceItem {
  return { ...ITEMS[id], scopes: [...ITEMS[id].scopes], contract:contracts[`${scope}:${id}`] };
}

function group(id: WorkspaceGroup['id'], label: string, ids: readonly WorkspaceId[],scope:MarketScope,contracts:Record<string,WorkspaceAssetContract>): WorkspaceGroup {
  return { id, label, items: ids.map(id=>item(id,scope,contracts)) };
}

export function resolveWorkspaceNavigation(scope: MarketScope): WorkspaceGroup[] {
  const specific = SPECIFIC_ITEMS[scope] || [];
  const contracts=workspaceAssetContracts();
  const groups = BASE_GROUPS.map(base => group(base.id, base.label, base.items,scope,contracts));
  if (specific.length > 0) {
    groups.push(group('market-specific', '市场专属', specific,scope,contracts));
  }
  return groups;
}

export function isWorkspaceAllowed(scope: MarketScope, workspace: WorkspaceId): boolean {
  if (workspace === 'watchlist' || workspace === 'positions') return true;
  return resolveWorkspaceNavigation(scope).some(groupItem => groupItem.items.some(itemValue => itemValue.id === workspace));
}

export function defaultWorkspace(scope: MarketScope): WorkspaceId {
  if (scope === 'watchlist') return 'watchlist';
  if (scope === 'stocks') return 'stock-quotes';
  if (scope === 'crypto') return 'crypto-quotes';
  return 'overview';
}

export function workspaceAssetContracts(): Record<string, WorkspaceAssetContract> {
  const result: ReturnType<typeof workspaceAssetContracts> = {};
  const loads: Partial<Record<WorkspaceId,string[]>> = {
    overview:['overview'], 'stock-quotes':['charts'], 'crypto-quotes':['charts','crypto'],
    'guru-holdings':['guru','tables'], contracts:['charts','contracts','tables'], events:['events'],
    breadth:['stocks','tables'], insider:['stocks','tables'], institutional:['stocks','tables'], analyst:['stocks','tables'], fundamentals:['stocks','tables'], 'short-interest':['stocks','tables'],
    'option-chain':['options','tables'], volatility:['options','tables'], greeks:['options','tables'],
    'funding-rate':['crypto','tables'], 'open-interest':['crypto','tables'], 'on-chain':['crypto','tables'], 'order-flow':['crypto','tables'], 'prediction-radar':['prediction'],
    'research-lab':['research','tables'], 'action-center':['research','tables'], 'decision-intelligence':['research','tables'], screener:['research','tables'], backtest:['research','tables'], risk:['research','tables'],
    watchlist:['portfolio','tables'], positions:['portfolio','tables'], paper:['portfolio','ai','tables'], orders:['portfolio','tables'], analysis:['trading'],
  };
  const endpoints:Record<WorkspaceId,string[]>={
    overview:['/api/workspace/dashboard'], 'stock-quotes':['/api/stock/kline'], 'crypto-quotes':['/api/binance/klines'], events:['/api/events/entities'], radar:['/api/workspace/dashboard'], analysis:['/api/instruments/:type/:venue/:symbol/overview'], backtest:['/api/research/experiments'], screener:['/api/screener'],watchlist:['/api/workspace/watchlist'],positions:['/api/paper/positions'],paper:['/api/paper/ledger'],orders:['/api/orders'],risk:['/api/risk/overview'],
    'decision-intelligence':['/api/evidence','/api/decisions'], 'research-lab':['/api/research/experiments'], 'action-center':['/api/watchlist/action-center'],breadth:['/api/stock/market-breadth'],insider:['/api/stock/insider/:symbol'],institutional:['/api/stock/institutional/:symbol'],'guru-holdings':['/api/stocks/guru-holdings'],analyst:['/api/stock/analyst/:symbol'],fundamentals:['/api/stock/fundamentals/:symbol'],'short-interest':['/api/stock/short-interest/:symbol'],
    'option-chain':['/api/equity-options/:symbol','/api/options/:asset'],volatility:['/api/options/history'],greeks:['/api/equity-options/:symbol'], 'funding-rate':['/api/funding-rates'],'open-interest':['/api/perpetual-crowding'],'on-chain':['/api/bitcoin-onchain'],'order-flow':['/api/order-flow-liquidity'],contracts:['/api/contracts/detail','/api/contracts/history'],'prediction-radar':['/api/prediction-radar'],
  };
  for(const market of MARKET_SCOPES)for(const definition of Object.values(ITEMS)) {
    if(!definition.scopes.includes(market))continue;
    result[`${market}:${definition.id}`]={market,workspace:definition.id,contentOwner:definition.id,requiresAdmin:definition.requiresAdmin===true,requiresInstrument:definition.requiresInstrument===true,modules:[...(loads[definition.id]||[])],readEndpoints:[...endpoints[definition.id]]};
  }
  return result;
}
