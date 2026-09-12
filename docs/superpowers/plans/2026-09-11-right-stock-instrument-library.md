# 右侧股票标的库实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将七姐妹、搜索、自选和模拟持仓集中到股票页面右侧标的库，中间只保留当前股票研究功能并支持不离开工作区切换标的。

**架构：** 复用现有 `.sidebar` 与 `#stock-instrument-library`，在右侧渲染静态快捷标的、搜索结果和已有持仓列表。新增统一的当前工作区选股入口，根据 `activeWorkspaceId` 选择对应 loader；正文通过现有 `applyWorkspaceView()` 保持单一功能可见。

**技术栈：** 原生 HTML/CSS/JavaScript、Node `node:test`、Express 静态页面、Python Playwright。

---

### 任务 1：锁定右侧标的库契约

**文件：**
- 修改：`tests/market-workspace-flow.test.cjs`
- 参考：`src/web/public/index.html:2390-2570`、`src/web/public/index.html:2877-2908`

- [x] **步骤 1：编写失败的测试**

在现有工作区测试中加入以下断言，锁定右侧结构、中心去重和当前工作区选择路由：

```js
test('股票选择入口集中在右侧标的库并保持当前功能工作区', () => {
  assert.match(html, /id="stock-library-quick"/);
  assert.match(html, /id="stock-library-search-input"/);
  assert.match(html, /id="stock-library-search-results"/);
  assert.match(html, /selectStockFromInstrumentLibrary/);
  assert.match(html, /activeWorkspaceId === 'insider'/);
  assert.match(html, /activeWorkspaceId === 'institutional'/);
  assert.doesNotMatch(html, /id="stock-search-input"/);
  assert.doesNotMatch(html, /data-stock-radar-toolbar=/);
});
```

- [x] **步骤 2：运行测试验证失败**

运行：`node --test tests/market-workspace-flow.test.cjs`

预期：新增测试失败，因为右侧尚无七姐妹/搜索节点，中心仍存在旧选择工具栏。

### 任务 2：扩展右侧标的库并移除中心重复入口

**文件：**
- 修改：`src/web/public/index.html:1390-1415`
- 修改：`src/web/public/index.html:2375-2570`
- 修改：`src/web/public/index.html:2877-2908`

- [x] **步骤 1：在右侧标的库加入静态选择与搜索结构**

在 `#stock-instrument-library` 的自选列表之前加入以下结构，所有选择动作统一进入 `selectStockFromInstrumentLibrary`：

```html
<div class="stock-library-current" id="stock-library-current" aria-live="polite">
  <strong id="stock-library-current-symbol">AAPL</strong>
  <small id="stock-library-current-workspace">当前功能：市场总览</small>
</div>
<div class="stock-library-group">
  <div class="stock-library-group-title">📌 美股七姐妹</div>
  <div id="stock-library-quick" class="stock-library-grid" aria-label="美股七姐妹"></div>
</div>
<div class="stock-library-group">
  <label class="stock-library-search-label" for="stock-library-search-input">🔍 搜索股票</label>
  <div class="stock-library-search">
    <input id="stock-library-search-input" type="search" placeholder="代码或名称" aria-label="搜索股票代码或名称" oninput="stockLibrarySearchDebounce()" onkeydown="if(event.key==='Enter')loadStockLibrarySearch()">
    <button class="tab" type="button" onclick="loadStockLibrarySearch()">搜索</button>
  </div>
  <div id="stock-library-search-results" class="stock-library-search-results" aria-live="polite"></div>
</div>
```

- [x] **步骤 2：删除中心行情区和股票雷达里的重复选择控件**

删除 `#stocks-tab` 行情与选股中的 `.stock-symbol-selector`，删除五个 `data-stock-radar-toolbar` 容器及其搜索结果节点，保留每个雷达的刷新按钮和数据容器。中心不得再拥有 `stock-search-input`、`stock-radar-search-*` 或 `stock-radar-toolbar`。

- [x] **步骤 3：补充右侧库样式**

在现有股票库样式后加入紧凑的单列侧栏样式：快捷按钮使用 `.stock-library-item`，搜索输入占满宽度，搜索结果使用可聚焦按钮；移动端沿用既有 `.sidebar { display:none }` 策略，不引入第二套移动选择器。

### 任务 3：实现工作区感知的选股与搜索

**文件：**
- 修改：`src/web/public/index.html:5560-5785`
- 测试：`tests/market-workspace-flow.test.cjs`

- [x] **步骤 1：让测试先覆盖 loader 路由**

在契约测试中加入函数体断言，要求统一入口包含五个股票工作区 loader 和总览分支：

```js
test('右侧标的选择按当前股票工作区刷新对应数据', () => {
  assert.match(html, /function selectStockFromInstrumentLibrary\(/);
  for (const key of ['insider', 'institutional', 'analyst', 'fundamentals', 'short-interest']) {
    assert.match(html, new RegExp(`activeWorkspaceId === '${key}'`));
  }
  assert.match(html, /loadUnifiedStockData\(normalized\)/);
  assert.match(html, /setWorkspaceInstrument\(normalized\)/);
  assert.match(html, /stock-library-search-results/);
});
```

- [x] **步骤 2：运行新增测试确认仍为红灯**

运行：`node --test tests/market-workspace-flow.test.cjs`

预期：新增工作区路由测试失败，原因是 `selectStockFromInstrumentLibrary` 尚未定义。

- [x] **步骤 3：实现最小工作区感知入口**

按现有函数签名实现：规范化股票代码，写入 `window._stockSelectedSymbol` 和 `setWorkspaceInstrument()`，再按工作区调用一个 loader；只有 `overview` 调用行情/K 线，避免一次点击触发五个无关请求：

