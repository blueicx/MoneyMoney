# MoneyMoney 全工作区内容闭环实施计划

> **面向 AI 代理的工作者：** 使用 `superpowers:executing-plans` 在当前 worktree 内联执行；不得派遣子代理。按任务逐项测试、实现、验收和提交。

**目标：** 在四市场和共用的 30 个工作区中，补齐真实数据、可解释状态、功能区边界和可追溯操作链。

**架构：** 保留 `market-workspace.ts` 作为导航/市场范围注册表，复用现有数据 Provider、SQLite/数据湖、图表与研究服务。前端工作区通过现有 `dashboard-runtime.js` 和按需模块渲染；新增功能先复用 API，仅对缺少语义明确的接口做最小增量。

**技术栈：** TypeScript、Node.js `node:test`、JSDOM、现有 Express 路由、Chromium/Playwright；不新增运行时依赖。

**设计规格：** `docs/superpowers/specs/2026-10-12-all-workspaces-content-closure-design.md`

---

## 文件与职责

- 修改 `src/features/market-workspace.ts`：市场工作区 ID、导航和市场范围的唯一注册入口；仅在审计证明必要时修改。
- 修改 `src/web/public/modules/dashboard-runtime.js`：当前市场/工作区上下文、内容显隐、标的加载及旧响应保护。
- 修改 `src/web/server.ts`：现有工作区数据路由和 Provider 接线；保持接口兼容和权限边界。
- 修改对应 `src/features/*.ts`：市场数据质量、事件/历史、模拟账本或研究领域逻辑；每次只改当前批次涉及模块。
- 修改 `src/web/public/index.html`、`src/web/public/modules/*.js`、`src/web/public/*.js`：相应工作区 UI 与按需加载；保留 B 版布局和三个主题。
- 扩展现有 `tests/*workspace*.test.cjs`、市场专项测试；需要新的独立逻辑时新建同名领域测试。
- 新增 `docs/audits/2026-10-12-workspace-capability-matrix.md`：记录 30 个工作区的真实 Provider、页面归属、数据状态、权限、已验证操作和明确缺口。

## 执行规则

- 每个领域先写失败测试并确认失败，再改最小实现。
- 先确认 Provider 的真实能力和来源语义；无数据时不得制造结果，也不得跨市场回退。
- 一个工作区的 UI 只加载自身内容；只读访客不得读私有工作区数据。
- 各批测试通过后提交该批。所有批次最终通过完整发布门槛后，再推送和部署当前 VPS。
- 数据库、数据湖、未跟踪文件和 `data/research.db` 不加入变更。

### 任务 1：建立工作区能力矩阵与内容所有权回归测试

**文件：**
- 创建：`docs/audits/2026-10-12-workspace-capability-matrix.md`
- 修改：`tests/workspace-exclusive-runtime.test.cjs`
- 修改：`tests/market-workspace-navigation.test.cjs`
- 可能修改：`src/web/public/modules/dashboard-runtime.js`（仅当新增的行为测试证明非总览工作区有未归属内容泄漏）

- [ ] **步骤 1：先为 30 个工作区增加完整导航及 UI 所有权测试**

测试遍历 `overview/stocks/options/crypto/prediction/watchlist` 的注册导航；对每项执行 `applyMarketScopeView()` 与 `applyWorkspaceView()`，要求可见的工作区面板同时匹配当前市场和当前工作区。要求总览卡片/摘要只在 `overview` 或规定的 `watchlist` 可见。

- [ ] **步骤 2：运行测试并记录真实失败**

运行：`node --test tests/market-workspace-navigation.test.cjs tests/workspace-exclusive-runtime.test.cjs`

预期：如果某市场的注册 ID 没有相应内容归属、或不相关总览内容泄漏，测试以具体市场/工作区/DOM ID 失败；否则测试通过并记录现有覆盖。

- [ ] **步骤 3：生成能力矩阵并修复已复现的归属缺陷**

矩阵每行对应一个唯一 `WorkspaceId`，列包含可用市场、页面/模块 owner、调用的现有 API/Provider、源状态表达、权限、主要跳转和现有测试。修复范围仅限失败行；对没有可靠来源的能力写明 `unsupported/unavailable` 及现有原因，不新增空入口。

- [ ] **步骤 4：运行工作区及市场隔离测试**

运行：`node --test tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs tests/workspace-canonical-selection.test.cjs tests/workspace-exclusive-runtime.test.cjs tests/market-scope-integration.test.cjs`

预期：全部通过；测试不得访问生产 API 或修改数据库。

- [ ] **步骤 5：提交能力矩阵与边界回归**

```powershell
git add docs/audits/2026-10-12-workspace-capability-matrix.md tests/workspace-exclusive-runtime.test.cjs tests/market-workspace-navigation.test.cjs src/web/public/modules/dashboard-runtime.js
git commit -m "test: cover all workspace content boundaries"
```

