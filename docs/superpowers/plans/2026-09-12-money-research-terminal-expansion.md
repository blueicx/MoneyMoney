# MoneyMoney 研究终端扩充实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在保持市场隔离、Guest 只读和免费数据源优先的前提下，完成数据可信度、加载性能、统一研究流、可解释回测、模拟组合、提醒以及 AI/Telegram 上下文的一次阶段性升级。

**架构：** 将工作拆成四条可独立验收的轨道：A 数据与性能、B 详情与研究流、C 回测与组合、D AI/Telegram 与市场专属深度。每条轨道都通过现有 `MarketScope`、`InstrumentRef`、`DataStatus` 和统一模拟账本通信；中间区只渲染当前工作区，右侧库只负责标的上下文。

**技术栈：** TypeScript、Express、原生 HTML/CSS/JavaScript、Node `node:test`、现有缓存/状态存储、Playwright 浏览器冒烟、npm build/test/security scan。

---

## 文件总览

### 轨道 A：数据与性能

- 修改：`src/features/performance-cache.ts`，完善作用域缓存、并发去重、SWR、超时和条件请求。
- 修改：`src/features/source-health.ts`，统一源能力和状态输出。
- 修改：`src/web/server.ts`，为行情、详情、筛选、时间线和风险接口接入状态与缓存。
- 修改：`src/web/public/index.html`，统一状态徽章、加载骨架、重试和首屏按需加载。
- 测试：`tests/performance-cache.test.cjs`、`tests/source-health.test.cjs`、`tests/market-loading-performance.test.cjs`。

### 轨道 B：详情与研究流

- 修改：`src/features/unified-instruments.ts`，补齐统一详情返回结构和同市场上下文。
- 修改：`src/features/market-screener.ts`，扩展市场字段白名单、模板和结果动作元数据。
- 修改：`src/features/instrument-compare.ts`，补充同市场比较快照和标准化字段。
- 修改：`src/features/research-workspace.ts`，保存研究快照、候选和来源血缘。
- 修改：`src/web/server.ts`，提供详情、候选、研究快照和批量动作接口。
- 修改：`src/web/public/index.html`，实现中间详情区与右侧标的库联动。
- 测试：`tests/unified-instruments.test.cjs`、`tests/market-screener.test.cjs`、`tests/instrument-compare.test.cjs`、`tests/research-workspace.test.cjs`、`tests/market-scope-integration.test.cjs`。

### 轨道 C：回测与组合

- 修改：`src/features/kelly-backtest.ts`，统一市场回测结果和绩效指标。
- 修改：`src/features/unified-paper-trading.ts`，补齐市场交易日历、费用、滑点、组合风险和归因。
- 修改：`src/features/paper-trading.ts`，保持现有模拟盘兼容接口。
- 修改：`src/web/server.ts`，扩展回测、模拟组合、候选和风险接口。
- 修改：`src/web/public/index.html`，按市场显示参数、指标、数据缺口和操作入口。
- 测试：`tests/market-backtest-engine.test.cjs`、`tests/theme-scoped-backtest.test.cjs`、`tests/unified-paper.test.cjs`、`tests/paper-trading.test.cjs`。

### 轨道 D：AI、Telegram、提醒和市场深度

- 修改：`src/features/ai-commentary.ts`、`src/features/ai-endpoint.ts`，统一 `MarketContext` 和引用来源。
- 修改：`src/features/unified-alerts.ts`、`src/features/event-alerts.ts`，支持自选组、筛选结果和源状态提醒。
- 修改：`src/features/telegram-command-center.ts`、`src/web/telegram-menu.ts`、`src/web/telegram-search.ts`，保持聊天级作用域。
- 修改：`src/web/server.ts`，补齐结构化 AI 动作、Telegram 回调和提醒审计。
- 修改：`src/web/public/index.html`，增加 AI 操作卡和提醒证据。
- 测试：`tests/ai-market-scope.test.cjs`、`tests/telegram-market-scope.test.cjs`、`tests/telegram-detail.test.cjs`、`tests/telegram-backtest.test.cjs`、`tests/unified-alerts.test.cjs`。

---

## 轨道 A：数据可信度与加载性能

### 任务 1：先锁定统一数据状态契约

**文件：**

- 修改：`src/features/stock-data-contracts.ts`
- 修改：`src/features/source-health.ts`
- 测试：`tests/source-health.test.cjs`

- [ ] **步骤 1：编写失败测试**

