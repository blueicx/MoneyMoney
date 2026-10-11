# 网页性能与请求治理实施计划

> **执行约定：** 使用 `executing-plans` 技能；单代理完成，不改未跟踪的 `data/research.db`。所有行为变更先写测试并看到预期失败，再实现。

**目标：** 并行下载、顺序执行 dashboard 兼容脚本；合并首页两个调用点对股票指数的冷缓存上游请求；保留真实工作区懒加载与 API 兼容性。

**实现边界：** Node/TypeScript 既有栈，不新增依赖、数据库状态、接口或缓存体系。测试继续使用 Node test、已有 build 和真实 Provider Chromium 加载基准。

## Task 1：锁定启动脚本有序并行加载契约

**文件：** `tests/web-loading-recovery.test.cjs`、`scripts/copy-web-assets.js`

1. 更新现有 dashboard bootstrap 构建产物测试：保留认证及核心 runtime 等待断言；新增断言要求兼容脚本采用 `async=false` 并由单个 `Promise.all` 批量插入，断言旧的逐个 `await` 循环不存在；所有加载完成后才派发 `mm-dashboard-runtime-loaded`。
2. 先运行 `npm run build`（当前实现）及 `npm test -- tests/web-loading-recovery.test.cjs`，确认新断言因现有串行 loader 而失败。
3. 在 `scripts/copy-web-assets.js` 中把有序标志传给动态脚本加载函数，保持 runtime 本身的加载逻辑不变；用 `Promise.all(sources.slice(1).map(...))` 同批插入剩余脚本，依赖执行顺序不变。
4. 重跑构建和指定测试，确认 hashed/gzip/brotli 校验及现有懒加载断言均通过。

## Task 2：统一股票指数冷缓存加载

**文件：** `tests/web-loading-recovery.test.cjs`、`src/web/server.ts`

1. 增加源码契约测试：`dashboardStockIndices()` 和 `/api/stock/indices` 均使用同一个 `loadStockIndicesData()`；Tencent 指数请求仅位于该函数；该函数使用键 `stockIndices` 与现有 `getFreshExternal`/`CACHE_TTL`。
2. 先运行 `npm test -- tests/web-loading-recovery.test.cjs`，确认测试因共享函数尚不存在而失败。
3. 在 `server.ts` 增加一个共享 loader：通过 `getFreshExternal` 执行 Tencent 请求、解析、名称整理；驾驶舱 Provider 从共享数据构造自身 `DashboardProviderResult`，API route 继续返回 `{success:true,data}`，异常沿用原路径。
4. 重跑指定测试和 TypeScript 构建，确认两个入口都只接到同一缓存/单飞键且输出契约未变。

## Task 3：真实浏览器回归与性能比较

**文件：** `scripts/web-loading-benchmark.cjs`、`tests/web-loading-recovery.test.cjs`

1. 扩展已有基准输出：单独列出非 runtime/bootstrap 的 dashboard startup 兼容脚本请求数量、传输字节和资源请求跨度；保留现有冷/热与图表稳定指标。
2. 为新输出增加静态测试，并先运行测试确认缺少字段时失败。
3. 实现只读 `PerformanceResourceTiming` 汇总；不得拦截请求、改写 fetch、禁用缓存或访问真实交易/通知写接口。
4. 构建后分别设置 `MONEYMONEY_BENCHMARK_VIEWPORT=desktop` 和 `mobile`，各运行 `MONEYMONEY_BENCHMARK_RUNS=3 node scripts/web-loading-benchmark.cjs`。确认真实 K 线仍进入 `ready/empty/failed` 明确终态、兼容脚本下载同批启动且工作区懒加载和热缓存断言保持通过。

## 最终验证与发布

1. 运行 `npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run security:scan` 和 `git diff --check`。
2. 检查 diff 不包含数据库、数据湖、密钥、模拟跑单配置或非目标工作区文件。
3. 完整验收后才提交、推送 GitHub，并按既有备份/Hash/健康检查/回滚流程部署当前 VPS；只操作 `moneymoney.service`。
