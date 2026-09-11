# 左侧固定市场工作区与研究闭环实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）来跟踪进度。

**目标：** 将 MoneyMoney 改造成“顶部切换市场、左侧固定功能区、右侧当前内容”的市场工作台，并吸收 tick-stock-panel 中可迁移的看板、自选、筛选、回测、监控和数据能力设计。

**架构：** 新增统一的市场工作区菜单模型，由后端返回当前作用域允许的功能，前端用同一模型渲染桌面侧栏、折叠图标栏和移动抽屉。所有页面状态使用 `market + workspace + instrument` 作为路由和缓存边界；股票、期权、虚拟币、预测市场分别使用自己的字段和数据源，宏观与新闻等继续留在通用工具栏。

**技术栈：** 现有 TypeScript/Express、静态 HTML/CSS/JavaScript、Node `node:test`、现有 CSS 变量和浏览器 smoke 流程；不迁移 React、FastAPI、Polars 或参考项目的代码与资源。

---

## 参考项目吸收清单

参考 [tick-stock-panel README](https://github.com/shy3130/tick-stock-panel) 以及其公开源码 [Layout.tsx](https://github.com/shy3130/tick-stock-panel/blob/main/frontend/src/components/Layout.tsx)、[Dashboard.tsx](https://github.com/shy3130/tick-stock-panel/blob/main/frontend/src/pages/Dashboard.tsx)、[Watchlist.tsx](https://github.com/shy3130/tick-stock-panel/blob/main/frontend/src/pages/Watchlist.tsx)、[Backtest.tsx](https://github.com/shy3130/tick-stock-panel/blob/main/frontend/src/pages/Backtest.tsx)、[Screener.tsx](https://github.com/shy3130/tick-stock-panel/blob/main/frontend/src/pages/Screener.tsx) 的功能结构，计划吸收以下能力：

1. 左侧固定导航：展开、图标折叠、移动端抽屉、导航状态持久化和自选分组入口。
2. 市场看板层级：行情条、涨跌广度、情绪/趋势、热门板块、异动流；每张卡片显示来源、时间和可用性。
3. 自选工作区：分组、表格/卡片双视图、列配置、排序、当前标的预览和批量刷新。
4. 研究闭环：策略筛选 → 标的详情 → 回测 → 保存候选方案 → 一键载入复测 → 建立监控。
5. 回测研究：策略视图、参数验证视图、净值/回撤/夏普/胜率/交易明细、真实费用滑点约束、失败原因和进度状态。
6. 监控中心：策略、标的信号、价格、市场异动四类规则，条件组合、冷却期、严重级别、触发记录和通知渠道状态。
7. 数据能力路由：按数据集显示数据源、档位、更新时间和降级原因；数据源不可用时 fail-closed，不用其他市场数据填充。
8. 性能设计：查询缓存键包含作用域，长任务使用可恢复任务状态，页面只加载当前工作区所需数据。

不直接吸收参考项目的 A 股专属实现：涨停/连板/龙虎榜/同花顺风向标、A 股策略数量、A 股交易日口径和任何 AI 荐股或预测式推荐。它们只有在股票作用域具备经过验证的数据源和明确字段时，才作为股票专属能力单独实现。

## 文件清单与职责

- 创建：`src/features/market-workspace.ts`——统一市场作用域、工作区 ID、左侧菜单分组、能力要求和路由校验。
- 修改：`src/web/server.ts`——返回作用域菜单、校验工作区与标的类型、统一当前标的上下文，保持访客只读边界。
- 修改：`src/web/public/index.html`——新增固定左栏、折叠栏、移动抽屉、右侧工作区壳、状态组件和研究闭环入口。
- 修改：`src/web/public/sw.js`——只在资源契约变化时递增缓存版本，避免旧 HTML 覆盖新菜单。
- 创建：`tests/market-workspace-navigation.test.cjs`——验证菜单矩阵、作用域过滤和路由状态。
- 创建：`tests/market-workspace-flow.test.cjs`——验证标的上下文、缓存键、跨市场隔离和研究闭环入口。
- 修改：`tests/theme-scoped-backtest.test.cjs`——增加左栏、折叠态、移动抽屉和状态主题检查。
- 修改：`tests/market-isolation-regression.test.cjs`——增加工作区级别的跨市场污染回归。
- 创建：`docs/handover-2026-09-11-left-sidebar-market-workspace.md`——记录实现范围、验收、发布 hash 和回滚目录。

## 任务 1：先建立失败测试和统一菜单契约

**文件：**
- 创建：`src/features/market-workspace.ts`
- 创建：`tests/market-workspace-navigation.test.cjs`
- 创建：`tests/market-workspace-flow.test.cjs`

- [x] **步骤 1：编写失败的菜单矩阵测试**

测试必须验证股票、期权、虚拟币、预测市场和总体的菜单边界：

```js
const { resolveWorkspaceNavigation, isWorkspaceAllowed } = require('../dist/features/market-workspace.js');

test('股票左栏包含研究功能但不包含虚拟币专属字段', () => {
  const ids = resolveWorkspaceNavigation('stocks').flatMap(group => group.items.map(item => item.id));
  assert.ok(ids.includes('insider'));
  assert.ok(ids.includes('backtest'));
  assert.equal(ids.includes('funding-rate'), false);
  assert.equal(ids.includes('prediction-radar'), false);
});

test('虚拟币左栏使用虚拟币功能，宏观不进入市场侧栏', () => {
  const ids = resolveWorkspaceNavigation('crypto').flatMap(group => group.items.map(item => item.id));
  assert.ok(ids.includes('funding-rate'));
  assert.equal(ids.includes('macro'), false);
  assert.equal(isWorkspaceAllowed('crypto', 'insider'), false);
});

test('市场切换不允许旧工作区继续使用', () => {
  assert.equal(isWorkspaceAllowed('stocks', 'insider'), true);
  assert.equal(isWorkspaceAllowed('options', 'insider'), false);
  assert.equal(isWorkspaceAllowed('prediction', 'prediction-radar'), true);
});
```

- [x] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs`

预期：FAIL，报错 `Cannot find module '../dist/features/market-workspace.js'` 或导出函数不存在。

- [x] **步骤 3：实现菜单类型和作用域矩阵**

`src/features/market-workspace.ts` 必须导出以下契约，并集中声明菜单：

```ts
export type MarketScope = 'overview' | 'stocks' | 'options' | 'crypto' | 'prediction' | 'watchlist';
export type WorkspaceId =
  | 'overview' | 'radar' | 'analysis' | 'backtest' | 'watchlist'
  | 'positions' | 'risk' | 'search' | 'breadth' | 'insider'
  | 'institutional' | 'analyst' | 'fundamentals' | 'short-interest'
  | 'option-chain' | 'volatility' | 'greeks' | 'funding-rate'
  | 'open-interest' | 'on-chain' | 'prediction-radar';

export interface WorkspaceItem {
  id: WorkspaceId;
  label: string;
  icon: string;
  scopes: MarketScope[];
  requiresInstrument?: boolean;
  availability?: 'live' | 'degraded' | 'unavailable';
}

export interface WorkspaceGroup {
  id: 'market' | 'research' | 'portfolio' | 'market-specific';
  label: string;
  items: WorkspaceItem[];
}

export function resolveWorkspaceNavigation(scope: MarketScope): WorkspaceGroup[];
export function isWorkspaceAllowed(scope: MarketScope, workspace: WorkspaceId): boolean;
export function defaultWorkspace(scope: MarketScope): WorkspaceId;
```

基础菜单保持位置一致，市场专属菜单由 `scope` 过滤；`macro`、`news`、`research` 等通用工具不进入此模型，仍由现有通用工具栏管理。

- [x] **步骤 4：运行定向测试确认通过**

运行：`npm run build; node --test tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs`

预期：菜单矩阵测试全部 PASS，股票和虚拟币的专属工作区不会互相出现。

- [x] **步骤 5：Commit**

```bash
git add src/features/market-workspace.ts tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs
git commit -m "feat: define scoped market workspace navigation"
```

## 任务 2：后端提供菜单和上下文校验

**文件：**
- 修改：`src/web/server.ts`
- 修改：`tests/market-workspace-navigation.test.cjs`
- 修改：`tests/market-isolation-regression.test.cjs`

- [ ] **步骤 1：编写 API 失败测试**

测试验证菜单接口和非法组合：

```js
test('workspace navigation API filters by requested scope', async () => {
  const stocks = await request('/api/workspace/navigation?scope=stocks');
  assert.equal(stocks.status, 200);
  assert.ok(stocks.body.groups.some(group => group.items.some(item => item.id === 'insider')));
  assert.equal(JSON.stringify(stocks.body).includes('funding-rate'), false);
});

test('workspace API rejects unknown scope and disallowed workspace', async () => {
  const unknown = await request('/api/workspace/navigation?scope=unknown');
  assert.equal(unknown.status, 400);
  const disallowed = await request('/api/workspace/context?scope=options&workspace=insider&instrument=AAPL');
  assert.equal(disallowed.status, 400);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/market-workspace-navigation.test.cjs tests/market-isolation-regression.test.cjs`

预期：FAIL，接口返回 404 或未过滤的菜单。

- [ ] **步骤 3：实现后端菜单接口和上下文校验**

在 `src/web/server.ts` 注册：

```ts
app.get('/api/workspace/navigation', (req, res) => {
  const scope = String(req.query.scope || 'overview') as MarketScope;
  if (!MARKET_SCOPES.includes(scope)) return res.status(400).json({ success: false, error: '未知市场 scope' });
  return res.json({ success: true, scope, groups: resolveWorkspaceNavigation(scope) });
});

app.get('/api/workspace/context', (req, res) => {
  const scope = String(req.query.scope || 'overview') as MarketScope;
  const workspace = String(req.query.workspace || defaultWorkspace(scope)) as WorkspaceId;
  const instrument = String(req.query.instrument || '').trim();
  if (!isWorkspaceAllowed(scope, workspace)) {
    return res.status(400).json({ success: false, scope, workspace, error: '当前市场不支持该工作区' });
  }
  return res.json({ success: true, scope, workspace, instrument: instrument || null });
});
```

实际实现需复用现有认证 middleware、`scope` 枚举和统一标的解析器；不得绕过访客 GET 白名单，不得把写入动作加入新接口。

- [ ] **步骤 4：运行测试确认通过**

运行：`npm run build; node --test tests/market-workspace-navigation.test.cjs tests/market-isolation-regression.test.cjs`

预期：作用域过滤、非法工作区 400、访客只读边界全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/web/server.ts tests/market-workspace-navigation.test.cjs tests/market-isolation-regression.test.cjs
git commit -m "feat: expose scoped workspace navigation API"
```

## 任务 3：实现左侧固定功能区和响应式壳

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`src/web/public/sw.js`
- 修改：`tests/theme-scoped-backtest.test.cjs`

- [ ] **步骤 1：编写主题和结构失败测试**

测试必须检查桌面侧栏、折叠态、移动抽屉、激活项和现有主题变量：

```js
assert.match(html, /id="market-workspace-sidebar"/);
assert.match(html, /id="market-workspace-main"/);
assert.match(html, /data-sidebar-state="expanded"/);
assert.match(html, /aria-label="市场功能区"/);
assert.match(html, /--bg-card|--bg-secondary/);
assert.match(html, /workspace-sidebar-toggle/);
assert.match(html, /workspace-drawer/);
```

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test tests/theme-scoped-backtest.test.cjs`

预期：FAIL，找不到 `market-workspace-sidebar` 或 `workspace-drawer`。

- [ ] **步骤 3：实现三态导航壳**

在现有 `#core-workspace-nav` 所在主布局位置增加：

```html
<div id="market-workspace-shell" data-market-scope="overview">
  <aside id="market-workspace-sidebar" class="workspace-sidebar" aria-label="市场功能区">
    <div id="workspace-sidebar-content"></div>
    <button id="workspace-sidebar-toggle" class="workspace-sidebar-toggle" type="button">折叠</button>
  </aside>
  <main id="market-workspace-main" class="workspace-main">
    <div id="workspace-context-bar"></div>
    <div id="workspace-content"></div>
  </main>
</div>
<div id="workspace-drawer" class="workspace-drawer" hidden>
  <button type="button" data-workspace-drawer-close>关闭</button>
  <div id="workspace-drawer-content"></div>
</div>
```

CSS 使用现有 `--bg-card`、`--bg-secondary`、`--border`、`--text`、`--text-secondary`、`--purple`，桌面端 `grid-template-columns: 224px minmax(0, 1fr)`，折叠态为 `56px minmax(0, 1fr)`，小于 768px 时隐藏 aside、打开抽屉。菜单项必须在侧栏和移动抽屉复用同一渲染函数，不复制两套点击逻辑。

- [ ] **步骤 4：接入持久化和键盘可用性**

使用 `localStorage` 保存 `mm-workspace-sidebar-state`，仅允许 `expanded` 或 `rail`；侧栏按钮提供 `aria-expanded`、焦点样式和 Escape 关闭移动抽屉。刷新页面后恢复折叠态，切换市场不重置用户的折叠偏好。

- [ ] **步骤 5：运行浏览器检查并修正主题**

运行：`node --test tests/theme-scoped-backtest.test.cjs`

浏览器验收：桌面展开、桌面折叠、移动抽屉、股票/虚拟币菜单切换；预期无浏览器默认白色按钮、无横向溢出、当前项有明显激活态。

- [ ] **步骤 6：Commit**

```bash
git add src/web/public/index.html src/web/public/sw.js tests/theme-scoped-backtest.test.cjs
git commit -m "feat: add responsive market workspace sidebar"
```

## 任务 4：把市场和当前标的上下文接入左栏

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`src/web/server.ts`
- 修改：`tests/market-workspace-flow.test.cjs`

- [ ] **步骤 1：编写跨市场状态失败测试**

测试 URL、缓存键和请求取消语义：

```js
assert.match(html, /workspace=.*instrument=/);
assert.match(html, /scope.*workspace.*instrument/);
assert.match(html, /AbortController/);
assert.match(html, /marketScopeRequestEpoch/);
assert.match(server, /isWorkspaceAllowed/);
```

- [ ] **步骤 2：实现上下文状态和 URL 恢复**

统一维护：

```js
const workspaceContext = {
  scope: activeMarketScope,
  workspace: activeWorkspace,
  instrument: currentInstrumentId || null,
};
const contextKey = `${workspaceContext.scope}:${workspaceContext.workspace}:${workspaceContext.instrument || '-'}`;
```

路由格式固定为 `/?market=stocks&workspace=insider&instrument=AAPL`。`setMarketScope` 必须清除不兼容工作区、取消旧请求、清空旧标的结果，再加载新作用域；`selectStockSymbol`、币种选择、期权链选择和预测市场选择都通过同一上下文入口写入。

- [ ] **步骤 3：把侧栏点击绑定到上下文入口**

侧栏点击只调用 `openWorkspace(workspaceId)`，由该函数完成校验、URL 更新、激活态更新、请求令牌更新和内容加载。任何工作区不得直接写 `innerHTML` 后绕过作用域令牌。

- [ ] **步骤 4：验证跨市场回归**

运行：`npm run build; node --test tests/market-workspace-flow.test.cjs tests/market-isolation-regression.test.cjs`

预期：从股票内部人切换到虚拟币后，内部人内容清空，虚拟币工作区只显示虚拟币字段；旧请求返回后不能覆盖新页面。

- [ ] **步骤 5：Commit**

```bash
git add src/web/public/index.html src/web/server.ts tests/market-workspace-flow.test.cjs
git commit -m "feat: bind workspace content to market context"
```

## 任务 5：吸收参考项目的市场看板层级

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`src/web/server.ts`
- 修改：`tests/market-workspace-flow.test.cjs`

- [ ] **步骤 1：为每个市场定义看板卡片契约**

卡片必须包含 `id/title/source/fetchedAt/status/fields`；状态为 `live`、`stale`、`degraded`、`unavailable` 之一。股票卡片使用指数、涨跌广度、市场宽度、热门板块和股票事件；虚拟币卡片使用交易所行情、资金费率、未平仓量和虚拟币事件；期权卡片使用现有期权行情与可用的链/波动率字段；预测市场卡片使用预测市场快照。

- [ ] **步骤 2：实现右侧看板排列**

右侧默认顺序固定为：

```text
当前标的/行情条 → 广度或市场结构 → 情绪/趋势 → 热门板块或市场榜单 → 异动/事件流
```

参考项目的紧凑卡片和 `grid` 层级可以吸收，但所有颜色、边框和空状态沿用 MoneyMoney 主题变量。点击热门板块只在当前市场内打开成分列表，不能跳到股票热门列表。

- [ ] **步骤 3：增加来源和加载状态**

每张卡片在加载时显示骨架；部分数据成功时显示可用卡片和缺失源原因；全部失败时显示可操作错误状态。不得用 BTC、预测市场或旧缓存填补股票/期权卡片。

- [ ] **步骤 4：运行看板测试**

运行：`npm run build; node --test tests/market-workspace-flow.test.cjs tests/market-isolation-regression.test.cjs`

预期：四类市场的卡片字段集合互斥，来源和 unavailable 状态可序列化，切换作用域后旧卡片不残留。

- [ ] **步骤 5：Commit**

```bash
git add src/web/public/index.html src/web/server.ts tests/market-workspace-flow.test.cjs
git commit -m "feat: organize scoped market dashboard cards"
```

## 任务 6：吸收自选分组、表格/卡片双视图和标的预览

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`src/web/server.ts`
- 修改：`tests/market-workspace-flow.test.cjs`

- [ ] **步骤 1：盘点并复用现有自选 API**

复用 `/api/watchlist`、统一标的 ID、模拟持仓查询和现有权限 middleware；新增返回不得泄露 owner、账户或敏感持仓标识。股票自选、虚拟币自选、期权自选和预测市场自选必须按市场类型隔离。

- [ ] **步骤 2：实现左栏自选分组入口**

侧栏“我的自选”展开显示当前市场分组和数量；点击分组只更新 `workspace=watchlist&group=<id>`，不跳出当前市场。无分组或接口不可用时显示明确空状态。

- [ ] **步骤 3：实现双视图和列配置**

桌面端提供表格/卡片切换；表格默认显示标的、最新价、涨跌、数据源状态和最后更新时间；市场专属字段由菜单矩阵决定。卡片显示行情摘要、状态和加入/移出自选按钮。列配置保存在当前用户/本地作用域，不把股票列带到虚拟币。

- [ ] **步骤 4：实现点击标的预览**

点击表格行或卡片设置当前标的，右侧详情、雷达、分析和回测入口全部使用该标的；保留同一列表的上一个/下一个切换，不回到热门股票页面。

- [ ] **步骤 5：测试和 Commit**

运行：`npm run build; npm test`

预期：自选分组、双视图、列配置和标的预览测试通过，访客 GET 仍可读，所有写入路径仍被阻断。

```bash
git add src/web/public/index.html src/web/server.ts tests/market-workspace-flow.test.cjs
git commit -m "feat: add grouped dual-view market watchlists"
```

## 任务 7：吸收筛选—详情—回测—候选—监控研究闭环

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`src/web/server.ts`
- 修改：`src/features/kelly-backtest.ts`
- 修改：`tests/market-workspace-flow.test.cjs`
- 修改：`tests/market-backtest-engine.test.cjs`

- [ ] **步骤 1：把筛选结果绑定当前市场**

股票筛选结果只允许股票字段和股票标的；虚拟币筛选结果只允许虚拟币字段；期权和预测市场使用各自已有工作区。点击结果必须调用统一标的入口，并在当前市场打开分析。

- [ ] **步骤 2：统一回测入口**

回测侧栏入口读取当前标的；股票和虚拟币继续调用独立真实历史数据引擎；预测市场保留 YES/NO 引擎；期权历史链、隐含波动率和 Greeks 不可用时返回结构化 unavailable。页面采用“策略 / 验证”内部标签、候选方案入口、净值和交易明细卡片，所有标签和字段按市场替换。

- [ ] **步骤 3：实现候选方案沉淀**

回测成功结果保存 `scope/instrument/strategy/parameters/metrics/dataSource/createdAt` 快照；载入候选时校验当前市场和标的类型，允许重新运行但不允许把股票候选载入虚拟币或预测市场。

- [ ] **步骤 4：把回测结果接入监控**

在有交易信号或策略结果的市场中提供“建立监控”入口，默认携带当前 `scope`、标的、策略和阈值。监控规则支持已有的价格、信号、策略、异动类型；触发记录显示具体条件、来源和时间，不发送未经用户配置的真实消息。

- [ ] **步骤 5：验证研究闭环**

运行：`npm run build; npm test`

预期：筛选结果点击到详情、详情到回测、回测保存/载入候选、候选建立监控的链路可通过静态测试和浏览器 smoke；所有跨市场候选加载被拒绝。

- [ ] **步骤 6：Commit**

```bash
git add src/web/public/index.html src/web/server.ts src/features/kelly-backtest.ts tests/market-workspace-flow.test.cjs tests/market-backtest-engine.test.cjs
git commit -m "feat: connect scoped research workflow"
```

## 任务 8：吸收数据源能力状态和加载性能设计

**文件：**
- 修改：`src/features/stock-data-service.ts`
- 修改：`src/features/binance.ts`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 修改：`tests/market-workspace-flow.test.cjs`

- [ ] **步骤 1：统一数据源状态字段**

每个工作区数据响应统一提供：

```ts
type DataAvailability = {
  source: string;
  status: 'live' | 'stale' | 'degraded' | 'unavailable';
  fetchedAt: string | null;
  cacheAgeMs: number | null;
  reason?: string;
};
```

旧 API 保留兼容字段，但新工作区优先使用这个状态，不能把缓存数据标记为实时。

- [ ] **步骤 2：限定请求范围并行度**

首屏只请求当前市场大盘和默认工作区；左栏菜单只在点击后加载专属数据。请求 key 固定为 `['workspace', scope, workspace, instrument, query]`；同一 key 在现有缓存时间内复用。市场切换递增请求 epoch，旧响应必须丢弃。

- [ ] **步骤 3：实现加载骨架和失败重试**

所有工作区使用同一骨架组件和错误卡片；重试按钮只重试当前 scope/workspace/instrument。股票、虚拟币、期权、预测市场分别显示自己的数据源名称和原因。

- [ ] **步骤 4：验证加载性能**

浏览器记录冷启动、切换市场、切换左栏功能和返回上一功能的请求数量与首个可见内容时间；目标是切换时不重复请求通用工具，不等待无关市场数据，不出现旧内容闪回。

- [ ] **步骤 5：测试和 Commit**

运行：`npm run build; npm test; npm run smoke:web`

预期：缓存键、状态字段、失败重试和请求取消测试通过，Web smoke 保持通过。

```bash
git add src/features/stock-data-service.ts src/features/binance.ts src/web/server.ts src/web/public/index.html tests/market-workspace-flow.test.cjs
git commit -m "perf: scope workspace data loading and status"
```

## 任务 9：主题、访客、移动端和 Telegram 对齐验收

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`src/web/server.ts`
- 修改：`tests/market-isolation-regression.test.cjs`
- 创建：`docs/handover-2026-09-11-left-sidebar-market-workspace.md`

- [ ] **步骤 1：桌面浏览器验收**

逐项验证：

1. 总体、股票、期权、虚拟币、预测市场切换。
2. 左栏展开、折叠、刷新恢复。
3. 当前标的从自选、持仓、搜索、雷达结果进入。
4. 股票内部人/机构/基本面和虚拟币资金费率/未平仓量互不出现。
5. 回测、监控、候选方案只使用当前作用域。
6. 宏观从通用工具栏打开且不改变市场作用域。

- [ ] **步骤 2：移动端验收**

在 390px 和 768px 宽度检查抽屉、关闭、滚动、底部快捷入口和表格/卡片布局；侧栏抽屉关闭后右侧内容不刷新成旧市场。

- [ ] **步骤 3：访客权限验收**

访客可以读取作用域大盘、自选展示和可用数据；不能写入自选、持仓、候选、监控或下单；敏感 GET 继续返回 403。不得在侧栏隐藏后仍留下可直接调用的写入按钮。

- [ ] **步骤 4：Telegram 市场作用域验收**

Telegram 菜单与网页共用相同市场语义：股票、期权、虚拟币、预测市场的菜单和搜索/自选/回测/详情处理器只调用对应市场数据；宏观仍显示为通用工具。服务只保留一个轮询实例，不发送测试消息给真实用户。

- [ ] **步骤 5：记录交接文档**

文档必须记录：实现提交列表、测试结果、浏览器验收截图/路径、已知数据源不可用边界、GitHub SHA、VPS 备份目录、服务状态和回滚命令。密钥、Token、个人标识和完整 Telegram 内容不得写入。

- [ ] **步骤 6：Commit**

```bash
git add src/web/public/index.html src/web/server.ts tests/market-isolation-regression.test.cjs docs/handover-2026-09-11-left-sidebar-market-workspace.md
git commit -m "docs: record market workspace acceptance"
```

## 任务 10：统一验证、GitHub 推送和 VPS 发布

**文件：**
- 读取：`package.json`
- 读取：`docs/handover-2026-09-02.md`
- 读取：`docs/handover-2026-09-10.md`

- [ ] **步骤 1：运行发布前验证**

运行：

```bash
npm run build
npm test
npm run security:scan
npm run smoke:web
git diff --check
```

预期：构建成功；全量测试 0 failures；secret scan、Web smoke 和 diff check 退出码均为 0。浏览器还必须验证桌面和移动端实际界面，不能只看命令行。

- [ ] **步骤 2：审查暂存内容**

只暂存本计划涉及的源码、测试和交接文档；检查 `git diff --cached --name-status`，确认没有 `.env`、Token、运行数据库、截图缓存或用户未要求的未跟踪文件。

- [ ] **步骤 3：提交并推送 GitHub**

```bash
git diff --cached --check
git commit -m "feat: add left market workspace research loop"
git push origin codex/stock-free-data-sources
git rev-parse HEAD
git ls-remote origin refs/heads/codex/stock-free-data-sources
```

预期：本地 HEAD 与远端分支 SHA 一致；若仓库已有无关 Git LFS 上传阻塞，只能在确认本次提交不包含新 LFS 对象后使用 `GIT_LFS_SKIP_PUSH=1` 重试，并把原因记录在交接文档。

- [ ] **步骤 4：备份并发布 VPS 应用产物**

只操作现有 `/opt/moneymoney/dist` 和带提交号的备份目录：

1. 读取 `moneymoney.service` 状态和 `/api/health/live`。
2. 本地重新构建 `dist`，生成临时 tarball。
3. 远端将当前 `/opt/moneymoney/dist` 复制到 `/opt/moneymoney/backups/dist-<commit>`。
4. 解包新 `dist` 到精确命名的临时目录，校验属主为 `moneymoney:moneymoney`。
5. 停止并重启 `moneymoney.service`，轮询直到 active。
6. 对比本地和远端 `dist/web/server.js`、`dist/web/public/index.html` SHA-256。

不修改 Nginx、TLS、VPN、系统环境文件、Telegram Token 或轮询所有权；失败时保留备份并按交接文档回滚。

- [ ] **步骤 5：发布后验证**

验证：

```text
systemctl is-active moneymoney.service = active
http://127.0.0.1:3001/api/health/live = 200
https://bluetrade.bbroot.com/login = 200
未授权 /api/workspace/navigation = 401
远端两个关键 dist 文件 hash = 本地 hash
```

再用已登录浏览器完成一次股票、虚拟币和期权页面切换；期权无真实数据时必须显示明确 unavailable，不得显示股票或虚拟币内容。

- [ ] **步骤 6：Commit 发布记录**

```bash
git add docs/handover-2026-09-11-left-sidebar-market-workspace.md
git commit -m "docs: record left sidebar workspace release"
git push origin codex/stock-free-data-sources
```

## 完成定义

- 左侧固定功能区已成为所有市场页面的统一入口，支持桌面展开/折叠和移动抽屉。
- 当前市场决定菜单、数据源、字段、策略和结果；工作区切换不会混入其他市场内容。
- 参考项目的看板层级、自选双视图、研究闭环、候选方案、监控规则和能力状态已吸收为 MoneyMoney 的同主题实现。
- 股票、期权、虚拟币和预测市场均有真实的作用域边界；缺数据时明确说明，不伪造、不跨市场兜底。
- 全量自动化测试、安全扫描、Web smoke、浏览器桌面/移动端验收、GitHub 推送和 VPS hash/健康检查均有证据。
- Nginx、TLS、VPN、密钥和 Telegram 轮询所有权没有被本轮改动。