```js
test('data status distinguishes live, cached, degraded and unavailable', () => {
  const { normalizeDataStatus } = require('../dist/features/stock-data-contracts');
  assert.equal(normalizeDataStatus({ state: 'live', source: 'nasdaq' }).state, 'live');
  assert.equal(normalizeDataStatus({ state: 'cached', source: 'nasdaq', observedAt: '2026-09-12T00:00:00Z' }).state, 'cached');
  assert.equal(normalizeDataStatus({ state: 'bad', source: 'nasdaq' }).state, 'unavailable');
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- --test-name-pattern="data status distinguishes"`

预期：FAIL，提示 `normalizeDataStatus` 未导出或状态未被规范化。

- [ ] **步骤 3：实现最小契约**

```ts
export type DataState = 'live' | 'delayed' | 'cached' | 'degraded' | 'unavailable';
export interface DataStatus { state: DataState; source: string; observedAt: string | null; expiresAt: string | null; latencyMs: number | null; reason: string | null; }
export function normalizeDataStatus(input: Partial<DataStatus>): DataStatus {
  const states: DataState[] = ['live', 'delayed', 'cached', 'degraded', 'unavailable'];
  return { state: states.includes(input.state as DataState) ? input.state as DataState : 'unavailable', source: String(input.source || 'unknown'), observedAt: input.observedAt || null, expiresAt: input.expiresAt || null, latencyMs: Number.isFinite(input.latencyMs) ? Number(input.latencyMs) : null, reason: input.reason || null };
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`npm test -- --test-name-pattern="data status distinguishes"`

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/features/stock-data-contracts.ts src/features/source-health.ts tests/source-health.test.cjs
git commit -m "feat: standardize market data status"
```

### 任务 2：完善作用域缓存和源健康映射

**文件：**

- 修改：`src/features/performance-cache.ts`
- 修改：`src/features/source-health.ts`
- 测试：`tests/performance-cache.test.cjs`

- [ ] **步骤 1：补充测试**：覆盖 `scope + source + key` 隔离、并发只调用一次、fresh/stale/expired、刷新失败保留旧值和 `304` 不改变数据。
- [ ] **步骤 2：运行 `npm test -- --test-name-pattern="Performance cache"` 确认新增断言先失败。**
- [ ] **步骤 3：实现 `fetch(key, fetcher, options)` 的 pending Promise 表、状态年龄计算、错误保留和 ETag 比较；pending key 必须包含 scope 和 source。
- [ ] **步骤 4：让 `source-health.ts` 使用同一缓存状态，并为每个源输出 capability、latency、observedAt 和 reason。
- [ ] **步骤 5：运行定向测试和 `npm run build`，预期全部通过。**
- [ ] **步骤 6：Commit**

```bash
git add src/features/performance-cache.ts src/features/source-health.ts tests/performance-cache.test.cjs
git commit -m "feat: add scoped stale-while-revalidate cache"
```

### 任务 3：首屏按需加载和状态呈现

**文件：**

- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：`tests/market-loading-performance.test.cjs`、`tests/market-scope-integration.test.cjs`

- [ ] **步骤 1：补充静态测试**：断言隐藏工作区不发请求、状态徽章包含 source/freshness、scope 切换会 abort 当前请求。
- [ ] **步骤 2：实现统一 `renderDataStatus(status)` 和 `renderLoadingState(target)`，所有核心卡片使用同一入口。
- [ ] **步骤 3：将行情、研究、风险、时间线和详情请求改为当前工作区优先；背景区块使用 `requestIdleCallback` 或已有的延后队列。
- [ ] **步骤 4：服务端为慢接口保留部分成功结果，超时返回 `degraded/unavailable`，不得返回其他市场数据。
- [ ] **步骤 5：运行 `npm run build`、`npm test`、`npm run security:scan` 和 `npm run smoke:web`。
- [ ] **步骤 6：Commit**

```bash
git add src/web/server.ts src/web/public/index.html tests/market-loading-performance.test.cjs tests/market-scope-integration.test.cjs
git commit -m "perf: prioritize scoped workspace loading"
```

---

## 轨道 B：详情与研究闭环

### 任务 4：统一标的详情数据模型

**文件：**

- 修改：`src/features/unified-instruments.ts`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：`tests/unified-instruments.test.cjs`、`tests/market-scope-integration.test.cjs`

- [ ] **步骤 1：测试详情响应必须包含 `instrument`, `quote`, `sections`, `timeline` 和 `status`，并拒绝 scope 与 instrument type 不匹配。
- [ ] **步骤 2：实现 `InstrumentOverview` 结构，股票、期权、虚拟币和预测市场适配器只填充自己的字段。
- [ ] **步骤 3：增加服务端统一详情路由，保留旧路由兼容，但新页面只调用统一路由。
- [ ] **步骤 4：右侧库点击标的时更新 URL 的 `market/workspace/instrument`，中间详情区清空旧数据后再加载。
- [ ] **步骤 5：运行定向测试、构建和浏览器冒烟。
- [ ] **步骤 6：Commit**

