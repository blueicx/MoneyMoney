# 股票 K 线首屏冷启动优化实现计划

> **面向 AI 代理的工作者：** 使用 `executing-plans` 技能在当前工作树内逐项实施；用户明确要求不使用子 agent。

**目标：** 让股票行情深链在认证后并行下载图表资源与 dashboard core，使首根图表更早可用，并提供可复测的关键阶段耗时证据。

**架构：** 对明确的股票行情深链，仅预载公开、内容哈希化的图表脚本，不提前执行它；脚本执行仍等待认证和 dashboard core。对下载、K 线请求、绘制增加仅在显式浏览器调试标记开启时记录的阶段标记；Chromium 基准可门控辅助 API 响应，证明图表不依赖它们完成。

**技术栈：** 原生浏览器脚本、TypeScript 生成构建、Node.js `node:test`、Playwright Chromium。

---

## 文件与职责

- 修改 `tests/web-loading-recovery.test.cjs`：验证股票图表资源在认证后、core 就绪前预载，但图表脚本直到 core 就绪才执行；验证非股票路由、共享快照和默认关闭的阶段追踪。
- 修改 `tests/stock-kline-recovery.test.cjs`：验证 K 线请求、响应解析和首轮绘制的阶段顺序。
- 修改 `src/web/public/modules/workspace-loader.js`：为股票行情深链启动图表脚本 preload，保留认证与执行门控，并标记工作区加载阶段。
- 修改 `src/web/public/modules/dashboard-runtime.js`：为 dashboard 启动、K 线请求和首轮绘制提供低开销阶段标记。
- 修改 `scripts/web-loading-benchmark.cjs`：输出阶段标记、图表资源和 K 线来源状态；增加可控门控辅助 API 的验收模式。
- 修改 `package.json`：增加跨环境可调用的 `smoke:chart-path` 命令，实际是否启用门控由进程环境变量控制。

## 任务 1：先写图表预载门控失败测试

**文件：** `tests/web-loading-recovery.test.cjs`

- [x] **步骤 1：扩展深链测试，明确预载与执行的区别**

在现有“显式工作区深链等待 auth 和 core”测试里，认证完成后检查存在 `link[rel="preload"][as="script"][data-workspace-preload="charts"]`，同时不得存在 `script[data-workspace-group="charts"]`；core 事件后才允许出现该 script。事件工作区、无工作区及带 `sharedWorkspace` 的路由不预载图表脚本。

测试关键断言：

```js
assert.deepEqual(afterAuth, { preload: ['charts'], scripts: [] });
assert.deepEqual(afterCoreReady, { preload: ['charts'], scripts: ['charts'] });
assert.deepEqual(await inspect('http://localhost/?market=stocks&workspace=events'), { preload: [], scripts: ['events'] });
```

- [x] **步骤 2：运行测试确认按预期失败**

运行：`node --test tests/web-loading-recovery.test.cjs`

预期：股票深链认证后缺少 charts preload，断言失败；失败原因应为预载行为缺失，而不是 JSDOM 或测试语法错误。

## 任务 2：实现安全的哈希资源预载

**文件：** `src/web/public/modules/workspace-loader.js`

- [x] **步骤 1：为公开脚本增加幂等 preload**

加入按资源 URL 去重的 `Set`。预载只创建 `<link rel="preload" as="script">`，不调用 `loadScript`、不执行代码；失败时移除预载节点，使 core 就绪后的普通脚本请求仍可重试。

```js
const preloadedScripts = new Set();
function preloadScript(group) {
  const src = modules[group];
  if (!src || preloadedScripts.has(src)) return;
  preloadedScripts.add(src);
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'script';
  link.href = src;
  link.dataset.workspacePreload = group;
  link.onerror = () => { link.remove(); preloadedScripts.delete(src); };
  document.head.append(link);
}
```

- [x] **步骤 2：仅在认证后并行预载匹配的股票深链**

`ensure('charts')` 在 `waitForDashboardAuth()` 后检查 URL：仅当 `market=stocks`、`workspace=stock-quotes` 且无 `sharedWorkspace` 时调用 `preloadScript('charts')`；随后仍等待 `waitForDashboardCore()`，然后按原顺序注入并执行脚本。其他市场和动态共享工作区不走此预载。

- [x] **步骤 3：运行聚焦测试确认通过**

运行：`node --test tests/web-loading-recovery.test.cjs`

预期：全部通过；股票图表资源仅预载一次，执行仍被 core-ready 门控。

## 任务 3：加入可选的首屏阶段标记

**文件：** `src/web/public/modules/workspace-loader.js`、`src/web/public/modules/dashboard-runtime.js`、`tests/web-loading-recovery.test.cjs`

- [x] **步骤 1：测试调试开关关闭时不写标记，开启时记录顺序**

以 JSDOM 执行 loader，启用 `window.__MM_PERFORMANCE_TRACE__ = true`；认证后、core 事件后依次检查 `performance` 标记 `moneymoney:auth-ready`、`moneymoney:chart-preload-start`、`moneymoney:dashboard-core-ready`、`moneymoney:chart-module-start`。调试开关关闭的默认场景不得写入 `moneymoney:` 标记。

