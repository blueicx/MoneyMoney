# 独立功能工作区扁平面板实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让已选中的独立功能工作区直接完整展开，去掉中间功能面板的外框、背景和折叠箭头，同时保留内部数据框、总览页折叠和左侧导航收起功能。

**架构：** 继续复用 `src/web/public/index.html` 中现有的市场作用域与工作区可见性状态。`applyWorkspaceView()` 在独立工作区选中当前面板时增加统一的 `workspace-panel-flat` 展示类并强制保持打开；CSS 只扁平化顶层 `details`，内部数据卡不受影响。总览页不满足独立工作区条件，因此继续使用原来的折叠样式。

**技术栈：** TypeScript/Node.js 构建链、单页 HTML/CSS/JavaScript、Node `node:test`、现有 Web smoke 与浏览器验收流程。

---

## 文件清单

- 修改：`src/web/public/index.html` — 增加独立工作区顶层面板的扁平样式、状态类和不可折叠行为。
- 修改：`tests/market-workspace-flow.test.cjs` — 增加跨市场独立工作区面板的扁平展示回归测试。
- 修改：`docs/handover-2026-09-10.md` — 实现和发布完成后记录提交、测试、远端备份、服务和浏览器验收证据；不记录密钥或完整连接串。

## 任务 1：先写独立工作区扁平面板的失败测试

**文件：**

- 修改：`tests/market-workspace-flow.test.cjs`
- 参考：`src/web/public/index.html` 中 `applyWorkspaceView()`、`.dash-collapse` 和各市场 `data-workspace-id` 面板

- [ ] **步骤 1：增加行为断言**

增加一个独立测试，断言 CSS 和工作区行为契约：

```js
test('独立功能面板在选中后扁平展示并保持展开', () => {
  assert.match(html, /\.dash-collapse\.workspace-panel-flat[\s\S]*border:\s*0/);
  assert.match(html, /\.dash-collapse\.workspace-panel-flat[^}]*background:\s*transparent/);
  assert.match(html, /\.workspace-panel-flat > summary[^}]*pointer-events:\s*none/);
  assert.match(html, /workspace-panel-flat[^}]*collapse-chevron[^}]*display:\s*none/);
  assert.match(html, /classList\.toggle\(['"]workspace-panel-flat['"],\s*flatPanel\)/);
  assert.match(html, /if \(flatPanel\) node\.open = true/);
  for (const id of ['breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest', 'option-chain', 'volatility', 'greeks', 'funding-rate', 'open-interest', 'on-chain', 'order-flow', 'prediction-radar']) {
    assert.match(html, new RegExp(`data-workspace-id="${id}"`));
  }
});
```

- [ ] **步骤 2：运行测试确认它因功能缺失而失败**

运行：`node --test tests/market-workspace-flow.test.cjs`

预期：新增测试因源码尚未声明 `workspace-panel-flat` 样式和 `flatPanel` 状态而失败，现有同文件测试保持通过。

- [ ] **步骤 3：Commit 测试红灯**

```powershell
git add tests/market-workspace-flow.test.cjs
git commit -m "test: specify flat independent workspace panels"
```

## 任务 2：实现统一扁平面板展示与不可折叠行为

**文件：**

- 修改：`src/web/public/index.html` 的 `.dash-collapse` 后置主题覆盖样式区
- 修改：`src/web/public/index.html` 的 `applyWorkspaceView()`

- [ ] **步骤 1：增加顶层面板扁平样式**

在主题后置覆盖之后加入以下规则，确保它优先于原来的玻璃面板样式：

```css
.dash-collapse.workspace-panel-flat {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0;
  overflow: visible;
}
.dash-collapse.workspace-panel-flat > summary {
  min-height: 0;
  padding: 0 0 12px;
  cursor: default;
  pointer-events: none;
  background: transparent !important;
}
.dash-collapse.workspace-panel-flat > summary:hover {
  background: transparent !important;
}
.dash-collapse.workspace-panel-flat > summary .collapse-chevron {
  display: none;
}
.dash-collapse.workspace-panel-flat > .collapse-body {
  padding: 0;
}
```

标题和说明保留在扁平工具栏中；刷新按钮仍位于内容体内并可点击；内容体中的数据卡、表格和状态框不加 `workspace-panel-flat`，因此保留原有边框。

- [ ] **步骤 2：在工作区可见性流程中设置状态**

在 `applyWorkspaceView()` 节点循环中使用单一变量：

```js
const visible = scopeAllowsView(node.dataset.marketScopes) && workspaceAllowsView(node);
const flatPanel = exclusive
  && visible
  && node.matches('details.dash-collapse')
  && workspaceIdsForNode(node).includes(activeWorkspaceId);
node.hidden = !visible;
node.classList.toggle('workspace-hidden', !visible);
node.classList.toggle('workspace-panel-flat', flatPanel);
if (flatPanel) node.open = true;
if (!visible && node.tagName === 'DETAILS') node.open = false;
```

只有当前选中的独立面板扁平化；`activeWorkspaceId === 'overview'` 时不进入 `exclusive` 分支，原有总览折叠不变。切换工作区时，隐藏面板会移除扁平类，避免样式残留。

- [ ] **步骤 3：运行针对性测试确认变绿**

运行：`node --test tests/market-workspace-flow.test.cjs`

