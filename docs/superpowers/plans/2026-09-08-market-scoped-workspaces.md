# 市场隔离功能区实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让顶部市场选择贯穿所有功能区，功能页面只呈现当前市场的数据。

**架构：** 用 `market-scope-view` 提供统一范围解析、资产类型归属和过滤函数；Express 接口接受可选 `scope` 并在输出层过滤，网页为每个区块声明允许范围、请求携带范围并丢弃过期响应。默认不带 `scope` 的旧 API 保持原行为。

**技术栈：** TypeScript、Express、原生 HTML/CSS/JavaScript、Node test runner。

---

### 任务 1：市场视图策略与失败测试

**文件：**
- 创建：`src/features/market-scope-view.ts`
- 创建：`tests/market-scope-view.test.cjs`

- [ ] **步骤 1：编写失败测试**

覆盖 `scopeAllowsSection`、`instrumentTypeForScope`、统一持仓/助手动作/提醒过滤，以及总体范围保留全量、自选范围保留多类资产。

- [ ] **步骤 2：运行测试确认失败**

运行 `npm run build; node --test tests/market-scope-view.test.cjs`；预期因模块不存在失败。

- [ ] **步骤 3：实现最少过滤模块**

导出范围策略和纯函数，不访问网络、数据库或环境变量。

- [ ] **步骤 4：运行测试确认通过**

运行 `npm run build; node --test tests/market-scope-view.test.cjs`；预期全部通过。

- [ ] **步骤 5：提交**

`git add src/features/market-scope-view.ts tests/market-scope-view.test.cjs && git commit -m "feat: add market scoped view filters"`

### 任务 2：后端统一接口范围过滤

**文件：**
- 修改：`src/web/server.ts`
- 修改：`src/features/market-scope.ts`
- 修改：`tests/market-navigation-wiring.test.cjs`

- [ ] **步骤 1：为接口范围参数添加失败断言**

断言 `/api/advisor`、`/api/risk/overview`、`/api/paper/portfolio`、`/api/backtest`、`/api/news`、`/api/alerts` 和 `/api/research` 的调用路径支持范围，并保持无范围兼容。

- [ ] **步骤 2：实现范围解析和输出过滤**

复用统一范围类型；对助手动作、风险信号、纸面持仓、研究记录和策略结果按标的类型过滤；无法归类的旧数据只在 `overview` 返回。

- [ ] **步骤 3：运行后端相关测试**

运行 `npm run build; node --test tests/market-scope-view.test.cjs tests/market-navigation-wiring.test.cjs tests/risk-overview.test.cjs tests/unified-paper.test.cjs`。

- [ ] **步骤 4：提交**

`git add src/web/server.ts src/features/market-scope.ts tests && git commit -m "feat: scope cross-market APIs"`

### 任务 3：网页区块和加载器按范围拆分

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`tests/market-navigation-wiring.test.cjs`

- [ ] **步骤 1：为网页范围隔离添加失败断言**

检查市场专属 `data-market-scopes`、范围过滤函数、请求令牌、旧响应保护，以及股票宏观页隐藏加密区块的标记。

- [ ] **步骤 2：实现区块声明和动态应用**

为股票、期权、虚拟币、预测市场、通用工具区块声明范围；市场切换时清空隐藏容器、更新标题和重置按范围缓存。宏观页中的稳定币、资金费率、BTC 链上、DeFi、加密新闻单独标成虚拟币区块。

- [ ] **步骤 3：让分析、风险、模拟、回测、新闻、提醒、研究和巨鲸加载器带范围**

所有 GET 请求通过统一 `scopeQuery()` 追加范围；渲染前检查 `marketScopeRequestToken()`，避免旧市场响应覆盖当前视图；对仅支持单一市场的区块显示明确的“当前市场不适用”。

- [ ] **步骤 4：运行网页 wiring 测试**

运行 `npm run build; node --test tests/market-navigation-wiring.test.cjs`；预期全部通过。

- [ ] **步骤 5：提交**

`git add src/web/public/index.html tests/market-navigation-wiring.test.cjs && git commit -m "feat: isolate web workspaces by market"`

### 任务 4：完整验证和发布

**文件：**
- 修改：`docs/handover-2026-09-02.md`

- [ ] **步骤 1：运行完整验证**

运行 `npm run build; npm test; node scripts/secret-scan.cjs; git diff --check`。

- [ ] **步骤 2：执行浏览器验收**

在现有浏览器聊天窗口中切换股票、虚拟币、预测市场，分别打开宏观、分析和风险，确认页面不会出现其他市场区块。

- [ ] **步骤 3：备份并发布 VPS**

仅备份 `/opt/moneymoney/dist`、替换构建产物、重启 `moneymoney.service`，验证 `127.0.0.1:3001/api/health/live` 和 HTTPS；不修改 Nginx、证书或 VPN。

- [ ] **步骤 4：记录并提交发布结果**

在交接文档记录测试、远端备份路径和健康结果，不记录密钥、密码、私钥或完整连接串。
