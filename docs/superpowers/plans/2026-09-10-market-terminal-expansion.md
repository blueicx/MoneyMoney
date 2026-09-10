# MoneyMoney 同类能力吸收与性能优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [x]`）语法来跟踪进度。

**目标：** 在保持股票、期权、虚拟币、预测市场严格隔离和真实交易禁用的前提下，补齐市场专属筛选/比较、事件新闻提醒、模拟盘绩效解释和加载性能能力。

**架构：** 继续沿用现有 TypeScript + Express + SQLite `state_documents` 架构，新增小型领域模块和兼容路由，不重写现有大页面。所有筛选器、比较快照、提醒、事件证据和绩效分析都带 `scope` 或 `instrumentId`，服务端先隔离再聚合；前端以缓存优先、懒加载和过期状态展示降低首屏压力。

**技术栈：** Node.js 18+、TypeScript、Express、SQLite、原生 HTML/CSS/JS、Node test runner、Playwright 冒烟。

---

## 设计边界

- 市场范围固定为 `overview/stocks/options/crypto/prediction/watchlist`；市场专属字段不得跨 scope 出现在雷达、详情、提醒候选和大盘条。
- 继续支持股票/期权、虚拟币、预测市场三类模拟交易；真实交易和 AI 自动下单保持禁用。
- 访客只能 GET 公开数据；筛选模板、比较快照、提醒、模拟账本和审计写操作继续由管理员保护。
- 数据源失败时返回 `sourceStatus`、`freshness` 和可用的缓存结果；不以虚拟币数据填充股票/期权空数据。
- 不新增必须付费的供应商。CoinGlass/FRED 类源只做可选配置，免费源和现有适配器必须独立可运行。

## 文件清单与职责

- 创建：`src/features/market-screener.ts` —— 按 scope 定义字段白名单、筛选、排序、分页和模板模型。
- 创建：`src/features/instrument-compare.ts` —— 同市场比较、标准化字段和比较快照。
- 创建：`src/features/event-evidence.ts` —— 事件/新闻与标的的相关性、实际/预测/前值和来源证据。
- 修改：`src/features/unified-alerts.ts` —— 支持自选组规则、到期时间、摘要批次和投递审计。
- 修改：`src/features/risk-overview.ts`、`src/features/unified-paper-trading.ts` —— 基准、集中度、归因、费用/滑点和回撤恢复指标。
- 创建：`src/features/performance-cache.ts` —— ETag、条件请求、stale-while-revalidate 和请求预算的服务端辅助函数。
- 修改：`src/web/server.ts` —— 注册兼容的新 GET/POST 路由，所有写路由使用管理员鉴权，统一响应 freshness/sourceStatus。
- 修改：`src/web/public/index.html` —— 增加市场专属筛选、比较、证据/提醒摘要和性能埋点；重型区块按当前 tab 和 scope 懒加载。
- 创建：`tests/market-screener.test.cjs`、`tests/instrument-compare.test.cjs`、`tests/event-evidence.test.cjs`、`tests/performance-cache.test.cjs`。
- 修改：`tests/unified-alerts.test.cjs`、`tests/risk-overview.test.cjs`、`tests/unified-paper.test.cjs`、`tests/market-scope-integration.test.cjs`、`tests/guest-mode.test.cjs`。
- 修改：`docs/handover-2026-09-10.md` —— 只在所有验收通过后记录实际结果和剩余限制。

### 任务 1：市场专属筛选器

**文件：** 创建 `src/features/market-screener.ts`、`tests/market-screener.test.cjs`；修改 `src/web/server.ts`、`src/web/public/index.html`。

- [x] 步骤 1：先写失败测试，覆盖股票只能使用股票字段、虚拟币只能使用资金费率/OI 字段、预测市场只能使用 YES/NO/流动性字段；覆盖非法字段返回错误、排序稳定、分页不重复。

```js
const { createScreener, filterRows } = require('../dist/features/market-screener');
const screener = createScreener('stocks', [{ symbol: 'AAPL', changePct: 2, marketCap: 100 }]);
assert.deepEqual(screener.allowedFields, ['changePct', 'marketCap']);
assert.throws(() => filterRows('stocks', screener.rows, { fundingRate: { gte: 0 } }), /scope/);
```