预期：同文件全部通过，新增测试能识别 CSS、箭头隐藏、选中面板强制 `open` 和跨市场工作区声明。

- [ ] **步骤 4：Commit 最小实现**

```powershell
git add src/web/public/index.html tests/market-workspace-flow.test.cjs
git commit -m "feat: flatten selected workspace panels"
```

## 任务 3：全量验证与浏览器验收

**文件：**

- 读取：`src/web/public/index.html`、`dist/web/public/index.html`
- 验证：`tests/*.test.cjs`、Web smoke、浏览器线上页面

- [ ] **步骤 1：重新构建并运行全量测试**

运行：

```powershell
npm run build
npm test
npm run smoke:web
npm run security:scan
git diff --check HEAD~2..HEAD
```

预期：构建退出码为 0，完整测试全部通过，Web smoke、安全扫描和 diff 检查均退出码为 0；记录实际通过/失败数。

- [ ] **步骤 2：检查源码与构建产物一致**

运行：

```powershell
Get-FileHash dist/web/server.js -Algorithm SHA256
Get-FileHash dist/web/public/index.html -Algorithm SHA256
Select-String -Path dist/web/public/index.html -Pattern 'workspace-panel-flat','pointer-events: none','collapse-chevron'
```

预期：`dist` 含有与源码相同的扁平面板规则和工作区状态逻辑；发布包不包含 `.env`、数据库、运行时状态或其他未跟踪文件。

- [ ] **步骤 3：浏览器逐类验收**

检查股票内部人、机构、分析师、基本面、空头、市场宽度，期权链，虚拟币资金费率/未平仓量，以及回测、分析、风险、自选和持仓：

```js
({
  flat: document.querySelectorAll('details.workspace-panel-flat').length,
  visibleFlat: [...document.querySelectorAll('details.workspace-panel-flat')]
    .filter(node => !node.hidden && getComputedStyle(node).display !== 'none').length,
  arrows: [...document.querySelectorAll('details.workspace-panel-flat .collapse-chevron')]
    .filter(node => getComputedStyle(node).display !== 'none').length,
  open: [...document.querySelectorAll('details.workspace-panel-flat')]
    .every(node => node.open),
})
```

预期：当前选中的独立面板 `visibleFlat=1`、`arrows=0`、`open=true`；内部数据框仍可见；切换标的后仍在同一功能工作区。进入总览后，顶层模块仍可折叠；左侧功能区仍可收起/恢复。

- [ ] **步骤 4：Commit 交接记录**

在 `docs/handover-2026-09-10.md` 追加本轮日期、实现提交、测试结果、浏览器验收结果和发布备份路径，不写入 Token、密码、Cookie、私钥或完整连接串：

```powershell
git add docs/handover-2026-09-10.md
git commit -m "docs: record flat workspace panel verification"
```

## 任务 4：GitHub 与 VPS 发布

**文件：**

- 发布：仅构建产物 `dist/`
- 远端目录：`/opt/moneymoney/dist`
- 服务：`moneymoney.service`

- [ ] **步骤 1：推送已审查提交**

```powershell
git push origin codex/stock-free-data-sources
```

预期：远端分支指向本轮最新实现提交；不推送用户现有未跟踪的 `docs/notes/`、Antigravity 计划文件或 `tests/kline-upgrade.test.cjs`。

- [ ] **步骤 2：上传唯一 dist 归档**

创建带最新提交号的临时 `dist` 归档并上传到 VPS `/tmp`，上传前记录归档 SHA-256；归档只包含 `dist` 内容，不包含仓库根目录、`.env`、数据库和密钥文件。

- [ ] **步骤 3：备份、替换并重启**

远端先把当前 `/opt/moneymoney/dist` 复制到 `/opt/moneymoney/backups/dist-<commit>-<timestamp>`，再解包到精确 staging 目录，验证 `web/server.js` 和 `web/public/index.html` 存在，停止并替换 `dist`，恢复 `moneymoney:moneymoney` 属主，重启 `moneymoney.service`。不修改 Nginx、TLS、VPN、系统环境和 Telegram 轮询所有权。

- [ ] **步骤 4：发布后验证**

轮询直到 `systemctl is-active moneymoney.service` 为 `active` 且 `curl -fsS http://127.0.0.1:3001/api/health/live` 返回 `ok=true`；核对远端两个关键文件 SHA-256 与本地 `dist` 一致，再刷新线上浏览器验证独立面板无外框/箭头且总览折叠未受影响。

- [ ] **步骤 5：Commit 发布记录**

把 GitHub 提交、VPS 备份目录、远端哈希、服务状态和线上验收结果追加到交接文档并提交；如任一发布门失败，保留备份并按精确回滚目录恢复，不删除用户数据。

## 需求覆盖检查

- 独立功能直接展开：任务 2 步骤 2、任务 3 步骤 3。
- 中间外框、背景和箭头移除：任务 2 步骤 1。
- 内部数据框保留：任务 2 步骤 1、任务 3 步骤 3。
- 股票、期权、虚拟币、预测及通用工作区统一处理：任务 1、任务 3 步骤 3。
- 总览和左侧导航保留折叠：任务 2 步骤 2、任务 3 步骤 3。
- 数据请求、市场隔离和错误状态不变：任务 2 的实现边界及任务 3 全量测试。
- GitHub/VPS 发布与可回滚：任务 4。
