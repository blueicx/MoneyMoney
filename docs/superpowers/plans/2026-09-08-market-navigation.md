# 市场优先导航与数据边界实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [x]`）语法来跟踪进度。

**目标：** 将 MoneyMoney 改为市场优先导航，并保证切换市场后搜索、详情和对应工作区只使用当前市场的数据。

**架构：** 新增一个纯 TypeScript 市场范围模块，统一定义市场 ID、标的类型映射、默认工作区和搜索过滤规则；服务端统一搜索接口接收范围参数，前端导航使用同一组语义映射并把范围状态写入 URL/localStorage。现有股票、期权、虚拟币、预测市场和纸面交易页面继续复用，不进行大规模页面拆分。

**技术栈：** TypeScript、Express、原生 HTML/CSS/JavaScript、Node test runner、现有 `npm run build` 资源复制流程。

---

## 文件清单

- 创建：`src/features/market-scope.ts` —— 市场范围常量、标的类型映射、默认工作区和统一搜索过滤。
- 创建：`tests/market-scope.test.cjs` —— 市场范围纯函数的 TDD 测试。
- 修改：`src/web/server.ts:4436-4455` —— 统一搜索接口接收并校验 `scope`，详情/时间线保留既有类型边界。
- 修改：`src/features/unified-instruments.ts:170-190` —— 搜索支持可选市场范围，范围过滤在服务层完成。
- 修改：`src/web/public/index.html:216-238` —— 市场栏、全局入口栏、通用工具栏和底部核心栏样式。
- 修改：`src/web/public/index.html:1775-1778` —— 放置新的三层导航容器。
- 修改：`src/web/public/index.html:8210-8360` —— 全局搜索携带当前市场范围，并显示市场标签。
- 修改：`src/web/public/index.html:8435-8575` —— 使用统一市场范围模型渲染导航、处理市场切换、同步活动态和旧路由。
- 修改：`src/web/public/index.html:9761-9770` —— 移动底部栏移除币安和设置，改为跨市场持仓及核心工作区。
- 创建：`tests/market-navigation-wiring.test.cjs` —— 导航结构、市场边界、访客权限和旧路由回归测试。

## 任务 1：市场范围纯模块（TDD）

**文件：**

- 创建：`tests/market-scope.test.cjs`
- 创建：`src/features/market-scope.ts`

- [x] **步骤 1：编写失败的测试**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { marketScopeForInstrumentType, marketScopeForTab, filterInstrumentResults, defaultTabForMarketScope } = require('../dist/features/market-scope');

test('maps instrument types to market scopes', () => {
  assert.equal(marketScopeForInstrumentType('stock'), 'stocks');
  assert.equal(marketScopeForInstrumentType('crypto'), 'crypto');
  assert.equal(marketScopeForInstrumentType('prediction'), 'prediction');
});

test('maps legacy tabs to their market scope and default tabs', () => {
  assert.equal(marketScopeForTab('binance'), 'crypto');
  assert.equal(marketScopeForTab('options'), 'options');
  assert.equal(marketScopeForTab('radar'), 'prediction');
  assert.equal(defaultTabForMarketScope('crypto'), 'binance');
  assert.equal(defaultTabForMarketScope('watchlist'), 'positions');
});

test('filters unified results without merging same-name instruments across markets', () => {
  const items = [
    { id: 'stock:us:BTC', type: 'stock' },
    { id: 'crypto:binance:BTCUSDT', type: 'crypto' },
    { id: 'prediction:predictfun:42', type: 'prediction' },
  ];
  assert.deepEqual(filterInstrumentResults(items, 'crypto'), [items[1]]);
  assert.deepEqual(filterInstrumentResults(items, 'overview'), items);
});
```

- [x] **步骤 2：运行测试验证失败**

运行：`npm run build; node --test tests/market-scope.test.cjs`

预期：失败，报错 `Cannot find module '../dist/features/market-scope'`，证明测试针对尚不存在的模块。

- [x] **步骤 3：编写最少实现代码**

```ts
import type { InstrumentSearchResult, InstrumentType } from './unified-instruments';

export type MarketScope = 'overview' | 'stocks' | 'options' | 'crypto' | 'prediction' | 'watchlist';

export const MARKET_SCOPES: readonly MarketScope[] = ['overview', 'stocks', 'options', 'crypto', 'prediction', 'watchlist'];

export function marketScopeForInstrumentType(type: InstrumentType): MarketScope {
  return type === 'stock' ? 'stocks' : type === 'crypto' ? 'crypto' : 'prediction';
}

export function marketScopeForTab(tab: string): MarketScope {
  if (tab === 'stocks') return 'stocks';
  if (tab === 'options') return 'options';
  if (tab === 'binance') return 'crypto';
  if (tab === 'radar') return 'prediction';
  if (tab === 'positions') return 'watchlist';
  return 'overview';
}