```bash
git add src/features/unified-instruments.ts src/web/server.ts src/web/public/index.html tests/unified-instruments.test.cjs tests/market-scope-integration.test.cjs
git commit -m "feat: unify scoped instrument details"
```

### 任务 5：筛选、比较和候选库形成连续动作

**文件：**

- 修改：`src/features/market-screener.ts`
- 修改：`src/features/instrument-compare.ts`
- 修改：`src/features/research-workspace.ts`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：`tests/market-screener.test.cjs`、`tests/instrument-compare.test.cjs`、`tests/research-workspace.test.cjs`

- [ ] **步骤 1：测试模板、比较快照和候选必须保存 `scope`、instrument IDs、filters、sort、source snapshot 和 createdAt。
- [ ] **步骤 2：实现筛选结果的四个动作：加入自选、保存候选、创建提醒、进入回测；每个动作先验证 scope。
- [ ] **步骤 3：比较接口只接受同市场 type；跨市场只允许预先定义的 price/change/volatility 等标准字段。
- [ ] **步骤 4：前端把固定热门、自选、持仓、搜索、最近访问和候选统一放入右侧库，中间只显示详情或当前研究功能。
- [ ] **步骤 5：运行完整测试和五市场浏览器矩阵；确认切换市场后旧比较和筛选结果被清空。
- [ ] **步骤 6：Commit**

```bash
git add src/features/market-screener.ts src/features/instrument-compare.ts src/features/research-workspace.ts src/web/server.ts src/web/public/index.html tests/market-screener.test.cjs tests/instrument-compare.test.cjs tests/research-workspace.test.cjs
git commit -m "feat: connect screener compare and candidate workflow"
```

---

## 轨道 C：回测与组合风险

### 任务 6：统一回测结果与市场专属语义

**文件：**

- 修改：`src/features/kelly-backtest.ts`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：`tests/market-backtest-engine.test.cjs`、`tests/theme-scoped-backtest.test.cjs`

- [ ] **步骤 1：先写四市场测试**：股票 T+1、虚拟币 24/7、期权缺少历史 IV/Greeks 返回 unavailable、预测市场使用 YES/NO 结算语义。
- [ ] **步骤 2：实现统一结果字段：`market`、`instrumentId`、`dataSource`、`barCount`、`metrics`、`trades`、`assumptions`、`availability`。
- [ ] **步骤 3：股票和虚拟币分别应用交易时间、费用、滑点、资金费率和爆仓约束；禁止使用预测市场历史替代资产历史。
- [ ] **步骤 4：增加 CAGR、Sharpe、Sortino、最大回撤、胜率、盈亏比、换手率、基准差异和费用滑点影响。
- [ ] **步骤 5：前端按市场显示专属参数；期权或其他历史不足场景显示原因和数据需求，不显示伪造结果。
- [ ] **步骤 6：运行定向测试、完整测试和浏览器回测冒烟。
- [ ] **步骤 7：Commit**

```bash
git add src/features/kelly-backtest.ts src/web/server.ts src/web/public/index.html tests/market-backtest-engine.test.cjs tests/theme-scoped-backtest.test.cjs
git commit -m "feat: make backtesting market aware"
```

### 任务 7：模拟组合、归因和风险压力测试

**文件：**

- 修改：`src/features/unified-paper-trading.ts`
- 修改：`src/features/paper-trading.ts`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：`tests/unified-paper.test.cjs`、`tests/paper-trading.test.cjs`

- [ ] **步骤 1：测试组合输出包含现金、已实现/未实现盈亏、市场敞口、集中度、费用、滑点和策略归因。
- [ ] **步骤 2：实现股票 T+1 与虚拟币 24/7 的结算规则；所有订单和持仓记录 market、instrumentId、strategyVersion 和 sourceSnapshot。
- [ ] **步骤 3：增加基准收益、最大回撤恢复、单标的敞口上限、市场集中度和压力测试结果。
- [ ] **步骤 4：保持 Guest 对 portfolio/positions 的只读边界，所有 reset/order/open/close/write 路由继续 403。
- [ ] **步骤 5：运行完整测试、安全扫描、Guest HTTP 冒烟并核对没有个人标识进入 GET 响应。
- [ ] **步骤 6：Commit**

```bash
git add src/features/unified-paper-trading.ts src/features/paper-trading.ts src/web/server.ts src/web/public/index.html tests/unified-paper.test.cjs tests/paper-trading.test.cjs
git commit -m "feat: add scoped paper portfolio risk attribution"
```

