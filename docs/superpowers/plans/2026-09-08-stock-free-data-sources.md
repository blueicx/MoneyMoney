# 股票免费数据源扩展实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为股票市场增加无需 API Key 即可使用的 SEC EDGAR 与 Nasdaq 公共数据源，并统一缓存、降级、来源状态和股票市场隔离。

**架构：** 新增 SEC 客户端、Nasdaq 公共股票适配器和股票数据编排服务，所有远程请求通过现有 `ResilientDataSourceAdapter` 管理超时、重试、缓存和 stale 回退。服务器保留现有 `/api/stock/*` 接口，同时增加统一 `/api/stocks/:symbol/*` 入口；统一标的详情服务和网页只消费股票范围内的数据。

**技术栈：** TypeScript、Node 24 原生 `fetch`、Express、现有 `ResilientDataSourceAdapter`、Node 内置 `node:test`、SQLite 现有状态存储；不新增运行时依赖。

---

## 文件清单

**创建：**

- `src/features/stock-data-contracts.ts`：股票报价、K 线、财报、申报和来源状态的统一类型。
- `src/features/sec-edgar-client.ts`：SEC ticker directory、submissions、companyfacts 的请求和纯解析函数。
- `src/features/nasdaq-stock-source.ts`：Nasdaq 公共 quote/history 响应解析和 resilient 适配器。
- `src/features/stock-data-service.ts`：股票数据源编排、优先级、快照和失败隔离。
- `tests/sec-edgar-client.test.cjs`：SEC 目录、申报和 XBRL 解析测试。
- `tests/nasdaq-stock-source.test.cjs`：Nasdaq quote/history 解析和适配器状态测试。
- `tests/stock-data-service.test.cjs`：TTL、stale 回退、单源失败隔离和来源优先级测试。
- `tests/stock-api.test.cjs`：股票统一 API 注册、市场隔离和兼容接口测试。

**修改：**

- `src/features/fundamental-quality.ts`：复用 SEC 客户端和统一 User-Agent，保持现有财务质量评分输出不变。
- `src/features/insider-transactions.ts`：复用 SEC ticker/submissions 客户端，保持 Form 4 结果兼容。
- `src/features/unified-instruments.ts`：股票详情改用股票数据编排服务，避免直接请求单一 Tencent 源。
- `src/features/source-health.ts`：加入股票源状态，并支持股票范围过滤。
- `src/web/server.ts`：注册统一股票详情、财报、申报、来源状态接口，同时保留旧 `/api/stock/*` 路径。
- `src/web/public/index.html`：股票行情、K 线、财报和来源状态卡片显示来源/更新时间/降级状态。
- `docs/superpowers/specs/2026-09-08-stock-free-data-sources-design.md`：实现后补充实际接口和验收证据。

---

### 任务 1：建立股票数据契约和 SEC 客户端

**文件：**

- 创建：`src/features/stock-data-contracts.ts`
- 创建：`src/features/sec-edgar-client.ts`
- 创建：`tests/sec-edgar-client.test.cjs`
- 修改：`src/features/fundamental-quality.ts`
- 修改：`src/features/insider-transactions.ts`

- [ ] **步骤 1：编写会失败的纯解析测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSecTickerDirectory,
  parseSecSubmissions,
  parseSecCompanyFacts,
  buildSecHeaders,
} = require('../dist/features/sec-edgar-client');

test('SEC ticker directory normalizes CIK, ticker, title and exchange', () => {
  const rows = parseSecTickerDirectory({
    '0': { cik_str: 320193, ticker: 'aapl', title: 'Apple Inc.', exchange: 'Nasdaq' },
  });
  assert.deepEqual(rows, [{ cik: '0000320193', ticker: 'AAPL', title: 'Apple Inc.', exchange: 'Nasdaq' }]);
});

test('SEC submissions keeps recent filing rows aligned and filters malformed rows', () => {
  const result = parseSecSubmissions({
    name: 'Apple Inc.',
    filings: { recent: {
      form: ['10-K', '8-K', ''], accessionNumber: ['0001-23-000001', '0001-23-000002', ''], filingDate: ['2026-01-30', '2026-02-01', '']
    } },
  });
  assert.equal(result.companyName, 'Apple Inc.');
  assert.deepEqual(result.filings.map(item => item.form), ['10-K', '8-K']);
});

