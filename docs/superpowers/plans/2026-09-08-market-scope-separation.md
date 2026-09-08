# 市场作用域彻底隔离实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让分析、风险、持续信息和市场专属工具严格遵循当前市场，且将宏观入口移到通用工具栏。

**架构：** 复用现有 `MarketScope` 与 `filterAssistantReport`，增加统一的作用域过滤 seam；前端通过 `data-market-scopes` 控制分区并让每个异步加载器携带当前作用域；宏观作为通用 tab 独立呈现，首页保留跨市场汇总。

**技术栈：** TypeScript、Express、静态 HTML/JavaScript、Node `node:test`、PowerShell 7、Playwright 浏览器冒烟。

---

### 任务 1：补充服务端作用域过滤测试

**文件：**
- 修改：`tests/market-scope-view.test.cjs`
- 修改：`tests/market-scope-integration.test.cjs`
- 参考：`src/features/market-scope-view.ts`、`src/web/server.ts`

- [ ] **步骤 1：编写失败测试**

增加断言：非总体作用域的助手响应只保留当前市场的行动、提醒和风险相关集合；风险 overview 的 scope 请求不包含其他市场的 groups、actionSignals、radarWatchlist；无 scope 的旧请求仍保持总体返回。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test tests/market-scope-view.test.cjs tests/market-scope-integration.test.cjs`

预期：新增断言因当前风险响应仍保留混合集合而失败。

- [ ] **步骤 3：记录最小过滤接口**

在测试中使用当前项目已有的 `filterAssistantReport(report, scope)` 和 HTTP 路由约定，不新增第二套市场枚举。

### 任务 2：实现服务端风险和历史作用域

**文件：**
- 修改：`src/features/market-scope-view.ts`
- 修改：`src/web/server.ts`
- 修改：`src/features/risk-overview.ts`（仅在测试证明需要时）

- [ ] **步骤 1：过滤风险响应的市场专属数组**

让风险 overview 在 `stocks/options/crypto/prediction` 作用域下只使用对应的助手信号、提醒、主题和预测雷达；总体和自选保持既有兼容行为。

- [ ] **步骤 2：让风险历史、校准和导出接受 scope**

为 `/api/risk/history`、`/api/calibration` 以及相关导出路由解析合法 scope；按同一过滤 seam 过滤响应，非法或缺省 scope 回退总体。

- [ ] **步骤 3：运行目标测试确认通过**

运行：`node --test tests/market-scope-view.test.cjs tests/market-scope-integration.test.cjs`

预期：新增服务端过滤断言和原有作用域测试全部通过。

### 任务 3：补充前端分析、风险和持续信息回归测试

**文件：**
- 修改：`tests/market-scope-integration.test.cjs`
- 修改：`tests/market-scope-view.test.cjs`

- [ ] **步骤 1：编写失败测试**

断言源代码契约：分析卡片有明确 scope 标记；风险历史、校准、导出 URL 使用 `scopedUrl`；持续信息加载器不会在未初始化市场作用域前固定请求加密新闻；通用导航包含宏观入口。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test tests/market-scope-view.test.cjs tests/market-scope-integration.test.cjs`

预期：当前源码契约断言失败。

### 任务 4：实现前端市场分区和宏观通用入口

**文件：**
- 修改：`src/web/public/index.html`

- [ ] **步骤 1：给分析区加作用域声明**

将预测、币安、股票/ETF、行业、期权和外汇/商品/债券分析区分别标记为 `data-market-scopes`，并让当前作用域只渲染允许的区块；若区块没有数据，不显示对应空标题。

- [ ] **步骤 2：给风险区和导出操作加作用域**

风险页面的加载、风险历史、校准、主题、雷达和导出链接统一调用 `scopedUrl`；切换市场时使旧的异步结果失效。

- [ ] **步骤 3：拆出宏观通用 tab**

在 `UTILITY_NAV_ITEMS` 增加“宏观”，从市场专属导航中移除“宏观”；将宏观工作区的 DOM 与加载器绑定到独立 tab，并保留总体和通用宏观数据展示。

- [ ] **步骤 4：重写持续信息加载**

把 ticker 初始化放到 `activeMarketScope = readInitialMarketScope()` 之后；使用当前 scope 请求对应 ticker，切换市场时清空旧内容、更新作用域并忽略过期响应。没有对应源时隐藏或显示无数据提示。

- [ ] **步骤 5：运行目标测试确认通过**

运行：`node --test tests/market-scope-view.test.cjs tests/market-scope-integration.test.cjs`

预期：前端源码契约全部通过。

### 任务 5：完整验证与本地浏览器冒烟

**文件：**
- 无新增代码文件

- [ ] **步骤 1：运行完整测试**

运行：`npm test`

预期：所有测试通过，失败数为 0。

- [ ] **步骤 2：运行构建和格式检查**

运行：`npm run build`；`git diff --check`

预期：构建退出码 0，diff 检查无输出。

- [ ] **步骤 3：浏览器验证市场隔离**

使用本地服务和浏览器依次打开 `?market=stocks`、`?market=options`、`?market=crypto`、`?market=prediction`，分别进入分析和风险；确认页面文本不包含其他市场标题和 ticker，宏观入口只在通用工具栏。

- [ ] **步骤 4：核对工作区边界**

运行：`git status --short`。

预期：只看到本任务的已跟踪修改以及原有用户未跟踪文件，不暂存或删除用户文件。