### 任务 2：股票工作区的事件证据与 13F/内部人时点链

**文件：**
- 修改：`src/web/server.ts`（现有股票覆盖、事件时间线及 SEC/13F 路由）
- 修改：`src/features/sec-edgar-client.ts`、`src/features/market-breadth.ts` 或对应既有 Provider（仅按能力矩阵确认的实际缺口）
- 修改：`src/web/public/modules/dashboard-runtime.js`、`src/web/public/professional-research.js` 或现有股票模块
- 测试：`tests/stock-insider-ui.test.cjs`、`tests/market-breadth-returns.test.cjs`、`tests/stock-api.test.cjs` 及新增股票领域测试

- [ ] **步骤 1：先写并运行失败测试**：覆盖事件的 `publishedAt/retrievedAt/sourceUrl`、CUSIP/CIK 未映射时不猜测身份、内部人股票与期权交易分型，以及 13F 仅比较相邻可比报告期。
- [ ] **步骤 2：用隔离夹具验证失败**：运行 `node --test tests/stock-insider-ui.test.cjs tests/market-breadth-returns.test.cjs tests/stock-api.test.cjs`；预期新增断言先失败且不读取真实账户数据。
- [ ] **步骤 3：实现最小修复**：复用现有 SEC/事件 Provider；事件证据可定位到同一股票的 K 线日期、研究和日记；在身份或历史不足时返回明确原因。
- [ ] **步骤 4：复测股票与市场隔离**：运行上述专项测试及 `node --test tests/market-scope-integration.test.cjs tests/guest-mode.test.cjs`；预期通过且访客权限不扩大。
- [ ] **步骤 5：提交股票批次**：`git add` 仅涉及文件；提交信息 `feat: close stock workspace evidence loop`。

### 任务 3：期权工作区的报价质量与真实快照对照

**文件：**
- 修改：`src/features/options-market.ts`、`src/features/contract-panel-history.ts`、`src/web/server.ts`
- 修改：现有期权工作区模块及 `src/web/public/trading-chart.js`（只在图表需要显示快照时）
- 测试：`tests/options-market-quality.test.cjs`、`tests/contract-panel-history.test.cjs`、`tests/contract-ui.test.cjs`、`tests/options-backtest.test.cjs`

- [ ] **步骤 1：先增加失败测试**：相同完整合约身份/来源/口径才可比较；缺 bid/ask、时间、乘数或到期字段时不给可成交成本或到期损益；稀疏历史不得插值。
- [ ] **步骤 2：运行专项测试确认失败**：`node --test tests/options-market-quality.test.cjs tests/contract-panel-history.test.cjs tests/contract-ui.test.cjs tests/options-backtest.test.cjs`。
- [ ] **步骤 3：实现报价质量、快照覆盖与差异原因**：保留原来源、时间和分区缺口，输入不达门槛时返回不可用，不影响其他市场。
- [ ] **步骤 4：运行期权和访客隔离测试**：执行任务 3 专项测试及 `node --test tests/market-scope-integration.test.cjs tests/guest-mode.test.cjs`。
- [ ] **步骤 5：提交期权批次**：提交信息 `feat: improve options workspace evidence`。

### 任务 4：虚拟币工作区同源合约历史与时间序列

**文件：**
- 修改：`src/features/funding-carry.ts`、`src/features/contract-panel-history.ts`、`src/features/contract-research.ts`、`src/web/server.ts`
- 修改：`src/web/public/contracts-workspace.js` 与现有虚拟币工作区模块
- 测试：`tests/contract-metrics-history.test.cjs`、`tests/contract-workspace.test.cjs`、`tests/contract-chart.test.cjs`、`tests/contract-ui.test.cjs`

- [ ] **步骤 1：先增加失败测试**：跨交易所/产品类型/单位的数据不能比较；实时快照、归档历史与盘口快照状态分开；缺口不得插值。
- [ ] **步骤 2：运行专项测试确认失败**：`node --test tests/contract-metrics-history.test.cjs tests/contract-workspace.test.cjs tests/contract-chart.test.cjs tests/contract-ui.test.cjs`。
- [ ] **步骤 3：实现同源历史覆盖与界面证据**：只扩展现有真实 Provider，明确数据频率、抓取时间、单位和缺口；保留当前币种和合约身份。
- [ ] **步骤 4：复测四市场隔离及实时图表**：运行任务 4 专项测试与 `npm run smoke:live-kline`。
- [ ] **步骤 5：提交虚拟币批次**：提交信息 `feat: deepen crypto contract workspace history`。

### 任务 5：预测市场事件身份、规则与结算结果链