- [x] 步骤 2：运行 `npm test -- --test-name-pattern=market-screener`，预期当前因模块不存在而失败。
- [x] 步骤 3：实现 `SCOPE_FIELDS` 白名单、数值/字符串过滤、稳定排序、`page/pageSize` 分页和模板序列化；模板只保存 `scope`、字段和条件，不保存运行时行情。
- [x] 步骤 4：注册 `GET /api/screener?scope=stocks|options|crypto|prediction` 和管理员专用 `GET/POST/DELETE /api/screener/templates`；空数据也返回字段定义、`rows: []`、`freshness` 和来源状态。
- [x] 步骤 5：在每个市场工作区加入筛选入口，切换 scope 时清空字段和结果；访客隐藏模板写按钮但可读取公开筛选结果。
- [x] 步骤 6：运行定向测试、`npm run build`、`npm test`，预期新增测试和原有测试全部通过。
- [x] 步骤 7：提交 `feat: 增加市场专属筛选器`。

### 任务 2：同市场详情比较和可复盘快照

**文件：** 创建 `src/features/instrument-compare.ts`、`tests/instrument-compare.test.cjs`；修改 `src/web/server.ts`、`src/web/public/index.html`。

- [x] 步骤 1：先写失败测试，验证股票只能和股票比较、期权只能和期权比较；比较输出包含价格、变化、数据时间和来源状态，缺失字段使用 `null` 而不是借用别的市场字段。

```js
const { compareInstruments } = require('../dist/features/instrument-compare');
assert.throws(() => compareInstruments([{ type: 'stock' }, { type: 'crypto' }]), /same market scope/);
assert.equal(compareInstruments([{ type: 'stock', symbol: 'AAPL', quote: { price: 1 } }])[0].quote.price, 1);
```

- [x] 步骤 2：运行 `npm test -- --test-name-pattern=instrument-compare`，预期失败。
- [x] 步骤 3：实现同 scope 校验、标准化字段、最多 6 个标的限制、生成时间和快照 ID；复用 `UnifiedInstrumentService`，不新增一套行情源。
- [x] 步骤 4：注册 `GET /api/instruments/compare?scope=...&ids=...` 与管理员 `POST /api/instruments/compare/snapshots`，访客只允许读取公开快照。
- [x] 步骤 5：把已有详情 overlay 扩展为“加入比较/移除/保存快照”，比较列表按当前市场持久化；切换市场时清空不兼容标的。
- [x] 步骤 6：运行定向测试、完整构建和浏览器冒烟，验证股票→虚拟币切换不会残留比较卡片。
- [x] 步骤 7：提交 `feat: 增加同市场标的比较工作台`。

### 任务 3：事件、新闻和自选组提醒

**文件：** 创建 `src/features/event-evidence.ts`、`tests/event-evidence.test.cjs`；修改 `src/features/unified-alerts.ts`、`src/web/server.ts`、`src/web/public/index.html`。

- [x] 步骤 1：先写失败测试，覆盖事件按 `instrumentId` 或 watchlist 组匹配、新闻按 scope/关键词匹配、实际/预测/前值方向、到期规则、同一事件只生成一条摘要和投递审计。

```js
const { buildEventEvidence } = require('../dist/features/event-evidence');
const evidence = buildEventEvidence({ scope: 'stocks', instrumentId: 'stock:us:AAPL', actual: '105', forecast: '100', previous: '98', source: 'official', url: 'https://example.invalid' });
assert.equal(evidence.direction, 'bullish');
assert.equal(evidence.scope, 'stocks');
```

- [x] 步骤 2：运行 `npm test -- --test-name-pattern=event-evidence|unified-alerts`，预期新增断言失败。
- [x] 步骤 3：扩展 `UnifiedAlertRule`：增加 `scope`、`watchlistId`、`expiresAt`、`digestMinutes`；兼容旧的单标的规则并在读取时补默认值。
- [x] 步骤 4：实现事件/新闻 relevance、来源 URL、实际/预测/前值和结果方向；摘要去重键必须包含规则、事件/新闻唯一键和 scope；消息投递写入成功/失败/跳过原因，但不记录任何 API key。
- [x] 步骤 5：注册 `GET /api/events/timeline?scope=...&instrumentId=...`、`GET /api/alerts/delivery-log` 和管理员自选组提醒写路由；访客只能读取已公开的事件/新闻，不得读取账户提醒或投递日志。
- [x] 步骤 6：前端各市场工作区展示对应事件/新闻时间线和“对当前自选生效”开关；宏观通用工具栏保留宏观事件，但市场页只展示相关事件。
- [x] 步骤 7：运行事件八级提醒、冷却、静默、Telegram/网页通道和 guest 权限测试，再运行完整测试。
- [x] 步骤 8：提交 `feat: 增强市场事件新闻提醒`。

