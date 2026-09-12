import { MARKET_SCOPES, type MarketScope } from './market-scope';

export type WorkspaceId =
  | 'overview'
  | 'radar'
  | 'analysis'
  | 'backtest'
  | 'watchlist'
  | 'positions'
  | 'risk'
  | 'search'
  | 'breadth'
  | 'insider'
  | 'institutional'
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
  | 'prediction-radar';

export interface WorkspaceItem {
  id: WorkspaceId;
  label: string;
  icon: string;
  scopes: readonly MarketScope[];
  requiresInstrument?: boolean;
  availability?: 'live' | 'degraded' | 'unavailable';
}

export interface WorkspaceGroup {
  id: 'market' | 'research' | 'portfolio' | 'market-specific';
  label: string;
  items: WorkspaceItem[];
}

const ALL_SCOPES = MARKET_SCOPES;
const ASSET_SCOPES: readonly MarketScope[] = ['stocks', 'options', 'crypto', 'prediction'];

const ITEMS: Record<WorkspaceId, WorkspaceItem> = {
  overview: { id: 'overview', label: '市场总览', icon: '⌂', scopes: ALL_SCOPES },
  radar: { id: 'radar', label: '市场雷达', icon: '◉', scopes: ASSET_SCOPES },
  analysis: { id: 'analysis', label: '标的分析', icon: '⌁', scopes: ASSET_SCOPES, requiresInstrument: true },
  backtest: { id: 'backtest', label: '策略回测', icon: '⌘', scopes: ASSET_SCOPES, requiresInstrument: true },
  watchlist: { id: 'watchlist', label: '我的自选', icon: '★', scopes: ALL_SCOPES },
  positions: { id: 'positions', label: '我的持仓', icon: '▣', scopes: ALL_SCOPES },
  risk: { id: 'risk', label: '风险监控', icon: '♡', scopes: ASSET_SCOPES, requiresInstrument: true },
  search: { id: 'search', label: '搜索标的', icon: '⌕', scopes: ASSET_SCOPES },
  breadth: { id: 'breadth', label: '市场宽度', icon: '▥', scopes: ['stocks'] },
  insider: { id: 'insider', label: '内部人交易', icon: '♟', scopes: ['stocks'], requiresInstrument: true },
  institutional: { id: 'institutional', label: '机构持仓', icon: '♜', scopes: ['stocks'], requiresInstrument: true },
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
  'prediction-radar': { id: 'prediction-radar', label: '预测雷达', icon: '◎', scopes: ['prediction'] },
};

const BASE_GROUPS: readonly { id: WorkspaceGroup['id']; label: string; items: readonly WorkspaceId[] }[] = [
  { id: 'market', label: '市场', items: ['overview', 'radar', 'analysis'] },
  { id: 'research', label: '研究', items: ['backtest', 'risk', 'search'] },
];

const SPECIFIC_ITEMS: Record<MarketScope, readonly WorkspaceId[]> = {
  overview: [],
  stocks: ['breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest'],
  options: ['option-chain', 'volatility', 'greeks'],
  crypto: ['funding-rate', 'open-interest', 'on-chain', 'order-flow'],
  prediction: ['prediction-radar'],
  watchlist: [],
};

function item(id: WorkspaceId): WorkspaceItem {
  return { ...ITEMS[id], scopes: [...ITEMS[id].scopes] };
}

function group(id: WorkspaceGroup['id'], label: string, ids: readonly WorkspaceId[]): WorkspaceGroup {
  return { id, label, items: ids.map(item) };
}

export function resolveWorkspaceNavigation(scope: MarketScope): WorkspaceGroup[] {
  const specific = SPECIFIC_ITEMS[scope] || [];
  const groups = BASE_GROUPS.map(base => group(base.id, base.label, base.items));
  if (specific.length > 0) {
    groups.push(group('market-specific', '市场专属', specific));
  }
  return groups;
}

export function isWorkspaceAllowed(scope: MarketScope, workspace: WorkspaceId): boolean {
  if (workspace === 'watchlist' || workspace === 'positions') return true;
  return resolveWorkspaceNavigation(scope).some(groupItem => groupItem.items.some(itemValue => itemValue.id === workspace));
}

export function defaultWorkspace(scope: MarketScope): WorkspaceId {
  return scope === 'watchlist' ? 'watchlist' : 'overview';
}