- [x] **步骤 2：在 loader 与 dashboard runtime 添加静态阶段标记**

标记导航认证完成、chart preload 开始/完成、dashboard core 就绪、chart module 开始/完成、dashboard context 就绪、K 线请求开始/响应解析完成、首轮绘制完成。所有标记走同一个守卫：

```js
function markMmPerformanceStage(name) {
  if (window.__MM_PERFORMANCE_TRACE__ === true && window.performance?.mark) {
    window.performance.mark(`moneymoney:${name}`);
  }
}
```

不开启调试开关时不增加持久日志、不写用户数据，也不发送遥测。绘制标记必须放在 canvas 更新/绘制调用之后。

- [x] **步骤 3：运行单测确认阶段标记测试通过**

运行：`node --test tests/web-loading-recovery.test.cjs`

预期：所有阶段标记测试通过，标记顺序符合 preload 与执行门控。

## 任务 4：扩展 Chromium 基准与辅助接口门控验收

**文件：** `scripts/web-loading-benchmark.cjs`、`package.json`

- [x] **步骤 1：为基准增加可选门控**

新增环境变量 `MONEYMONEY_BENCHMARK_GATE_AUX=1`。启用时，Chromium route handler 暂停 `/api/stock/indices`、`/api/watchlist`、`/api/paper/positions` 的响应；图表达到 `ready/empty/failed` 后先采集状态，并验证至少一个已被门控的辅助响应在图表稳定时仍未完成，再释放所有门控。`finally` 必须释放已拦截请求，避免基准异常时挂起浏览器。

```js
const auxiliaryPaths = ['/api/stock/indices', '/api/watchlist', '/api/paper/positions'];
const pendingAuxiliaryReleases = [];
// Gate each matching route until the chart has settled; always release in finally.
```

- [x] **步骤 2：采集阶段和真实 K 线结果元数据**

基准通过 `page.addInitScript` 打开阶段追踪；每个样本返回阶段标记名称/相对时间、K 线哈希资源起止与传输字节、`/api/stock/kline` 的请求耗时/状态码/记录数/`dataStatus`/`source`/`reason`，以及辅助请求在图表稳定时是否仍待完成。不得记录持仓、自选内容、Cookie 或响应正文。

- [x] **步骤 3：运行现有测试确认基准脚本语法及构建命令通过**

运行：`node --check scripts/web-loading-benchmark.cjs` 和 `npm run build`

预期：Node 语法检查退出码为 0，生产构建成功并生成版本化资源。

## 任务 5：完整验证与交付

**文件：** 本计划中所有变更文件。

- [x] **步骤 1：运行测试和静态门槛**

运行：`npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run security:scan`、`git diff --check`

预期：所有命令退出码为 0，安全扫描无发现，差异检查无空白错误。

- [x] **步骤 2：跑真实 Chromium 冷/热基准和辅助接口门控**

运行（PowerShell）：`$env:MONEYMONEY_BENCHMARK_GATE_AUX='1'; $env:MONEYMONEY_BENCHMARK_RUNS='1'; npm run smoke:chart-path; Remove-Item Env:MONEYMONEY_BENCHMARK_GATE_AUX,Env:MONEYMONEY_BENCHMARK_RUNS -ErrorAction SilentlyContinue`

再以默认 3 组桌面/手机冷、热样本运行 `npm run smoke:chart-path`。预期：门控模式中股票 K 线先稳定，辅助接口响应仍被门控；真实来源模式输出阶段、来源状态和冷/热中位数。按设计稿相较基线目标验证冷图表可用中位数至少改善 20%，若波动或不达标如实报告，不夸大改善。

实测：门控模式确认 K 线响应为 Yahoo Finance、300 根、`live`，图表稳定时指数/自选/模拟持仓辅助响应仍待返回。阶段计时显示图表资源预载与 dashboard core 并行；完整冷/热基准通过，但端到端冷启动 20% 目标未被证明，Provider 响应波动是主要变量，因此不报告整体提速达标。

- [ ] **步骤 3：提交、推送和部署前复核**

确认 diff 只包含上述代码/测试/计划；`data/research.db` 仍为未跟踪且未暂存。代码、浏览器和安全验收全部通过后，提交并推送当前功能分支，再按既有备份、Hash、健康检查和回滚流程部署；只操作 `moneymoney.service`。

---

## 计划自检

- 规格里的关键路径预载、执行权限门控、失败重试、数据状态/缓存兼容、阶段计时、四市场隔离、冷/热实测和不触碰生产数据均有对应任务。
- 所有测试命令和失败/通过预期均明确；辅助 API 门控有 `finally` 释放要求。
- `preloadScript(group)`、`ensure(group)`、`markMmPerformanceStage(name)` 的名称在所有任务中一致；图表 bundle 始终在 core-ready 后执行。