### 任务 4：模拟盘绩效、基准和风险解释

**文件：** 修改 `src/features/risk-overview.ts`、`src/features/unified-paper-trading.ts`、`tests/risk-overview.test.cjs`、`tests/unified-paper.test.cjs`、`src/web/server.ts`、`src/web/public/index.html`。

- [x] 步骤 1：先写失败测试，覆盖按 market scope 的基准收益、市场/标的集中度、已实现/未实现归因、费用和滑点、最大回撤及恢复天数；空历史必须返回 `null`/空列表而不是伪造 0 收益。

```js
const report = calculatePerformance({ scope: 'stocks', trades: [], benchmark: { returnPct: 1.2 } });
assert.equal(report.benchmark.returnPct, 1.2);
assert.deepEqual(report.attribution, []);
```

- [x] 步骤 2：运行定向测试，预期新 API 未实现而失败。
- [x] 步骤 3：在现有统一账本上增加纯函数计算；订单记录费用/滑点假设和 scope，历史记录保留向后兼容读取。
- [x] 步骤 4：注册 `GET /api/paper/performance?scope=...&benchmark=...`，默认只读；管理员的模拟订单写接口保持原鉴权和真实交易 403 边界。
- [x] 步骤 5：前端在模拟盘上方增加“基准/集中度/归因/回撤恢复/策略比较”卡片，按当前市场过滤，不把预测市场的 YES/NO 盈亏解释为股票价格收益。
- [x] 步骤 6：运行三类订单、访客只读、跨市场过滤和完整测试。
- [x] 步骤 7：提交 `feat: 增加模拟盘绩效归因与基准风险`。

### 任务 5：缓存、加载和数据质量优化

**文件：** 创建 `src/features/performance-cache.ts`、`tests/performance-cache.test.cjs`；修改 `src/web/server.ts`、`src/web/public/index.html`、`src/features/source-health.ts`。

- [x] 步骤 1：先写失败测试，覆盖 ETag 命中返回 304、缓存过期时先返回 stale 数据并后台刷新、同一请求并发只发一次上游请求、超出 scope 请求预算返回可解释的 429/缓存响应。

```js
const cache = createResponseCache({ ttlMs: 1000, staleMs: 5000 });
cache.set('stocks:AAPL', { price: 1 }, 'source-1');
assert.equal(cache.read('stocks:AAPL', 'source-1').status, 'fresh');
assert.equal(cache.read('stocks:AAPL', 'other').status, 'miss');
```

- [x] 步骤 2：运行定向测试，预期失败。
- [x] 步骤 3：实现带 scope/key/source 的内存缓存辅助函数、ETag 生成、并发去重、stale-while-revalidate 和请求预算；失败刷新不得覆盖最后一次有效数据。
- [x] 步骤 4：在行情、事件、新闻和详情 GET 接口逐步接入 `Cache-Control`/`ETag`；不把敏感账户、提醒配置和密钥放入公共缓存。
- [x] 步骤 5：前端首屏只加载当前 market scope 的大盘、首屏卡片和当前 tab 数据，其余雷达/图表/新闻在进入 tab 或展开卡片时加载；使用 `AbortController` 丢弃旧 scope 响应。
- [x] 步骤 6：在 source health 增加首字节耗时、缓存命中、stale 次数和最近失败原因；页面显示“数据时间/来源/过期状态”，不显示密钥或完整上游错误。
- [x] 步骤 7：用 Playwright 记录股票、期权、虚拟币、预测市场四次切换的首屏时间和控制台错误；运行构建、完整测试、安全扫描和 web smoke。
- [x] 步骤 8：提交 `perf: 优化市场数据缓存与按需加载`。

### 任务 6：专属深度数据和研究管线（在前五项通过后执行）

**文件：** 修改 `src/features/binance.ts`、`src/features/prediction-radar.ts`、`src/features/research-workspace.ts`、`src/web/server.ts`、`src/web/public/index.html`；创建对应测试文件。