test('company facts selects latest annual USD values by tag', () => {
  const result = parseSecCompanyFacts({
    entityName: 'Example Inc.', facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { start: '2024-01-01', end: '2024-12-31', val: 100, form: '10-K', fp: 'FY', filed: '2025-02-01' },
        { start: '2025-01-01', end: '2025-12-31', val: 120, form: '10-K', fp: 'FY', filed: '2026-02-01' },
      ] } },
    } },
  });
  assert.equal(result.entityName, 'Example Inc.');
  assert.equal(result.annualFacts.Revenues[0].value, 120);
});

test('SEC headers identify MoneyMoney without exposing runtime secrets', () => {
  const headers = buildSecHeaders({ MONEYMONEY_SEC_USER_AGENT: 'MoneyMoney/1.0 (stock research; contact: test@example.com)' });
  assert.match(headers['User-Agent'], /^MoneyMoney\/1\.0/);
  assert.equal(Object.keys(headers).some(key => /key|token|secret/i.test(key)), false);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/sec-edgar-client.test.cjs`

预期：构建或测试失败，提示 `sec-edgar-client` 尚未导出解析函数。

- [ ] **步骤 3：实现统一契约和 SEC 纯函数/请求函数**

在 `stock-data-contracts.ts` 中加入以下契约：

```ts
import type { SourceSnapshot } from '../data/source-adapter';

export interface StockQuote { symbol: string; price: number; changePct: number | null; currency: string; asOf: string | null; }
export interface StockBar { time: number; open: number; high: number; low: number; close: number; volume: number | null; }
export interface StockFiling { form: string; accessionNumber: string; filingDate: string; primaryDocument?: string; reportUrl?: string; }
export interface StockCompanyFacts { symbol: string; cik: string; companyName: string; annualFacts: Record<string, Array<{ end: string; value: number; filed: string | null }>>; }
export interface StockDataBundle { symbol: string; quote: StockQuote | null; bars: StockBar[]; filings: StockFiling[]; fundamentals: StockCompanyFacts | null; snapshots: SourceSnapshot<unknown>[]; }
```

在 `sec-edgar-client.ts` 中实现 `buildSecHeaders`, `parseSecTickerDirectory`, `parseSecSubmissions`, `parseSecCompanyFacts` 和基于注入 `fetchImpl` 的 `fetchSecJson`。默认 User-Agent 使用 `MONEYMONEY_SEC_USER_AGENT`，为空时使用固定的 MoneyMoney 标识；请求只发送 `Accept` 和 `User-Agent`。

- [ ] **步骤 4：让已有 SEC 功能复用客户端**

删除 `fundamental-quality.ts` 和 `insider-transactions.ts` 内重复的 SEC User-Agent、ticker directory 和 JSON 请求实现，改为调用：

```ts
import { loadSecTickerDirectory, loadSecCompanyFacts, loadSecSubmissions } from './sec-edgar-client';
```

保留两个模块已有的公开函数、返回字段、评分规则和缓存 TTL；只替换传输层。

- [ ] **步骤 5：运行测试确认通过并提交**

运行：`npm run build; node --test tests/sec-edgar-client.test.cjs tests/source-adapter.test.cjs tests/event-calendar.test.cjs`

预期：新增 SEC 测试和现有源适配器/事件测试全部 PASS。

提交：`git add src/features/stock-data-contracts.ts src/features/sec-edgar-client.ts src/features/fundamental-quality.ts src/features/insider-transactions.ts tests/sec-edgar-client.test.cjs; git commit -m "feat: add shared SEC stock data client"`

### 任务 2：增加 Nasdaq 公共股票报价和历史行情适配器

**文件：**

- 创建：`src/features/nasdaq-stock-source.ts`
- 创建：`tests/nasdaq-stock-source.test.cjs`

- [ ] **步骤 1：编写会失败的响应解析和降级测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNasdaqQuotePayload, parseNasdaqHistoricalPayload, createNasdaqStockAdapters } = require('../dist/features/nasdaq-stock-source');

test('Nasdaq quote payload becomes a normalized stock quote', () => {
  const quote = parseNasdaqQuotePayload('AAPL', { data: { primaryData: { lastSalePrice: '$227.16', percentageChange: '+1.20%', lastTradeTimestamp: '09/08/2026 04:00 PM' } } });
  assert.deepEqual(quote, { symbol: 'AAPL', price: 227.16, changePct: 1.2, currency: 'USD', asOf: '09/08/2026 04:00 PM' });
});

test('Nasdaq historical rows are numeric, ordered and malformed rows are ignored', () => {
  const bars = parseNasdaqHistoricalPayload({ data: { tradesTable: { rows: [
    { date: '09/08/2026', close: '$227.16', open: '$225.00', high: '$228.00', low: '$224.50', volume: '1,000' },
    { date: 'bad', close: 'N/A', open: '', high: '', low: '', volume: '' },
  ] } } });
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0], { time: Date.parse('2026-09-08T00:00:00Z'), open: 225, high: 228, low: 224.5, close: 227.16, volume: 1000 });
});

test('Nasdaq adapter reports stale data after a later source failure', async () => {
  let calls = 0;
  const adapters = createNasdaqStockAdapters(async () => {
    calls += 1;
    if (calls > 1) throw new Error('network down');
    return { data: { primaryData: { lastSalePrice: '$227.16', percentageChange: '0%', lastTradeTimestamp: 'now' } } };
  });
  const fresh = await adapters.quote.fetch({ symbol: 'AAPL' });
  const stale = await adapters.quote.fetch({ symbol: 'AAPL' });
  assert.equal(fresh.status, 'fresh');
  assert.equal(stale.status, 'fresh');
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/nasdaq-stock-source.test.cjs`

预期：测试失败，提示 Nasdaq 解析器和适配器尚未导出。

- [ ] **步骤 3：实现解析器和适配器**

实现两个公开解析器，并使用现有 resilient 类：

```ts
export function createNasdaqStockAdapters(fetchImpl: NasdaqFetch = fetch) {
  const request = (path: string, signal: AbortSignal) => fetchImpl(`https://api.nasdaq.com/api/${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'MoneyMoney/1.0 stock research' },
    signal,
  });
  return {
    quote: new ResilientDataSourceAdapter<StockQuote>({ id: 'nasdaq-public-quote', group: '股票行情', ttlMs: 10 * 60_000, fetcher: async (input, signal) => { const symbol = String((input as any)?.symbol || '').toUpperCase(); const response = await request(`quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`, signal); if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`); return parseNasdaqQuotePayload(symbol, await response.json()); } }),
    bars: new ResilientDataSourceAdapter<StockBar[]>({ id: 'nasdaq-public-history', group: '股票行情', ttlMs: 15 * 60_000, fetcher: async (input, signal) => { const value = input as any; const response = await request(`quote/${encodeURIComponent(String(value.symbol).toUpperCase())}/historical?assetclass=stocks&fromdate=${encodeURIComponent(value.from)}&limit=100`, signal); if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`); return parseNasdaqHistoricalPayload(await response.json()); } }),
  };
}
```

解析器必须拒绝非有限价格、空日期和 `N/A` 数值；适配器不抛出给页面，失败交由 `SourceSnapshot` 表示。

- [ ] **步骤 4：运行测试确认通过并提交**

运行：`npm run build; node --test tests/nasdaq-stock-source.test.cjs tests/source-adapter.test.cjs`

预期：全部 PASS，并且构建输出 `Web assets copied to dist`。

提交：`git add src/features/nasdaq-stock-source.ts tests/nasdaq-stock-source.test.cjs; git commit -m "feat: add resilient Nasdaq stock source"`

### 任务 3：实现股票数据编排和统一详情入口

**文件：**

- 创建：`src/features/stock-data-service.ts`
- 创建：`tests/stock-data-service.test.cjs`
- 修改：`src/features/unified-instruments.ts`

- [ ] **步骤 1：编写会失败的服务测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { StockDataService } = require('../dist/features/stock-data-service');

function snapshot(id, data, status = 'fresh') { return { data, source: id, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), latencyMs: 3, status }; }

test('stock service returns quote, bars, filings and source snapshots independently', async () => {
  const service = new StockDataService({
    quote: { fetch: async () => snapshot('nasdaq-public-quote', { symbol: 'AAPL', price: 227.16 }) },
    bars: { fetch: async () => snapshot('nasdaq-public-history', [{ close: 227.16 }]) },
    filings: { fetch: async () => snapshot('sec-edgar-submissions', [{ form: '10-K' }]) },
    fundamentals: { fetch: async () => snapshot('sec-edgar-companyfacts', { companyName: 'Apple Inc.' }) },
  });
  const result = await service.overview('AAPL');
  assert.equal(result.symbol, 'AAPL');
  assert.equal(result.quote.price, 227.16);
  assert.equal(result.filings[0].form, '10-K');
  assert.equal(result.sources.every(item => item.status === 'fresh'), true);
});

test('one source failure does not erase successful stock cards', async () => {
  const service = new StockDataService({
    quote: { fetch: async () => snapshot('nasdaq-public-quote', { symbol: 'NVDA', price: 120 }) },
    bars: { fetch: async () => { throw new Error('history unavailable'); } },
    filings: { fetch: async () => snapshot('sec-edgar-submissions', []) },
    fundamentals: { fetch: async () => snapshot('sec-edgar-companyfacts', null, 'failed') },
  });
  const result = await service.overview('NVDA');
  assert.equal(result.quote.price, 120);
  assert.deepEqual(result.bars, []);
  assert.equal(result.sourceStatus['nasdaq-public-history'], 'failed');
});

test('non-stock symbols are rejected before any network adapter runs', async () => {
  const service = new StockDataService({ quote: { fetch: async () => { throw new Error('must not run'); } } });
  await assert.rejects(() => service.overview('crypto:binance:BTCUSDT'), /股票代码无效/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/stock-data-service.test.cjs`

