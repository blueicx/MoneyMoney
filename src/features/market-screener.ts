export type ScreenerScope = 'stocks' | 'options' | 'crypto' | 'prediction';

export interface ScreenerField {
  key: string;
  label: string;
  kind: 'number' | 'text';
}

export interface ScreenerFilter {
  eq?: string | number;
  gte?: number;
  lte?: number;
}

export interface ScreenerSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ScreenerTemplate {
  id?: string;
  name: string;
  scope: ScreenerScope;
  filters: Record<string, ScreenerFilter>;
  sort?: ScreenerSort;
}

const FIELD_DEFINITIONS: Record<ScreenerScope, readonly ScreenerField[]> = {
  stocks: [
    { key: 'changePct', label: '涨跌幅', kind: 'number' },
    { key: 'marketCap', label: '市值', kind: 'number' },
  ],
  options: [
    { key: 'impliedVolPct', label: '隐含波动率', kind: 'number' },
    { key: 'openInterest', label: '未平仓量', kind: 'number' },
    { key: 'putCallOIRatio', label: 'Put/Call 持仓比', kind: 'number' },
  ],
  crypto: [
    { key: 'changePct', label: '24 小时涨跌幅', kind: 'number' },
    { key: 'fundingRate', label: '资金费率', kind: 'number' },
    { key: 'openInterest', label: '未平仓量', kind: 'number' },
  ],
  prediction: [
    { key: 'yesPrice', label: 'YES 价格', kind: 'number' },
    { key: 'noPrice', label: 'NO 价格', kind: 'number' },
    { key: 'liquidity', label: '流动性', kind: 'number' },
  ],
};

export function isScreenerScope(value: string): value is ScreenerScope {
  return Object.prototype.hasOwnProperty.call(FIELD_DEFINITIONS, value);
}

export function createScreener(scope: ScreenerScope, rows: Record<string, unknown>[] = []) {
  if (!isScreenerScope(scope)) throw new Error(`不支持的筛选市场: ${scope}`);
  return { scope, fields: FIELD_DEFINITIONS[scope].map(field => ({ ...field })), rows: [...rows] };
}

function fieldsFor(scope: ScreenerScope): readonly ScreenerField[] {
  if (!isScreenerScope(scope)) throw new Error(`不支持的筛选市场: ${scope}`);
  return FIELD_DEFINITIONS[scope];
}

function validateFilters(scope: ScreenerScope, filters: Record<string, ScreenerFilter>): void {
  const definitions = new Map(fieldsFor(scope).map(field => [field.key, field]));
  for (const [key, filter] of Object.entries(filters || {})) {
    const definition = definitions.get(key);
    if (!definition) throw new Error(`字段 ${key} 不属于 ${scope} scope`);
    if (!filter || typeof filter !== 'object') throw new Error(`字段 ${key} 的筛选条件无效`);
    if (definition.kind === 'number' && filter.eq !== undefined && !Number.isFinite(Number(filter.eq))) {
      throw new Error(`字段 ${key} 必须使用数字条件`);
    }
    for (const bound of ['gte', 'lte'] as const) {
      if (filter[bound] !== undefined && !Number.isFinite(Number(filter[bound]))) throw new Error(`字段 ${key} 的 ${bound} 条件无效`);
    }
    if (filter.gte !== undefined && filter.lte !== undefined && Number(filter.gte) > Number(filter.lte)) {
      throw new Error(`字段 ${key} 的范围无效`);
    }
  }
}

export function filterRows(scope: ScreenerScope, rows: Record<string, unknown>[], filters: Record<string, ScreenerFilter>) {
  validateFilters(scope, filters);
  return rows.filter(row => Object.entries(filters || {}).every(([key, filter]) => {
    const value = row[key];
    if (value === undefined || value === null) return false;
    const numeric = Number(value);
    const expected = filter.eq;
    if (expected !== undefined && (typeof expected === 'number' || Number.isFinite(numeric))) {
      if (!Number.isFinite(numeric) || numeric !== Number(expected)) return false;
    } else if (expected !== undefined && String(value).toLowerCase() !== String(expected).toLowerCase()) return false;
    if (filter.gte !== undefined && (!Number.isFinite(numeric) || numeric < Number(filter.gte))) return false;
    if (filter.lte !== undefined && (!Number.isFinite(numeric) || numeric > Number(filter.lte))) return false;
    return true;
  }));
}

export function sortRows(scope: ScreenerScope, rows: Record<string, unknown>[], sort: ScreenerSort) {
  const definitions = fieldsFor(scope);
  if (!definitions.some(field => field.key === sort.field)) throw new Error(`字段 ${sort.field} 不属于 ${scope} scope`);
  const direction = sort.direction === 'asc' ? 1 : sort.direction === 'desc' ? -1 : 0;
  if (!direction) throw new Error('排序方向无效');
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const left = a.row[sort.field]; const right = b.row[sort.field];
    if (left === right) return a.index - b.index;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    const result = String(left).localeCompare(String(right), undefined, { numeric: true });
    return result === 0 ? a.index - b.index : result * direction;
  }).map(item => item.row);
}

export function paginateRows(rows: Record<string, unknown>[], pageSize = 50, page = 1) {
  const size = Math.min(200, Math.max(1, Math.floor(Number(pageSize) || 50)));
  const currentPage = Math.max(1, Math.floor(Number(page) || 1));
  return { rows: rows.slice((currentPage - 1) * size, currentPage * size), page: currentPage, pageSize: size, total: rows.length, totalPages: Math.ceil(rows.length / size) };
}

export function serializeTemplate(input: Omit<ScreenerTemplate, 'id'>): Omit<ScreenerTemplate, 'id'> {
  if (!input.name.trim()) throw new Error('筛选模板名称不能为空');
  validateFilters(input.scope, input.filters);
  if (input.sort) sortRows(input.scope, [], input.sort);
  return { name: input.name.trim().slice(0, 80), scope: input.scope, filters: JSON.parse(JSON.stringify(input.filters)), ...(input.sort ? { sort: { ...input.sort } } : {}) };
}

export function fieldsForScreener(scope: ScreenerScope): ScreenerField[] {
  return fieldsFor(scope).map(field => ({ ...field }));
}