export function defaultTabForMarketScope(scope: MarketScope): string {
  return scope === 'stocks' ? 'stocks' : scope === 'options' ? 'options' : scope === 'crypto' ? 'binance' : scope === 'prediction' ? 'radar' : scope === 'watchlist' ? 'positions' : 'command';
}

export function filterInstrumentResults<T extends Pick<InstrumentSearchResult, 'type'>>(items: T[], scope: MarketScope): T[] {
  if (scope === 'overview' || scope === 'watchlist') return items;
  const type = scope === 'stocks' ? 'stock' : scope === 'crypto' ? 'crypto' : scope === 'prediction' ? 'prediction' : null;
  return type ? items.filter(item => item.type === type) : [];
}
```

- [x] **步骤 4：运行测试验证通过**

运行：`npm run build; node --test tests/market-scope.test.cjs`

预期：3 个测试通过，0 个失败。

- [x] **步骤 5：Commit**

```bash
git add src/features/market-scope.ts tests/market-scope.test.cjs
git commit -m "feat: add market scope model"
```

## 任务 2：统一搜索的服务端市场边界

**文件：**

- 修改：`src/features/unified-instruments.ts:174-190`
- 修改：`src/web/server.ts:4436-4447`
- 修改：`tests/market-scope.test.cjs`

- [x] **步骤 1：扩展失败测试**

```js
test('search results are filtered by explicit market scope', () => {
  const items = [
    { id: 'stock:us:AAPL', type: 'stock' },
    { id: 'crypto:binance:BTCUSDT', type: 'crypto' },
  ];
  assert.deepEqual(filterInstrumentResults(items, 'stocks').map(item => item.type), ['stock']);
  assert.deepEqual(filterInstrumentResults(items, 'crypto').map(item => item.type), ['crypto']);
});
```

- [x] **步骤 2：运行测试验证失败**

运行：`npm run build; node --test tests/market-scope.test.cjs`

预期：新增断言在实现前失败，失败原因是范围过滤尚未接入统一搜索调用。

- [x] **步骤 3：实现服务端范围参数**

在 `UnifiedInstrumentService.search` 使用 `scope?: MarketScope` 参数，生成完整搜索结果后调用 `filterInstrumentResults`；在 `/api/instruments/search` 中读取 `req.query.scope`，只接受 `MARKET_SCOPES` 中的值，未知值返回 400。前端请求使用 `/api/instruments/search?q=...&scope=...`。

```ts
const rawScope = String(req.query.scope || 'overview');
if (!MARKET_SCOPES.includes(rawScope as MarketScope)) return res.status(400).json({ success: false, error: '市场范围无效', data: [] });
const data = await unifiedInstrumentService.search(q, rawScope as MarketScope);
```

- [x] **步骤 4：运行测试验证通过**

运行：`npm run build; node --test tests/market-scope.test.cjs tests/unified-instruments.test.cjs`

预期：范围测试和现有统一标的测试全部通过，0 个失败。

- [x] **步骤 5：Commit**

```bash
git add src/features/unified-instruments.ts src/web/server.ts tests/market-scope.test.cjs
git commit -m "feat: scope unified search by market"
```

## 任务 3：网页三层导航与市场状态

**文件：**

- 修改：`src/web/public/index.html:216-238,1775-1778,8435-8575,9761-9770`
- 创建：`tests/market-navigation-wiring.test.cjs`

- [x] **步骤 1：编写失败的导航回归测试**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const html = fs.readFileSync('src/web/public/index.html', 'utf8');

test('renders market-first navigation with global actions after watchlist', () => {
  assert.match(html, /id="market-scope-bar"/);
  assert.match(html, /id="utility-nav-bar"/);
  assert.match(html, /MARKET_SCOPES/);
  assert.match(html, /自选/);
  assert.match(html, /搜索/);
  assert.match(html, /总设置/);
  assert.match(html, /自动化运营/);
});

test('bottom core navigation uses cross-market holdings instead of Binance', () => {
  assert.match(html, /data-tab="positions"[^>]*>[\s\S]*持仓/);
  assert.doesNotMatch(html, /id="mobile-nav"[\s\S]*data-tab="binance"/);
});

test('market changes carry scope and guard stale responses', () => {
  assert.match(html, /setMarketScope/);
  assert.match(html, /marketScope/);
  assert.match(html, /scope=/);
  assert.match(html, /request !== globalSearchState\.request/);
});

test('guest mode excludes global mutation entries', () => {
  assert.match(html, /window\.mm_isGuest/);
  assert.match(html, /GUEST_ADMIN_TABS/);
});
```

- [x] **步骤 2：运行测试验证失败**

运行：`node --test tests/market-navigation-wiring.test.cjs`