预期：测试失败，提示 `StockDataService` 尚未导出。

- [ ] **步骤 3：实现服务和缓存策略**

服务公开接口固定为：

```ts
export class StockDataService {
  constructor(deps: StockDataDependencies = createDefaultStockDataDependencies()) {}
  async overview(symbolInput: string): Promise<StockDataBundle> {}
}
```

`overview` 规范化 `US` 前缀并拒绝非 `[A-Z][A-Z0-9.-]{0,9}` 的股票代码；使用 `Promise.allSettled` 并行读取 quote、bars、SEC submissions 和 companyfacts。缺失数据返回空数组或 null，源状态保留为 `failed`/`stale`，不让单个异常拒绝整个 bundle。服务自身的 bundle 缓存 TTL 为 60 秒，底层 quote 10 分钟、bars 15 分钟、SEC 12–24 小时。

- [ ] **步骤 4：接入统一标的详情**

在 `unified-instruments.ts` 的股票分支调用股票服务：

```ts
const stockData = await stockDataService.overview(normalized.symbol);
quote = stockData.quote;
klines = stockData.bars;
fetchedAt = stockData.quote?.asOf || stockData.sources.map(item => item.fetchedAt).filter(Boolean).sort().pop() || null;
sourceStatus.quote = stockData.sourceStatus['nasdaq-public-quote'] || 'unavailable';
sourceStatus.klines = stockData.sourceStatus['nasdaq-public-history'] || 'unavailable';
```

