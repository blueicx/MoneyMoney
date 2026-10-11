# 认证后股票 K 线响应预取实现计划

> **面向 AI 代理的工作者：** 使用 `superpowers:executing-plans` 在当前 worktree 逐任务内联执行；用户明确不使用子 agent。步骤使用复选框跟踪进度。

**目标：** 在认证后的股票行情深链启动当前上下文的 K 线请求，并让图表复用该响应，减少启动阶段串行等待且不改变数据新鲜度或权限边界。

**架构：** `workspace-loader.js` 负责从明确的股票行情深链生成请求并持有一次性响应；`dashboard-runtime.js` 在确认当前标的、周期和普通行情上下文完全一致后消费响应。请求失败沿用现有失败状态；上下文变化会取消或丢弃预取，不使用旧数据。

**技术栈：** 原生浏览器 JavaScript、Node `node:test`、JSDOM、现有 Playwright Chromium 基准。

---

## 文件与职责

- 修改 `tests/web-loading-recovery.test.cjs`：覆盖预取的认证门控、URL 范围、周期解析、请求时序和工作区隔离。
- 修改 `tests/stock-kline-recovery.test.cjs`：覆盖预取响应单次消费、请求复用、失败/空响应、周期/标的竞态及旧响应丢弃。
- 修改 `src/web/public/modules/workspace-loader.js`：校验股票深链上下文；认证后发起同源 K 线请求；提供以精确请求 URL 为键的一次性响应交接 API；在路由上下文改变时取消待处理请求。
- 修改 `src/web/public/modules/dashboard-runtime.js`：从受信任深链应用受支持的初始股票周期；将 K 线 URL 构造集中到请求函数；先尝试消费匹配的预取响应，不匹配时走原有 fetch；周期变化时使旧预取失效。
- 修改 `scripts/web-loading-benchmark.cjs`：如现有事件/计时不能证明请求重叠和请求次数，增加仅用于基准的元数据，禁止记录自选、持仓、Cookie 或响应正文。

## 请求上下文约定

- 股票周期允许值固定为现有 UI 周期：`1m`、`5m`、`15m`、`1h`、`1d`、`3d`、`5d`、`60d`、`120d`、`1y`、`5y`。缺省为现有运行时默认值 `5m`；无效值回落到 `5m`。
- 只预取 `market=stocks&workspace=stock-quotes` 且有可规范化标的的非分享 URL。
- 有 `asOf`、`focusDate` 或 `date` 参数，或当前标的在 `localStorage` 中保存了 `moneymoney:kline-as-of:us<SYMBOL>` 时跳过预取，避免历史/指定交易日请求被普通图表响应替代。
- URL 预取和运行时请求必须构造完全相同的 `/api/stock/kline` URL，包括 `symbol`、`period`、`interval`、`adjustment=source` 与适用时的 `chartWindow=1`。
- 一次性交接 API 以完整请求 URL 精确匹配，响应最多消费一次，并向运行时返回可随图表 AbortSignal 取消的句柄。接口只传递响应对象/解析结果，不把行情写入 localStorage 或服务端缓存。

## 任务 1：先补 URL 与认证门控失败测试

**文件：** `tests/web-loading-recovery.test.cjs`

- [x] **步骤 1：为可测试的 workspace-loader harness 增加预取范围测试**

复用该文件现有 loader JSDOM harness，令 `fetch` 记录 URL 和 options。覆盖：股票行情页有合法 instrument 时可启动；没有 instrument、无效 instrument、其他市场、其他 workspace、分享页以及含 `asOf`/`focusDate`/`date` 或该标的保存的 asOf 时不启动。

```js
const loaderSource = fs.readFileSync('src/web/public/modules/workspace-loader.js', 'utf8')
  .replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules: { charts: '/assets/charts.js' }, styles: {} }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const requests = [];
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost/?market=stocks&workspace=stock-quotes&instrument=stock%3Aus%3AAAPL&timeframe=1d',
  runScripts: 'outside-only',
});
let resolveAuth;
dom.window.fetch = (url, options) => { requests.push([String(url), options]); return new Promise(() => {}); };
dom.window.mm_authReady = new Promise(resolve => { resolveAuth = resolve; });
dom.window.eval(loaderSource);
assert.equal(requests.length, 0, 'auth 未就绪前不得发 K 线请求');
resolveAuth({ loggedIn: true });
await settle();
const [url, options] = requests.find(([value]) => value.startsWith('/api/stock/kline'));
assert.equal(requests.filter(([value]) => value.startsWith('/api/stock/kline')).length, 1);
assert.equal(new URL(url, 'http://localhost').searchParams.get('period'), '1d');
assert.equal(options.credentials, 'include');
assert.equal(options.cache, 'no-store');
dom.window.close();
```

- [x] **步骤 2：运行聚焦测试，确认失败来自预取能力缺失**

运行：`node --test tests/web-loading-recovery.test.cjs`

预期：新断言失败，指出 auth 后没有 `/api/stock/kline` 预取；现有测试仍保持通过。