---

## 轨道 D：AI、Telegram、提醒与专属深度

### 任务 8：统一 AI 市场上下文和证据卡

**文件：**

- 修改：`src/features/ai-commentary.ts`
- 修改：`src/features/ai-endpoint.ts`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：`tests/ai-market-scope.test.cjs`、`tests/ai-endpoint-config.test.cjs`

- [ ] **步骤 1：测试 AI 请求必须携带 scope、workspace、instrument、dataStatus 和 source references；股票请求不得出现 fundingRate，虚拟币请求不得出现 SEC 财务字段。
- [ ] **步骤 2：实现 `MarketContext` 序列化和缓存签名，缓存必须包含 scope、instrument 和数据快照标识。
- [ ] **步骤 3：让 AI 返回结构化动作 `open_detail/add_watchlist/create_alert/run_backtest`，服务端重新验证动作 scope 后才返回给前端。
- [ ] **步骤 4：前端将结构化动作渲染为按钮，点击后进入当前市场右侧库或对应工作区。
- [ ] **步骤 5：运行 AI 市场隔离测试、构建和 Guest smoke；不得在日志或响应中暴露 API Key。
- [ ] **步骤 6：Commit**

```bash
git add src/features/ai-commentary.ts src/features/ai-endpoint.ts src/web/server.ts src/web/public/index.html tests/ai-market-scope.test.cjs tests/ai-endpoint-config.test.cjs
git commit -m "feat: add evidence aware market context to ai"
```

### 任务 9：提醒和 Telegram 全链路作用域

**文件：**

- 修改：`src/features/unified-alerts.ts`
- 修改：`src/features/event-alerts.ts`
- 修改：`src/features/telegram-command-center.ts`
- 修改：`src/web/telegram-menu.ts`
- 修改：`src/web/telegram-search.ts`
- 修改：`src/web/server.ts`
- 测试：`tests/unified-alerts.test.cjs`、`tests/telegram-market-scope.test.cjs`、`tests/telegram-detail.test.cjs`、`tests/telegram-backtest.test.cjs`

- [ ] **步骤 1：测试提醒目标支持单标的、自选组、筛选结果和数据源状态，并拒绝跨市场目标。
- [ ] **步骤 2：实现提醒证据记录：触发时间、scope、instrument、条件、来源、数据年龄、去重 key、冷却状态和投递结果。
- [ ] **步骤 3：检查 Telegram 菜单、搜索、详情、回测、持仓和提醒回调都从 chatId 恢复 scope；回调 payload 同时携带 scope 与 instrument。
- [ ] **步骤 4：Telegram 结果提供打开网页详情、加入自选、回测和创建提醒的结构化按钮；所有写动作继续经过管理员/用户权限校验。
- [ ] **步骤 5：运行 Telegram 定向测试并确认同一聊天切换市场后不会读取上一市场的候选、持仓或提醒。
- [ ] **步骤 6：Commit**

```bash
git add src/features/unified-alerts.ts src/features/event-alerts.ts src/features/telegram-command-center.ts src/web/telegram-menu.ts src/web/telegram-search.ts src/web/server.ts tests/unified-alerts.test.cjs tests/telegram-market-scope.test.cjs tests/telegram-detail.test.cjs tests/telegram-backtest.test.cjs
git commit -m "feat: keep alerts and telegram market scoped"
```

### 任务 10：市场专属深度和不可用边界

**文件：**

- 修改：`src/features/insider-transactions.ts`
- 修改：`src/features/institutional-ownership.ts`
- 修改：`src/features/analyst-consensus.ts`
- 修改：`src/features/fundamental-quality.ts`
- 修改：`src/features/short-interest.ts`
- 修改：`src/features/market-breadth.ts`
- 修改：`src/features/options-market.ts`
- 修改：`src/features/perpetual-crowding.ts`
- 修改：`src/features/order-flow-liquidity.ts`
- 修改：`src/features/bitcoin-onchain.ts`
- 修改：`src/features/prediction-radar.ts`
- 修改：`src/features/event-evidence.ts`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 修改：`tests/event-evidence-enhanced.test.cjs`
- 修改：`tests/event-evidence-next.test.cjs`
- 修改：`tests/market-scope-integration.test.cjs`
- 修改：`tests/market-scope-view.test.cjs`
- 新建：`tests/market-depth-contract.test.cjs`