预期：失败，找不到 `market-scope-bar` 或统一市场状态函数，证明回归测试覆盖了尚未实现的导航结构。

- [x] **步骤 3：实现三层导航**

在 `index.html` 中加入三个容器，并用以下数据形状渲染：

```js
const MARKET_SCOPES = [
  { id: 'overview', label: '首页（总体）', tab: 'command' },
  { id: 'stocks', label: '股票', tab: 'stocks' },
  { id: 'options', label: '期权', tab: 'options' },
  { id: 'crypto', label: '虚拟币', tab: 'binance' },
  { id: 'prediction', label: '预测市场', tab: 'radar' },
  { id: 'watchlist', label: '自选', tab: 'positions' },
];
const CORE_NAV_ITEMS = [
  ['command', '🏠 指挥台'], ['radar', '🌐 雷达'], ['paper', '📈 模拟'],
  ['analysis', '🧠 分析'], ['positions', '💼 持仓'], ['risk', '🛡 风险'], ['stocks', '📊 宏观'],
];
const UTILITY_NAV_ITEMS = [
  ['research', '🧾 证据工作台'], ['news', '📰 新闻日历'], ['backtest', '🧪 回测'],
  ['strategies', '⚖️ 策略对比'], ['alerts', '🔔 提醒'],
];
```

`renderMarketScopeBar` 将市场按钮放左侧，搜索、总设置、自动化运营放在 `自选` 后的同一行右侧；访客隐藏两个管理入口。`renderUtilityNav` 只渲染通用工具。`renderCoreNav` 在桌面端渲染普通横栏，并同步移动底栏；移动底栏使用“持仓”而非“币安”，不再把设置放到底部。

- [x] **步骤 4：接入状态和旧路由兼容**

实现 `activeMarketScope`、`setMarketScope(scope, options)`、`marketScopeForTab(tab)` 和 `renderNavigationState()`：

- 初始化优先读取 URL `market`，其次读取 `localStorage.mm-market-scope`，无效值回退 `overview`。
- 点击市场按钮保存范围、更新 `document.body.dataset.marketScope`、更新 `history.replaceState`，再进入该范围默认工作区。
- 旧的 `showTab('binance'|'stocks'|'options'|'radar'|'positions')` 先同步市场范围，确保从旧入口进入也不会显示错误范围。
- 市场范围改变时增加 `marketScopeRequestEpoch`；所有市场搜索和详情回调只接受发起时仍相同的范围，旧响应直接丢弃。
- `showTab` 继续执行既有加载函数，新增范围上下文，不删除现有 API 兼容路径。

- [x] **步骤 5：接入搜索范围**

把全局搜索请求改为：

```js
const scope = activeMarketScope === 'watchlist' ? 'overview' : activeMarketScope;
fetch('/api/instruments/search?q=' + encodeURIComponent(query) + '&scope=' + encodeURIComponent(scope), { cache: 'no-store' })
```

搜索结果 badge 使用实际 `item.type`；切换市场后清理未完成请求结果，保证股票、加密和预测市场同名标的不串数据。

- [x] **步骤 6：运行测试验证通过**

运行：`node --test tests/market-navigation-wiring.test.cjs`

预期：4 个导航回归测试通过，0 个失败。

- [x] **步骤 7：Commit**

```bash
git add src/web/public/index.html tests/market-navigation-wiring.test.cjs
git commit -m "feat: add market-first web navigation"
```

## 任务 4：构建、完整测试和浏览器冒烟

**文件：**

- 修改：仅在发现验证问题时修改对应实现/测试文件
- 验证：`dist/web/public/index.html` 为构建产物，不直接编辑

- [x] **步骤 1：运行类型检查和构建**

运行：`npm run build`

预期：TypeScript 编译和网页资源复制均退出码 0，`dist/web/public/index.html` 包含 `market-scope-bar`、`utility-nav-bar` 和 `setMarketScope`。

- [x] **步骤 2：运行完整测试**

运行：`npm test`

预期：所有现有和新增测试通过，0 个失败。

- [x] **步骤 3：运行网页冒烟**

运行：`npm run smoke:web`

预期：网页健康检查退出码 0；随后在现有浏览器标签执行 Ctrl+F5，检查桌面三层横栏、移动底部“持仓”、市场切换后默认工作区和搜索范围。

- [x] **步骤 4：检查变更范围并提交验证记录**

运行：`git diff --check; git status --short; git log --oneline -5`

预期：无空白错误；变更只包含本计划文件、实现文件和测试文件；已有未跟踪用户文件仍保持未跟踪，不被加入提交。

- [x] **步骤 5：Commit**

```bash
git commit --allow-empty -m "test: verify market navigation integration"
```

仅在前述构建、完整测试和冒烟均退出码 0 时执行该提交；不推送 GitHub，不发布 VPS。