## 任务 2：实现认证后的精确上下文预取

**文件：** `src/web/public/modules/workspace-loader.js`、`tests/web-loading-recovery.test.cjs`

- [x] **步骤 1：实现纯 URL 上下文解析并通过失败测试**

从 `location.search` 解析 market/workspace/instrument/timeframe。标的必须通过与现有 `stockInstrumentId()` 相同的股票代码规则；允许周期使用任务“请求上下文约定”中的固定列表，缺省或非法值使用 `5m`。先检查 `sharedWorkspace`、历史定位参数和 `localStorage` 中该标的已保存的 asOf，再规范化标的并生成与当前普通图表一致的请求 URL。

```js
const stockKlinePeriods = new Set(['1m','5m','15m','1h','1d','3d','5d','60d','120d','1y','5y']);
function initialStockKlineRequest(search) {
  const params = new URLSearchParams(search);
  if (params.get('market') !== 'stocks' || params.get('workspace') !== 'stock-quotes'
      || params.has('sharedWorkspace') || ['asOf','focusDate','date'].some(key => params.has(key))) return null;
  const raw = String(params.get('instrument') || '').trim();
  if (!raw) return null;
  const symbol = raw.replace(/^stock:us:/i, '').replace(/^us/i, '').toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return null;
  try { if (localStorage.getItem(`moneymoney:kline-as-of:us${symbol}`)) return null; } catch {}
  const requestedPeriod = String(params.get('timeframe') || '5m').toLowerCase();
  const period = stockKlinePeriods.has(requestedPeriod) ? requestedPeriod : '5m';
  const query = new URLSearchParams({ symbol: `us${symbol}`, period, interval: period, adjustment: 'source' });
  if (['1m','5m','15m','1h','1d'].includes(period)) query.set('chartWindow', '1');
  return { symbol: `us${symbol}`, period, url: `/api/stock/kline?${query}` };
}
```

- [x] **步骤 2：添加一次性预取响应交接**

`window.MoneyStockKlinePrefetch` 提供 `start(url)`、`take(url)`、`invalidate()`。`start` 对同 URL 幂等，使用 `fetch(url,{credentials:'include',cache:'no-store',signal})`，保存单次 JSON 解析结果；将网络或 JSON 解析异常转换成 `{ok:false,status:0,body:null,error}`，以便当前匹配图表走现有失败状态而不是立即再请求一次。`take` 只在 URL 完全一致时移除并返回 `{promise, abort}`，运行时把自身 AbortSignal 绑定到 `abort`；`invalidate` 中止并清空未消费请求。

```js
const pendingStockKlines = new Map();
window.MoneyStockKlinePrefetch = {
  start(url) {
    if (pendingStockKlines.has(url)) return pendingStockKlines.get(url).promise;
    const controller = new AbortController();
    const promise = fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => ({ ok: response.ok, status: response.status, body: await response.json() }))
      .catch(error => ({ ok: false, status: 0, body: null, error }));
    const entry = { controller, promise };
    pendingStockKlines.set(url, entry);
    return entry.promise;
  },
  take(url) {
    const entry = pendingStockKlines.get(url);
    if (!entry) return null;
    pendingStockKlines.delete(url);
    return { promise: entry.promise, abort: () => entry.controller.abort() };
  },
  invalidate() {
    for (const entry of pendingStockKlines.values()) entry.controller.abort();
    pendingStockKlines.clear();
  },
};
```

预取只在 `ensure('charts')` 已等待 `waitForDashboardAuth()` 后启动，并且在等待 dashboard core 期间与核心启动并行。监听 `mm-workspace-context`：离开股票行情页或标的改变时失效；周期改变由图表运行时调用 `invalidate()`。不得在未认证时创建请求。

- [x] **步骤 3：运行 loader 测试确认通过**

运行：`node --test tests/web-loading-recovery.test.cjs`

预期：认证前为 0 次，认证后合格股票深链为 1 次，所有排除上下文仍为 0 次。

## 任务 3：让图表应用 URL 周期并消费同一请求

**文件：** `src/web/public/modules/dashboard-runtime.js`、`tests/stock-kline-recovery.test.cjs`、`tests/web-loading-recovery.test.cjs`

- [x] **步骤 1：补充运行时失败测试**

测试股票 K 线初始化读取有效 `timeframe`；非法值不会离开 `5m`。测试 loader 已预取的精确 URL 被图表只消费一次；周期或标的改变后不使用旧 Promise。

```js
assert.equal(await h.window.loadStockKline(), undefined);
assert.equal(fetchCalls.length, 0, 'matching prefetched response should prevent a duplicate fetch');
assert.equal(h.window.stockChartKlines[0].close, 11);
assert.equal(takeCalls.length, 1);
```

- [x] **步骤 2：将请求 URL 构造集中并读取预取结果**