**文件：**
- 修改：`src/features/prediction-radar.ts`、`src/features/prediction-history.ts`、`src/features/prediction-settlement.ts`、`src/web/server.ts`
- 修改：`src/web/public/modules/dashboard-runtime.js` 或既有预测市场工作区模块
- 测试：`tests/prediction-settlement.test.cjs`、`tests/forecast-horizon.test.cjs`、`tests/prediction-library-timeout-smoke.cjs` 对应测试及新增领域测试

- [ ] **步骤 1：先增加失败测试**：YES/NO 身份、平台事件 ID、规则版本、截止时间和官方结算证据保持绑定；公布、平台结算、争议和来源失败不合并成单一状态。
- [ ] **步骤 2：运行专项测试确认失败**：`node --test tests/prediction-settlement.test.cjs tests/forecast-horizon.test.cjs`。
- [ ] **步骤 3：实现状态与证据链**：复用当前来源和通知状态，不用市场概率或截止时间倒计时冒充结果；修订必须保留旧值、新值和证据。
- [ ] **步骤 4：运行预测市场及访客测试**：运行任务 5 专项测试、`node --test tests/guest-mode.test.cjs tests/market-scope-integration.test.cjs`。
- [ ] **步骤 5：提交预测市场批次**：提交信息 `feat: improve prediction workspace settlement evidence`。

### 任务 6：共用研究、组合、自选和模拟持仓血缘

**文件：**
- 修改：`src/features/workspace-experience.ts`、`src/features/action-center.ts`、`src/features/portfolio-attribution.ts`、`src/features/decision-intelligence.ts`、相关 repository/router
- 修改：`src/web/server.ts` 与 `src/web/public/action-research-workspace.js`、`src/web/public/practical-experience.js` 或相应公共工作区模块
- 测试：`tests/workspace-experience.test.cjs`、`tests/action-center.test.cjs`、`tests/portfolio-data-integrity.test.cjs`、`tests/portfolio-attribution.test.cjs`、`tests/decision-intelligence.test.cjs`、`tests/research-workspace.test.cjs`

- [ ] **步骤 1：先增加失败测试**：相同市场/标的/数据快照可追溯；无基准/汇率/历史时不得填 0；无历史血缘的订单或信号显示未关联；私人信息对访客不可见。
- [ ] **步骤 2：运行共用模块测试确认失败**：`node --test tests/workspace-experience.test.cjs tests/action-center.test.cjs tests/portfolio-data-integrity.test.cjs tests/portfolio-attribution.test.cjs tests/decision-intelligence.test.cjs tests/research-workspace.test.cjs`。
- [ ] **步骤 3：实现跨工作区跳转和数据缺失语义**：复用 ID 与快照引用；动作必须有真实目标路由；禁止自动创建订单或修改策略晋级状态。
- [ ] **步骤 4：运行完整私有数据与市场隔离测试**：执行任务 6 专项测试及 `node --test tests/guest-mode.test.cjs tests/market-scope-integration.test.cjs tests/telegram-market-scope.test.cjs`。
- [ ] **步骤 5：提交公共工作区批次**：提交信息 `feat: connect shared research workspace lineage`。

### 任务 7：主题、手机、性能与发布矩阵

**文件：**
- 修改：仅涉及本计划的 `src/web/public/modules/*.css`、`src/web/public/*.css` 与按需模块
- 修改/扩展：`scripts/browser-market-matrix.cjs`、`scripts/workspace-experience-smoke.cjs`、对应主题/性能测试

- [ ] **步骤 1：补齐失败浏览器断言**：四市场适用菜单、区域边界、来源状态、返回上下文、访客权限及 3 个主题；桌面和 390px 手机视口。
- [ ] **步骤 2：运行 Chromium 确认失败**：`npm run smoke:browser` 与 `npm run smoke:experience`。
- [ ] **步骤 3：修复本计划引入的布局/加载回归**：不得通过移除内容、关闭主题或跳过来源等待来规避失败；仅当前工作区加载必要模块。
- [ ] **步骤 4：执行发布门槛**：`npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run security:scan`、`git diff --check`。
- [ ] **步骤 5：提交总体验收记录**：提交信息 `docs: record all-workspace closure acceptance`。只有验收全部通过后才推送、备份并部署；部署前后核对构建 Hash、健康接口、正式域名和回滚目录，仅操作 `moneymoney.service`。

## 计划自检

- 规格七个批次分别对应本计划任务 1–7；数据可信、市场隔离、访客只读、工作区边界、主题/移动端和发布要求均有测试或验收任务。
- 领域测试使用既有测试文件和接口；预测市场 smoke 文件不交给 `node --test`，由其既有 npm 脚本执行。
- 工作区 IDs 以 `src/features/market-workspace.ts` 为准；当前分支中的 `data/research.db` 始终保持未跟踪并排除在 add/backup/deploy 操作之外。