```js
function selectStockFromInstrumentLibrary(symbol, name, apiSymbol) {
  const normalized = String(symbol || '').replace(/^us/i, '').trim().toUpperCase();
  if (!stockInstrumentId(normalized) || activeMarketScope !== 'stocks') return;
  const displayName = name || stockNameForSymbol(normalized);
  window._stockSelectedSymbol = normalized;
  setWorkspaceInstrument(normalized);
  setStockSelectorActive(normalized);
  const loaders = { insider: loadInsiderRadar, institutional: loadInstitutionalOwnership, analyst: loadAnalystConsensus, fundamentals: loadFundamentalQuality, 'short-interest': loadShortInterest };
  if (loaders[activeWorkspaceId]) loaders[activeWorkspaceId](normalized, displayName);
  else { loadUnifiedStockData(normalized); loadStockKline('us' + normalized, displayName, apiSymbol); }
  updateStockLibraryCurrent(normalized, displayName);
}
```

- [x] **步骤 4：让右侧七姐妹、自选、持仓和搜索结果调用统一入口**

同时把常见七姐妹代码加入服务端本地搜索快速路径；访客仅新增股票库所需的 GET 读取白名单，写操作仍被拒绝。

新增 `renderStockLibraryQuick()`、`loadStockLibrarySearch()` 和 `selectStockLibrarySearchResult()`，修改 `selectStockLibraryItem()`、`loadStockWatchlistShortcuts()` 的按钮回调，调用 `selectStockFromInstrumentLibrary()`；搜索失败与空结果只写入 `#stock-library-search-results`。

- [x] **步骤 5：运行测试确认通过**

运行：`node --test tests/market-workspace-flow.test.cjs`

预期：工作区契约测试通过，现有测试无回归。

### 任务 4：接入加载生命周期与浏览器验收

**文件：**
- 修改：`src/web/public/index.html:9935-9955`、股票初始化调用点
- 创建：`tests/.stock-instrument-library-browser-smoke.py`

- [x] **步骤 1：在股票作用域加载右侧库，离开时隐藏**

让 `applySidebarScope()` 在股票作用域调用右侧快捷按钮渲染与 `loadStockInstrumentLibrary()`，并让 `applyMarketScopeView()` 后的当前标的摘要反映 `activeWorkspaceId`；切换到其他市场时隐藏整个库。

- [x] **步骤 2：用 Playwright 验证实际 DOM 和点击链路**

运行：`python tests/.stock-instrument-library-browser-smoke.py`

脚本必须验证：股票内部人页存在 `#stock-library-quick` 和 `#stock-library-search-input`；中心没有 `.stock-radar-toolbar`；点击 MSFT 后 URL 仍为 `market=stocks&workspace=insider`，仅内部人模块可见；搜索 AAPL 后点击结果仍保持 insider；切换 institutional 后同样保持；切换 crypto 后股票库隐藏。输出成功断言并保存截图到临时目录。

- [x] **步骤 3：删除一次性 smoke 脚本并保留测试证据**

浏览器验证通过后使用 `apply_patch` 删除 `tests/.stock-instrument-library-browser-smoke.py`，截图保留在系统临时目录，不进入 Git。

### 任务 5：完整验证、交接与发布

**文件：**
- 修改：`docs/handover-2026-09-11-left-sidebar-market-workspace.md`

- [x] **步骤 1：运行完整验证**

依次运行：

```powershell
npm run build
npm test
npm run security:scan
npm run smoke:web
git diff --check
```

预期：构建退出码 0，所有测试通过，安全扫描无敏感文件，web smoke 全部通过，diff check 无错误。

- [x] **步骤 2：记录交接证据**

更新交接文档，写入新 commit、测试数量、浏览器 smoke 核心断言、生成的 `dist` 关键文件 SHA-256、VPS 备份目录和回滚目录；不写入 token、密码、私钥或完整连接串。

- [x] **步骤 3：提交并推送 GitHub**

只暂存本次代码、测试和交接文档，保留用户已有的 `docs/antigravity-plans/2026-09-11-money-next-batch.md` 与 `docs/notes/` 不变：

```powershell
git add src/web/public/index.html tests/market-workspace-flow.test.cjs docs/handover-2026-09-11-left-sidebar-market-workspace.md docs/superpowers/specs/2026-09-11-right-stock-instrument-library-design.md docs/superpowers/plans/2026-09-11-right-stock-instrument-library.md
git commit -m "feat: move stock instrument selection to sidebar"
GIT_LFS_SKIP_PUSH=1 git push origin codex/stock-free-data-sources
git ls-remote origin refs/heads/codex/stock-free-data-sources
```

- [x] **步骤 4：仅部署生成的 dist 到 VPS**

构建后把 `dist` 直接内容上传到新的精确 staging 目录；远端先将当前 `/opt/moneymoney/dist` 备份到 `/opt/moneymoney/backups/dist-<sha>`，再移动到 `/opt/moneymoney/dist.rollback-<sha>`，替换 dist，修正 `moneymoney:moneymoney`，重启 `moneymoney.service`，轮询 active 和 `127.0.0.1:3001/api/health/live`。只清理本次精确 staging 目录，不修改 Nginx、TLS、VPN、Telegram token 或轮询归属。

- [x] **步骤 5：完成远端验收**

核对本地与远端 `dist/web/server.js`、`dist/web/public/index.html` SHA-256；检查公开页面包含右侧标的库标记，guest 读取股票工作区成功，guest 对 `/api/watchlist` 写入仍返回 403，健康接口返回 200；如失败，按备份目录回滚并记录实际状态。