- [ ] **步骤 1：先在 `tests/market-depth-contract.test.cjs` 为股票、期权、虚拟币和预测市场写 capability 白名单和字段隔离测试。
- [ ] **步骤 2：股票只关联 `insider-transactions.ts`、`institutional-ownership.ts`、`analyst-consensus.ts`、`fundamental-quality.ts`、`short-interest.ts` 和 `market-breadth.ts`；期权只关联 `options-market.ts`；虚拟币只关联 `perpetual-crowding.ts`、`order-flow-liquidity.ts` 和 `bitcoin-onchain.ts`；预测市场只关联 `prediction-radar.ts` 与 `event-evidence.ts`。
- [ ] **步骤 3：每项能力在服务端声明 capability 和数据状态；没有历史链或关键字段时返回 `unavailable` 与明确 reason，不回退到其他市场字段。
- [ ] **步骤 4：前端只在对应市场工作区挂载这些模块，切换市场时清空旧模块 DOM 和请求。
- [ ] **步骤 5：运行四市场接口测试、浏览器矩阵和安全扫描；验证没有跨市场字段污染。
- [ ] **步骤 6：Commit**

```bash
git add src/features/insider-transactions.ts src/features/institutional-ownership.ts src/features/analyst-consensus.ts src/features/fundamental-quality.ts src/features/short-interest.ts src/features/market-breadth.ts src/features/options-market.ts src/features/perpetual-crowding.ts src/features/order-flow-liquidity.ts src/features/bitcoin-onchain.ts src/features/prediction-radar.ts src/features/event-evidence.ts src/web/server.ts src/web/public/index.html tests/event-evidence-enhanced.test.cjs tests/event-evidence-next.test.cjs tests/market-scope-integration.test.cjs tests/market-scope-view.test.cjs tests/market-depth-contract.test.cjs
git commit -m "feat: deepen market specific research modules"
```

---

## 集成验收与发布

### 任务 11：端到端验收矩阵

**文件：**

- 修改：`tests/market-scope-integration.test.cjs`
- 修改：`tests/market-loading-performance.test.cjs`
- 新建：`tests/browser-market-research.smoke.mjs`

- [ ] **步骤 1：建立五市场 × 主要工作区矩阵：overview、stocks、options、crypto、prediction、watchlist。
- [ ] **步骤 2：自动验证右侧库选标的后 URL、详情、筛选、回测、模拟、提醒和 AI 都保留同一 scope/instrument。
- [ ] **步骤 3：自动验证隐藏工作区不发请求、旧请求不能回填、不可用源显示 reason、Guest 写接口返回 403。
- [ ] **步骤 4：运行 `npm run build`、`npm test`、`npm run security:scan`、`npm run smoke:web`、`git diff --check` 和浏览器 smoke。
- [ ] **步骤 5：保存真实浏览器截图和测试摘要，未通过的市场不标记为已验收。
- [ ] **步骤 6：Commit**

```bash
git add tests/market-scope-integration.test.cjs tests/market-loading-performance.test.cjs tests/browser-market-research.smoke.mjs
git commit -m "test: add full market research acceptance matrix"
```

### 任务 12：发布和回滚门

- [ ] **步骤 1：审查 `git status`，只允许本计划产生的已跟踪文件进入发布；保留用户原有的 `docs/antigravity-plans` 和 `docs/notes` 未跟踪内容。
- [ ] **步骤 2：检查 `.gitignore`，执行跟踪文件凭据扫描和 staged diff 扫描，确认没有 Token、Cookie、私有配置或运行时产物。
- [ ] **步骤 3：推送当前分支并记录提交 Hash；GitHub 推送成功与 CI 结果分开报告。
- [ ] **步骤 4：备份 VPS 当前 `/opt/moneymoney/dist`，只替换新构建产物，重启 `moneymoney.service`，不改 Nginx、TLS、VPN、系统环境和 Telegram 轮询所有权。
- [ ] **步骤 5：核对远端 `server.js`、`index.html` Hash，验证公网 HTTPS、健康接口、Guest GET 200、Guest 写入 403 和真实浏览器作用域矩阵。
- [ ] **步骤 6：任一发布门失败时恢复备份并重启服务；发布报告必须分别列出 GitHub、VPS、浏览器和回滚状态。

## 执行顺序

1. 轨道 A 的任务 1–3：先解决数据状态和加载阻塞。
2. 轨道 B 的任务 4–5：再打通详情、筛选、比较和候选。
3. 轨道 C 的任务 6–7：随后升级回测和模拟组合。
4. 轨道 D 的任务 8–10：最后接通 AI、Telegram、提醒和市场专属深度。
5. 任务 11–12：统一验收、审查、推送和发布。

每条轨道结束后单独构建、测试和审查；只有四条轨道都通过作用域回归和 Guest 权限测试，才合并为一个生产发布批次。
