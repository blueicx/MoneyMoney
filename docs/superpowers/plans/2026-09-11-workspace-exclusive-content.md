# 工作区独占正文实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）来跟踪进度。

**目标：** 点击任一具体市场功能后，正文只显示该功能，其他功能仅保留在左侧入口。

**架构：** 在现有 `activeWorkspaceId` 和市场作用域状态之上增加 DOM 工作区过滤层。每个正文模块通过 `data-workspace-id` 声明归属，统一渲染函数同时检查市场和工作区；默认工作区显示当前市场完整模块集合。

**技术栈：** Express 静态 HTML、原生 JavaScript、Node `node:test`、Playwright 浏览器 smoke。

---

### 任务 1：先锁定独占正文行为

**文件：**
- 修改：`tests/market-workspace-flow.test.cjs`

- [ ] **步骤 1：编写失败测试**

增加静态断言，要求页面存在 `applyWorkspaceView`、`data-workspace-id`、默认工作区回退和非当前 `details` 关闭逻辑；现有页面尚无这些完整断言时测试应失败。

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
npm test -- tests/market-workspace-flow.test.cjs
```

预期：新增独占正文断言失败，原因是生产页面尚未实现工作区级过滤。

### 任务 2：给正文模块建立工作区标识

**文件：**
- 修改：`src/web/public/index.html`

- [ ] **步骤 1：标记现有模块**

为股票市场宽度、内部人、机构、分析师、基本面、空头等 `details` 增加与导航一致的 `data-workspace-id`；为期权、虚拟币、预测市场的具体模块补齐对应标识。宏观、新闻、日历等通用模块标记为 `overview` 或保留市场总览语义。

- [ ] **步骤 2：运行失败测试**

运行同任务 1 的定向测试，确认标识数量和关键标识断言仍准确，失败只允许来自渲染函数尚未接入。

### 任务 3：实现工作区级过滤

**文件：**
- 修改：`src/web/public/index.html`

- [ ] **步骤 1：实现过滤函数**

新增 `workspaceAllowsView()` 和 `applyWorkspaceView()`：`overview` 显示当前市场允许的模块；具体工作区只显示 `data-workspace-id` 等于当前值的模块，并关闭被隐藏的 `details`。

- [ ] **步骤 2：接入导航和市场切换**

在 `renderNavigationState()`、`setMarketScope()`、`restoreWorkspaceContextFromUrl()` 和 `openWorkspace()` 后调用过滤函数；不存在或跨市场工作区时回退到当前市场默认入口，并同步 URL。

- [ ] **步骤 3：运行定向测试确认通过**

运行：

```powershell
npm test -- tests/market-workspace-flow.test.cjs tests/theme-scoped-backtest.test.cjs
```

预期：独占正文、市场回退和已有主题/作用域测试通过。

### 任务 4：浏览器验证并发布

**文件：**
- 修改：`tests/market-workspace-flow.test.cjs`
- 修改：`docs/handover-2026-09-11-left-sidebar-market-workspace.md`

- [ ] **步骤 1：运行全量验证**

运行 `npm run build`、`npm test`、`npm run security:scan`、`npm run smoke:web` 和 `git diff --check`。

- [ ] **步骤 2：浏览器验证**

用本地 Chrome 验证股票内部人、机构、基本面和虚拟币资金费率：点击任一入口后正文只剩当前模块，左栏仍保留其他入口；返回总览后恢复当前市场模块。

- [ ] **步骤 3：提交并推送**

只提交本计划涉及文件，使用提交信息 `feat: isolate workspace content panels`，推送 `codex/stock-free-data-sources`。

- [ ] **步骤 4：重新构建并部署 VPS**

备份现有 `/opt/moneymoney/dist`，只替换应用 `dist`，校验关键文件 hash，重启 `moneymoney.service` 并保留回滚目录；不修改 Nginx、TLS、VPN、Token 或 Telegram 轮询所有权。

- [ ] **步骤 5：发布后核验并更新交接**

核验公网健康、工作区导航接口、访客读写边界和远端 hash；将新提交、备份目录、服务状态、测试结果及剩余边界写入交接文档。