- [x] 步骤 1：先写测试，保证虚拟币专属 OI/资金费率/爆仓/深度字段只能被 `crypto` 读取，预测市场订单簿/价差/结算证据只能被 `prediction` 读取；股票/期权请求必须没有这些字段。
- [x] 步骤 2：复用现有 Binance/Polymarket 公开适配器，优先 REST + stale 缓存；只有真实测得收益足够时才增加 WebSocket/SSE，并实现心跳、重连、限流和关闭清理。
- [x] 步骤 3：扩展研究状态为 `IDEA/RESEARCH/BACKTEST/PAPER/REVIEW/ARCHIVED`，把回测参数、数据时间窗、费用/滑点和结果摘要绑定到同一实验 ID；增加过拟合提示所需的参数数、回测数和 out-of-sample 字段，但不自动得出投资结论。
- [x] 步骤 4：运行专属字段隔离、源端失败、断线重连、预测结算和研究实验血缘测试，再进行完整浏览器验收。
- [x] 步骤 5：提交 `feat: 补齐加密预测专属深度与研究管线`。

### 任务 7：统一验收、交接和发布（只有所有轨道通过后）

**文件：** 修改 `docs/handover-2026-09-10.md`；不修改 Nginx、证书、VPN、Telegram token 或其他系统级配置。

- [x] 步骤 1：运行 `npm run build`、`npm test`、`npm run security:scan`、`npm run smoke:web`、`git diff --check`。
- [x] 步骤 2：用 guest 和管理员分别验证 GET/写入边界；四个市场切换后检查大盘、雷达、分析、详情、提醒、比较、筛选、模拟盘没有跨市场字段和旧请求残留。
- [x] 步骤 3：检查 Git diff、锁定未跟踪的 `src/utils/platform-command.ts` 不得被纳入提交；扫描 staged 文件和远端树，不得出现 API key、运行时数据库、日志和生成 dist 以外的敏感产物。
- [x] 步骤 4：更新交接文档，只记录实际通过的测试、已知数据源限制和回滚方式；若某轨道失败，保留前一轨道提交，不宣称整批完成。
- [x] 步骤 5：Antigravity 的实现提交经过 Codex 审查后，合并到当前分支并推送 GitHub；推送成功与 CI 结果分开报告。
- [x] 步骤 6：VPS 发布前备份 `/opt/moneymoney/dist`，只替换生成的 `dist`、重启 `moneymoney.service`，轮询 health/readiness、核对本地/远程 hash、HTTPS 和登录后冒烟；不修改 Nginx、TLS、VPN 或 Telegram 轮询配置。

## 验收矩阵

| 领域 | 必须通过的验收 |
| --- | --- |
| 作用域 | 股票/期权/虚拟币/预测市场的筛选、比较、时间线、雷达和风险输出不出现其他市场专属字段 |
| 数据 | 每条行情/事件/新闻显示来源、抓取时间和 fresh/stale/unavailable；单源失败不清空其他源 |
| 提醒 | 自选组、单标的、八级事件、新闻关键词、价格、去重、冷却、静默、到期、网页/TG 通道和投递日志均有测试 |
| 模拟盘 | 三类资产订单、持仓、基准、集中度、归因、费用/滑点、回撤恢复、策略比较和 guest 403/GET 200 边界通过 |
| 性能 | 当前 scope 首屏不加载其他市场重数据；ETag/并发去重/SWR 生效；四次切换无控制台错误和旧响应覆盖 |
| 安全 | secret scan 通过；访客不能写模板、提醒、比较快照、模拟账本或通知；真实交易仍 403 |
| 发布 | build、完整 test、security scan、web smoke、HTTPS 冒烟、dist 备份和服务健康检查全部有日志证据 |

## 计划自检

- 已覆盖调研中最高价值的筛选、详情比较、事件新闻、提醒、自选、组合风险、研究管线和性能治理。
- 已明确宏观继续放通用工具栏，市场专属数据不进入通用混合区。
- 已明确免费源优先、付费源可选、真实交易和 AI 自动下单不做。
- 已为每个新增模块定义文件、失败测试、实现、验证和提交步骤；没有把“适当处理”作为占位步骤。
- 轨道 A/B/C 可独立验收；任何轨道失败都不会阻塞回滚到上一条已通过提交。