股票事件和新闻仍通过现有 `getUpcomingEventCalendar`/`newsFeed`，但合并时只保留股票作用域；加密资产和预测市场分支保持原逻辑不变。

- [ ] **步骤 5：运行测试确认通过并提交**

运行：`npm run build; node --test tests/stock-data-service.test.cjs tests/unified-instruments.test.cjs tests/unified-paper.test.cjs`

预期：全部 PASS。

提交：`git add src/features/stock-data-service.ts src/features/unified-instruments.ts tests/stock-data-service.test.cjs; git commit -m "feat: compose stock data sources"`

### 任务 4：注册股票 API 和股票范围来源健康

**文件：**

- 创建：`tests/stock-api.test.cjs`
- 修改：`src/web/server.ts`
- 修改：`src/features/source-health.ts`

- [ ] **步骤 1：编写接口契约测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('src/web/server.ts', 'utf8');
const sourceHealth = fs.readFileSync('src/features/source-health.ts', 'utf8');

test('server exposes unified stock endpoints while keeping legacy endpoints', () => {
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/overview'/);
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/filings'/);
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/fundamentals'/);
  assert.match(server, /app\.get\('\/api\/stocks\/:symbol\/source-health'/);
  assert.match(server, /app\.get\('\/api\/stock\/fundamentals\/:symbol'/);
});

test('source health exposes stock source groups without prediction-only items', () => {
  assert.match(sourceHealth, /nasdaq-public-quote/);
  assert.match(sourceHealth, /sec-edgar/);
  assert.match(sourceHealth, /requestedMarketScope|scope/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/stock-api.test.cjs`

预期：新接口和股票源状态标识尚未出现，测试失败。

- [ ] **步骤 3：增加 Express 路由并保持兼容**

在 `server.ts` 注册以下路由，所有 symbol 先经过 `normalizeStockSymbol`，错误返回 400，数据源整体失败返回 502，部分失败仍返回 `success: true` 和逐源状态：

```ts
app.get('/api/stocks/:symbol/overview', async (req, res) => {
  try { res.json({ success: true, data: await stockDataService.overview(String(req.params.symbol || '')) }); }
  catch (error: any) { res.status(502).json({ success: false, error: error?.message || '股票详情暂不可用', data: null }); }
});
app.get('/api/stocks/:symbol/filings', async (req, res) => {
  try { const data = await stockDataService.overview(String(req.params.symbol || '')); res.json({ success: true, data: { symbol: data.symbol, filings: data.filings, sources: data.sources } }); }
  catch (error: any) { res.status(502).json({ success: false, error: error?.message || '股票申报暂不可用', data: null }); }
});
app.get('/api/stocks/:symbol/fundamentals', async (req, res) => {
  try { const data = await stockDataService.overview(String(req.params.symbol || '')); res.json({ success: true, data: { symbol: data.symbol, fundamentals: data.fundamentals, sources: data.sources } }); }
  catch (error: any) { res.status(502).json({ success: false, error: error?.message || '股票公司事实暂不可用', data: null }); }
});
```

增加 `GET /api/stocks/:symbol/source-health`，只返回 bundle 中的 `nasdaq-public-*` 和 `sec-edgar-*` 快照；现有 `/api/stock/*` 路由继续调用原函数。

- [ ] **步骤 4：更新来源健康聚合**

让 `getSourceHealth` 合并股票服务最近快照，并增加 `scope=stocks` 过滤：股票范围只返回股票行情、SEC、Nasdaq 公共日历、StockAnalysis、CBOE 等股票相关项；预测、币安、加密新闻和天气项不出现在该范围。

- [ ] **步骤 5：运行测试确认通过并提交**

运行：`npm run build; node --test tests/stock-api.test.cjs tests/market-scope.test.cjs tests/market-scope-view.test.cjs tests/source-adapter.test.cjs`

预期：全部 PASS。

提交：`git add src/web/server.ts src/features/source-health.ts tests/stock-api.test.cjs; git commit -m "feat: expose scoped stock data APIs"`

### 任务 5：接入股票网页卡片和来源提示

**文件：**

- 修改：`src/web/public/index.html`

- [ ] **步骤 1：编写页面 wiring 测试**

在 `tests/stock-api.test.cjs` 追加：

```js
const html = fs.readFileSync('src/web/public/index.html', 'utf8');
test('stock UI requests unified stock data and renders source freshness', () => {
  assert.match(html, /\/api\/stocks\//);
  assert.match(html, /数据来源|来源状态/);
  assert.match(html, /nasdaq-public|sec-edgar/);
  assert.match(html, /activeMarketScope.*stocks|data-market-scopes="stocks/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/stock-api.test.cjs`

预期：统一股票接口和来源提示尚未接入页面，测试失败。

- [ ] **步骤 3：更新股票页面数据加载器**

在现有股票加载函数中以当前标的构造请求：

```js
async function loadUnifiedStockData(symbol) {
  if (activeMarketScope !== 'stocks' && activeMarketScope !== 'overview' && activeMarketScope !== 'watchlist') return null;
  const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}/overview`, { cache: 'no-store' });
  const payload = await response.json();
  if (!payload.success) throw new Error(payload.error || '股票数据暂不可用');
  return payload.data;
}
```

行情、K 线、财报卡片分别读取 bundle 对应字段；每张卡片在标题下显示 `source`、`fetchedAt` 和 `fresh/stale/failed` 中文状态。失败卡片显示“该数据源暂时不可用，其他股票数据仍可查看”，不渲染加密货币或预测市场字段。

- [ ] **步骤 4：验证市场作用域和缓存刷新**

切换到股票、期权、虚拟币、预测市场，确认只有股票作用域请求 `/api/stocks/*`；切换离开股票后，未完成的股票响应不得写入其他市场 DOM。刷新按钮使用 `?refresh=1` 或清除页面内存缓存，不修改服务端长期缓存 TTL。

- [ ] **步骤 5：运行页面 wiring、构建和完整测试并提交**

运行：`npm run build; npm test`

预期：`ℹ tests 105` 以上，`fail 0`；新增测试全部 PASS。

提交：`git add src/web/public/index.html tests/stock-api.test.cjs; git commit -m "feat: show stock source freshness in dashboard"`

### 任务 6：发布前验证、文档和可选源状态

**文件：**

- 修改：`docs/superpowers/specs/2026-09-08-stock-free-data-sources-design.md`
- 不提交：`.env`、API Key、实时数据库、`dist` 运行产物和 `better_sqlite3.node`

- [ ] **步骤 1：运行安全扫描和构建检查**

运行：`npm run security:scan; npm run build; npm test`

预期：安全扫描无凭据命中，构建成功，完整测试 `fail 0`。

- [ ] **步骤 2：验证可选 Nasdaq Data Link 未配置时的安全状态**

不写入 Key，验证 `/api/source-health?scope=stocks` 将可选增强源标记为 `unconfigured`，而 SEC 和 Nasdaq 公共源仍可用。若运行环境已有 `NASDAQ_DATA_LINK_API_KEY`，只验证状态为已配置，不在测试输出、日志或响应中回显值。

- [ ] **步骤 3：做本地 API 冒烟测试**

运行：`npm run start` 后使用独立 PowerShell 请求：

```powershell
Invoke-RestMethod 'http://127.0.0.1:3000/api/stocks/AAPL/overview'
Invoke-RestMethod 'http://127.0.0.1:3000/api/stocks/AAPL/source-health'
Invoke-RestMethod 'http://127.0.0.1:3000/api/source-health?scope=stocks'
```

预期：响应包含 `symbol=AAPL`、来源状态和更新时间；股票范围不包含 `binance`、`predict`、`crypto` 项。

- [ ] **步骤 4：补充设计文档证据并提交**

在设计文档中记录实际接口、缓存 TTL、测试数量、未配置可选源状态和失败降级结果；不记录任何 API Key、个人邮箱、Cookie 或服务器敏感信息。

提交：`git add docs/superpowers/specs/2026-09-08-stock-free-data-sources-design.md; git commit -m "docs: record stock data source verification"`

- [ ] **步骤 5：VPS 发布前备份并只重启 MoneyMoney**

发布动作必须在独立部署步骤执行：备份远端 `dist`，上传已验证的 `dist`，重启 `moneymoney.service`，然后检查服务状态和 HTTPS 股票页面。不得触碰 Nginx、证书、域名解析或 VPN；任何部署失败都保留备份并停止发布，不回滚用户未授权的其他改动。

## 计划自检

- 设计中的 SEC、Nasdaq 公共源、缓存 TTL、stale 降级、来源健康、统一股票 API、股票 UI、测试和发布边界分别由任务 1–6 覆盖。
- 计划未引入新运行时依赖，也没有把 API Key、个人邮箱、Cookie 或数据库文件写入仓库。
- `StockDataSnapshot` 使用现有 `SourceSnapshot` 字段；`StockDataService.overview(symbol)` 是任务 3 定义、任务 4/5 使用的唯一股票编排入口。
- 兼容旧 `/api/stock/*` 接口；统一接口只新增 `/api/stocks/:symbol/*`，股票作用域过滤不会改变加密和预测分支。
- 当前 worktree 基线：`npm run build` 通过，`npm test` 105/105 通过；隔离 worktree 复用了本机已有的 `better_sqlite3.node`，该二进制不会被提交。