新增一个纯函数 `stockKlineUrl(symbol, period, apiSymbol, state)`，用于构造现有 query。普通 K 线加载先计算 URL，再调用 `window.MoneyStockKlinePrefetch?.take(url)`；若返回 Promise，使用其中已解析的 `{ok,status,body}`，否则执行原始 `fetch(url,{signal})` 并解析 JSON。两路都进入同一 `requestRevision`、响应身份检查、来源状态、空/失败处理和渲染路径。

```js
const url = stockKlineUrl(currentStockSymbol, currentStockKlinePeriod, currentStockApiSymbol, {
  asOf: stockChartAsOf, intradayDate: stockChartIntradayDate,
  intradayPeriod: stockChartIntradayPeriod, adjustment: requestedAdjustment,
});
const prefetched = !live ? window.MoneyStockKlinePrefetch?.take(url) : null;
if (prefetched) controller.signal.addEventListener('abort', prefetched.abort, { once: true });
const outcome = prefetched
  ? await prefetched.promise
  : await fetch(url, { signal: controller.signal }).then(async response => ({ ok: response.ok, status: response.status, body: await response.json() }));
if (outcome.error) throw outcome.error;
if (!outcome.ok && outcome.body?.success) throw new Error('股票K线来源返回异常 HTTP 状态');
const d = outcome.body;
```

若 JSON 响应声明 `success:true`，必须校验 `market='stocks'`、`instrument` 与请求的 provider symbol 相同、`timeframe` 与周期相同；身份不匹配按来源失败处理。合法的 `success:false` JSON（包括 HTTP 4xx/422 的结构化错误）继续走现有空/失败状态并展示原有 `reason`，不可因 HTTP 状态码丢失来源原因。网络异常或 JSON 解析失败时将其交给现有 catch 状态路径；匹配的失败不立刻重复请求，保留手动重试。

- [x] **步骤 3：在 URL 恢复和工作区/周期改变时维护上下文**

在 `restoreWorkspaceContextFromUrl()` 中只对股票 `stock-quotes` 应用受支持的 `timeframe`，确保 `loadActiveWorkspaceInstrument()` 启动的图表周期与预取相同。`setStockKlinePeriod()` 在请求新周期前使未消费预取失效。为离开股票行情工作区增加上下文监听：递增 `stockKlineRequestRevision`、abort 当前 `stockKlineController` 并使未消费预取失效；标的切换仍由新 `loadStockKline()` 通过既有 request revision/AbortController 取消旧上下文。`loadStockKline()` 构造不同 URL 时只能消费精确匹配响应。

- [x] **步骤 4：运行 K 线聚焦测试确认单次请求与竞态安全**

运行：`node --test tests/stock-kline-recovery.test.cjs tests/web-loading-recovery.test.cjs`

预期：已有历史时点、空状态、股票切换迟到响应等测试通过；新测试证明相同 URL 只向服务端请求一次，变更上下文不显示旧响应。

## 任务 4：浏览器性能与全量验收

**文件：** `scripts/web-loading-benchmark.cjs`、`package.json`（仅在确需增加基准输出时修改）

- [x] **步骤 1：扩展基准以验证请求重叠与精确单次调用**

只有现有指标不足以验证时才添加字段。受控模式延迟 `/api/stock/kline` 响应，并记录它是否在 `dashboard-core-ready` 前启动、首次图表稳定前的请求计数及最终 `dataStatus`。不采集响应正文、账户/自选信息或密钥。

- [x] **步骤 2：运行受控 Chromium 验收**

运行：`$env:MONEYMONEY_BENCHMARK_RUNS='1'; npm run smoke:chart-path`

预期：股票行情深链在认证后、dashboard core ready 前启动 K 线 API；响应只请求一次并被图表消费。执行后删除临时环境变量。

- [x] **步骤 3：运行真实来源冷/热基准**

运行：`npm run smoke:chart-path`

桌面、手机各执行现有三轮冷/热配对。记录工作区就绪、K 线 API、图表稳定耗时、请求数、来源及数据状态；与当前分支同配置样本比较。外部 Provider 延迟单独报告，不宣称未经数据支持的固定提速。

- [x] **步骤 4：运行完整发布门槛**

运行：

```text
npm test
npm run build
npm run smoke:web
npm run smoke:auth
npm run smoke:browser
npm run smoke:live-kline
npm run security:scan
git diff --check
```

预期：所有命令退出码为 0；四市场隔离、访客权限、主题与实时 K 线不回归。保留未跟踪 `data/research.db`。验收通过后再提交、推送并依既有流程备份和部署，只操作 `moneymoney.service`，确认远端 Hash/健康/正式域名并保留回滚。

## 计划自检

- 规格的认证门控、精确上下文、周期恢复、一次消费、失效/取消、历史范围排除、空/失败语义和性能验收均映射到任务。
- `MoneyStockKlinePrefetch` 的 `start/take/invalidate` 名称在各任务中一致；运行时 URL 是两侧匹配的唯一请求键。
- 预取失败不会被当成成功，也不会触发隐式重复请求；上下文变化只使旧请求失效，新上下文仍走既有加载流程。
- 没有新增数据源、缓存策略、权限放宽、用户数据迁移或交易行为。
