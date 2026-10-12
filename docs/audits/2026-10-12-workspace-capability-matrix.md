# MoneyMoney 工作区能力矩阵（基线审计）

审计日期：2026-10-12

代码基线：`codex/research-closure-all` / B 版工作区
范围：`src/features/market-workspace.ts`、`src/web/public/index.html`、`src/web/public/modules/dashboard-runtime.js`、工作区模块和 `src/web/server.ts`。

## 审计口径

- 本表记录代码中已接线的页面归属、API/Provider 和访问边界；静态接线不等于本次已对上游实时服务做在线可用性证明。
- 数据状态由各 API/Provider 返回并在对应区域呈现；全站尚未统一强制每个字段都携带来源时间、原因和证据引用，这是后续分批验收项。
- `WorkspaceId` 有 30 项；服务端导航组实际展示 28 项。`watchlist` 与 `positions` 是 `isWorkspaceAllowed()` 的共享例外，通过自选市场入口/持仓页进入，不在生成式左侧分组中。不要把它们误记为未注册，也不要声称它们已在所有市场的左侧菜单中可见。
- 本批回归修复：所有非 `overview` 工作区都会隐藏 `#stocks-tab`、`#binance-tab` 中未声明归属的旧式直接子面板；回到 `overview` 时仅恢复由工作区边界隐藏的面板，不覆盖市场范围隐藏状态。

## 30 项工作区

| 工作区 | 市场范围 | 当前页面/模块归属 | 已接线数据/API（代码证据） | 权限及当前已知限制 | 自动化覆盖/后续核验 |
|---|---|---|---|---|---|
| `overview` 市场总览 | 总体及四市场、自选 | `#market-overview`、`#workspace-dashboard-cards` | `/api/workspace/dashboard?scope=`；市场专属 Provider 聚合 | 访客使用公开摘要；Provider 独立返回状态。冷缓存/来源不可用需逐卡核验 | `workspace-exclusive-runtime`；浏览器四市场矩阵待执行 |
| `radar` 市场雷达 | 股票、期权、虚拟币、预测市场 | `marketRadarTab()` 对应当前市场 tab | `/api/market-ticker`、市场行情/雷达现有 loader | 各市场数据能力不等价；必须按当前市场展示实际来源状态 | 导航与市场隔离测试；各市场交互待抽检 |
| `analysis` 标的分析 | 四市场 | `#analysis-tab` / `loadActiveWorkspaceInstrument()` | `/api/analysis`、`/api/instruments/search`、`compare`、`compare/snapshots`、标的 `overview`/`timeline` | `/api/analysis` 仅公开市场分析；访客统一标的读取仅放行明确 GET 路由，比较快照只返回 `visibility=public`；搜索/概览/时间线不读取自选、日记、任务或模拟账户 | `guest-mode`、`market-workspace-flow`、instrument 测试 |
| `screener` 筛选与比较 | 四市场 | `#market-research-tools`、筛选模块 | `/api/screener`、`/api/screener/templates`、`/api/instruments/compare` | 市场参数需与筛选条件一致；跟踪模板不应跨市场复用 | screener/tracking 专项测试 |
| `backtest` 策略回测 | 四市场（按数据能力） | `#backtest-tab` | `/api/backtest`、`/api/backtest/preflight` | 依赖历史覆盖、成本和样本区间；禁止将数据缺口当成零收益 | 回测专项与市场隔离测试 |
| `risk` 风险监控 | 四市场 | `#risk-tab` | `/api/risk/overview`、`/api/risk/history`、纸面风险指标 API | 私人组合/模拟仓位受管理员权限保护；缺基准或汇率不能补零 | `guest-mode`、风险/组合完整性测试 |
| `decision-intelligence` 可信决策 | 四市场 | `#decision-intelligence-tab`、`action-research-workspace.js` | `/api/evidence`、`/api/decisions`、`/api/scenarios`、`/api/signals/quality`、`/api/portfolio/analytics` | 证据摘要可公开；日记、组合和工作区数据为私有 | `decision-intelligence`、访客测试 |
| `research-lab` 研究实验室 | 四市场（按数据能力） | `#mm-research-lab` 动态模块 | `/api/research/factors/catalog`、`/api/research/experiments`、`/api/research/candidates` | 研究记录/实验为管理员私有；历史不足时不得生成伪结论 | `research-workspace`、候选门槛测试 |
| `action-center` 自选行动 | 四市场（按显式标的） | `#mm-action-center` 动态模块 | `/api/watchlist/action-center`、`/history`、条目 `PATCH` | 私有；事件来源失败必须与“成功但无记录”分开 | `action-center`、权限/去重测试 |
| `watchlist` 我的自选 | 四市场、自选总览 | `#workspace-watchlist-panel` / `#positions-tab` | `/api/workspace/watchlist`；管理操作 `/api/watchlist` | `/api/watchlist` 管理员专用；访客的个人自选/模拟持仓返回空集 | `guest-mode`、watchlist/市场隔离测试；入口是顶层自选区 |
| `positions` 我的持仓 | 四市场 | `#positions-tab`、纸面账户区 | `/api/paper/positions`、`/api/positions`、`/api/paper/ledger` | 管理员私有；真实交易执行器不启用 | `guest-mode`、统一模拟账本测试；不在生成式侧栏组中 |
| `stock-quotes` 行情与选股 | 股票 | 股票区 `stocks-market`、K 线区 | `/api/stock/indices`、`/api/stocks/:symbol/overview`、`/api/stock/kline` | 多来源状态和源时间需逐标的核验；不得沿用前一标的时点 | `stock-api`、K 线及浏览器测试 |
| `events` 市场事件与新闻 | 当前选中市场 | `loadEventTimelineWorkspace()` / events 模块 | `/api/events/timeline`、`/api/events/entities`、`/api/events/calendar`、`/api/events/:id/evidence` | 股票有日历/个股新闻；其他市场无可靠事件源时应明确 unavailable/unsupported，不回填股票新闻 | 事件 API、时点防未来数据测试；四市场抽检待执行 |
| `breadth` 市场宽度 | 股票 | `#stocks-breadth` | `/api/stock/market-breadth` | 市场级数据，不应冒充单标的指标；来源时间和覆盖需显示 | `market-breadth-returns` |
| `insider` 内部人交易 | 股票 | `#stocks-insider` | `/api/stock/insider/:symbol` | SEC Form 4；股票与期权交易类型必须分开，映射不足不猜 | `stock-insider-ui`、SEC/身份测试 |
| `institutional` 机构持仓 | 股票 | `#stocks-institutional` | `/api/stock/institutional/:symbol` | 13F 是季度滞后披露，不能描述为实时持仓 | SEC/机构持仓测试 |
| `guru-holdings` 大神持仓 | 股票 | `#stocks-guru-holdings`、研究模块 | `/api/stocks/guru-holdings/consensus`、`/managers`、`/symbols/:symbol` | SEC 13F；按 CUSIP/证券类别和可比报告期比较，不汇总成全市场总持仓 | SEC/13F 与 `workspace-exclusive-runtime` |
| `analyst` 分析师共识 | 股票 | `#stocks-analyst` | `/api/stock/analyst/:symbol` | 依赖现有公开来源；字段缺失需作为缺失而非估算 | 2026-10-12 freshness 契约已覆盖；上游长期可用率仍未核验 |
| `fundamentals` 基本面质量 | 股票 | `#stocks-fundamentals` | `/api/stock/fundamentals/:symbol`、`/api/stocks/:symbol/fundamentals` | 免费来源字段覆盖不完整；缺字段需明确标记 | 股票 API、SEC/财务字段测试 |
| `short-interest` 空头利息 | 股票 | `#stocks-short-interest` | `/api/stock/short-interest/:symbol` | 发布频率和来源时间需区分，不得标成实时 | 2026-10-12 freshness 契约已覆盖；Nasdaq 上游 SLO 仍未核验 |
| `option-chain` 期权链 | 期权 | `#options-tab` / `loadOptions()` | `/api/equity-options/:symbol` 或 `/api/options/:asset`；`/api/options/history` | 只接受可核验合约；来源/合约身份不匹配不比较 | `options-market-quality`、`contract-ui` |
| `volatility` 隐含波动率 | 期权 | 期权工作区波动率视图 | 同期权链 API、`/api/options/history/compare` | IV 历史仅来自已保存真实快照；样本不足不报分位 | 期权快照/历史测试 |
| `greeks` Greeks | 期权 | 期权工作区 Greeks/Payoff | 同期权链 API、`/api/options/payoff` | 需真实报价、到期、乘数和合约身份；不可计算时禁用并说明原因 | `options-backtest`、报价质量测试 |
| `crypto-quotes` 行情与 K 线 | 虚拟币 | `#binance-tab` | `/api/binance/klines`、`/depth`、`/trades`、`/prices` | 当前主要走 Binance 公共接口；其他交易所标的不能路由为 Binance | `contract-workspace`、实时 K 线 smoke |
| `contracts` 永续与交割合约 | 虚拟币 | `contracts-workspace.js` 动态面板 | `/api/contracts/catalog`、`detail`、`history`、`kline`、`compare`、`scenario`、`capacity` | Gate 永续/交割身份必须匹配；盘口是当前快照，不是历史曲线 | `contract-workspace`、`contract-chart` |
| `funding-rate` 资金费率 | 虚拟币 | `#binance-funding-carry` / `loadFundingCarry()` | `/api/funding-carry`、`/api/funding-rates` | 数据来自不同 Provider 时不能混成一条同源历史 | `contract-metrics-history`、资金费测试 |
| `open-interest` 未平仓量 | 虚拟币 | `#binance-perpetual-crowding` | `/api/perpetual-crowding`、合约 detail `openInterest` 字段 | 当前指标/归档历史分开显示；无归档不插值 | `contract-metrics-history` |
| `on-chain` 链上数据 | 虚拟币 | `#binance-bitcoin-onchain` | `/api/bitcoin-onchain`、`/api/defi/*` | 链上源覆盖与交易所行情不同；无来源时不能由价格代填 | BTC序列质量与空状态测试见 2026-10-12 增量复核；DeFi收益子面板见下节 |
| `order-flow` 主动资金流 | 虚拟币 | `#binance-order-flow-liquidity` | `/api/order-flow-liquidity`、Binance trades/depth | 当前成交/盘口快照不等于历史订单流；时间粒度需显示 | 固定池覆盖、盘口质量、缓存状态测试见 2026-10-12 增量复核 |
| `prediction-radar` 预测雷达 | 预测市场 | `#radar-tab` / `loadPredictionRadar()` | `/api/prediction-radar`、`/api/prediction-history`、`/api/prediction/settlement/:platform/:marketId` | YES/NO、平台 ID、规则版本和官方结算来源须保持绑定 | `prediction-settlement`、`forecast-horizon` |

## 本批验证

- `node --test tests/workspace-exclusive-runtime.test.cjs`：修复前新增的注册工作区边界回归失败于 `overview/radar`，复现旧式股票/币种面板泄漏。
- 修复后 `node --test tests/market-workspace-navigation.test.cjs tests/workspace-exclusive-runtime.test.cjs`：11 项通过。
- 新测试覆盖注册表 30 个 ID（包括不在生成式菜单的 `watchlist`/`positions`）、所有导航上下文中的市场/工作区所有权，以及从专属工作区返回总览时隐藏状态恢复。
- 尚未进行浏览器生产数据在线抽检；后续领域批次按本矩阵的“后续核验”逐项补足，不能将本表当作实时上游 SLA 证明。

## 2026-10-12 增量复核：股票研究数据时点

- 分析师共识、SEC 基本面和 Nasdaq 空头利息接口统一返回 `dataStatus/source/updatedAt/sourceUpdatedAt/retrievedAt/reason`；`updatedAt` 指向可核验的源时点，抓取时刻单独放在 `retrievedAt`。
- 来源未提供有效时点时返回 `partial` 和明确原因，不以抓取时刻替代。分析师现价的报价来源与共识来源分开列示；报价响应没有可核验源时间时明确显示未知。
- 三个股票面板共用主题变量驱动的 freshness 展示；状态区分延迟、历史、部分成功、不可用、失败和空结果。
- `tests/stock-research-freshness.test.cjs` 覆盖来源/抓取时点分离、缺失时点、报价来源隔离、三个卡片接线及三主题渲染。
- 本次验证的是代码契约和本地页面渲染，不代表已在线核验 StockAnalysis、SEC 或 Nasdaq 的当前上游可用率。

## 2026-10-12 增量复核：BTC 链上指标质量

- BTC 链上雷达逐序列保留来源状态、最后观测时间、抓取时间、有效样本数、无效行数、原因和原始来源链接；来源单项失败不会清除其他有效序列。
- 矿工收入缺失不再以当前时间和 0 值造点；核心序列只在精确共同观测时点存在时才按该时点截断，只有同日但不同时间戳不视为同步；缺少共同观测或 NVT 可对齐历史不足时不输出综合信号/环境加分。
- 空数组仍表示“来源成功但没有记录”；非空响应中无效字段和负值会被计数并标记部分成功；传输/HTTP/响应结构失败则标记来源不可用。真实 0 值保留，但零成交额不构造 NVT 分母，也不生成综合判断。
- 页面分别标注来源观测时间与 MoneyMoney 抓取时间；部分成功和失败原因沿用主题变量展示，缺少综合结果时不填充虚假分数。
- `tests/bitcoin-onchain-data-quality.test.cjs` 覆盖正常零值、零成交额、负值、空序列、坏行、单源失败、精确共同时间点/错位时间戳、UI 状态及三主题渲染。
- 此处验证的是代码契约和本地渲染；未据此声称 Blockchain.com 的在线可用率或数据完整度达到任何 SLA。

## 2026-10-12 增量复核：访客标的分析权限与链上未来时点

- 访客 `/api/instruments` 不再按整段前缀放行；只允许搜索、同市场比较、公开比较快照及合法标的身份的 `overview`/`timeline` GET。比较快照仍按 `visibility=public` 过滤，写入维持管理员权限。未来新增的 holdings、decisions、export 等子路由默认拒绝。
- `/api/analysis` 仅读取公开市场分析服务；不读取统一自选、组合/模拟账本或 SQLite 私有业务状态。访客策略仍为只读 GET allowlist。
- BTC 链上序列超过本次 `retrievedAt` 的点不参与指标、共同时间戳或信号计算；逐序列保留 `futureCount` 并显示排除原因。若所有记录都晚于抓取时点，返回 `partial`、零指标和明确原因，而不是错误展示为普通无数据。
- `tests/guest-mode.test.cjs` 与 `tests/bitcoin-onchain-data-quality.test.cjs` 覆盖权限最小化、公开快照筛选、未来点过滤及全未来点状态。验证限于本地契约和页面，不代表上游当前 SLA。

## 2026-10-12 增量复核：主动资金流与盘口状态

- Binance 主动资金流雷达返回市场、数据状态、固定币种池覆盖数、逐币种失败原因、证据接口和 MoneyMoney 抓取时间；全失败时返回明确不可用结果，不因固定池中 BTC 单项缺失而抛出泛化错误。
- 只有六个固定币种均具备连续 25 根有效小时K线与有效盘口快照时，才生成全市场均值、环境加分和助手倾向；部分覆盖保留有效币种卡片，但综合指标置空，策略助手不采纳部分样本加分。
- K线最后一根的开盘时点、K线抓取时点、盘口本地抓取时点分开呈现。盘口来源没有提供交易所事件时间，因此不冒称源端时间或“实时盘口”；服务缓存明确标为缓存。
- 缺口/乱序小时线、无效成交量、过期K线或盘口、无效/交叉盘口均从该币种信号计算中排除并报告原因。
- `tests/order-flow-liquidity-quality.test.cjs` 覆盖完整/部分/全失败、缓存、时点区分、过期盘口、成交量与盘口质量、综合评分门槛和浏览器面板状态文案。
- 自动化验证证明本地契约和页面渲染；实际 Binance 数据源可用性与生产部署需要单独在线核验，不从本地测试推断上游 SLA。

## 2026-10-12 增量复核：DeFi 收益池质量与来源状态

- `stablecoin`、`ilRisk`、7日变化和奖励 APY 字段按严格数值/布尔语义解析；缺失或非法风险属性不会被当成“稳定币”“无常损失风险为否”或 0% 变化，不获得相应正向评分。
- 风险属性不完整的池保留字段警告，并在现有说明文案与逐池缺项提示中标注评分只基于已知字段；缺少协议/资产/链身份或有效 TVL/APY 的记录不入选并计数，提示文本经过 HTML 转义。
- `/api/defi/yield-quality` 统一返回 crypto 市场、来源、来源时点、抓取时点、缓存状态、失败原因及证据链接；抓取时点不会冒充来源更新时间。来源成功但无记录返回 `empty`，上游/结构故障返回 `unavailable`/HTTP 503，缓存命中标记 `cached`。
- 现有收益卡片展示来源、抓取时间、来源更新时间未验证和真实空/失败原因；不新增卡片或改主题布局。
- `tests/yield-quality-data-quality.test.cjs` 覆盖未知风险属性、非法趋势值、缺失池身份、空响应/坏响应/请求失败/恢复、缓存、API状态码、逐池缺项提示及 HTML 转义。
- 本次为本地契约验证；未核验 DefiLlama 当前线上可用率，也不将其数据称为实时。
- 发布提交 `96e1c327357b6f2624dc5215ca2380e9503b76b7` 已推送并部署；生产只读 Chromium canary 覆盖股票、期权、虚拟币、预测市场及 SNDK，全部通过。`moneymoney.service` 为 `active`，健康接口 `mode=view-only`、`storage.ok=true`、`migrationErrors=[]`。
- 生产 `dist/web/server.js` SHA-256 `5b51b1843de0148149f307b615197f532b4c3f4f784626897f272e04dd712707`、`dist/web/public/index.html` SHA-256 `8ea99c333648bc14377f1a98d3bae2ded963570b923a91649770931f12f57ff3` 与本地产物一致；归档 SHA-256 `ff30e15d20ca90405e108c194e9e2e7cefdcde372291eb4879a27453bba81c8d`。备份与回滚目录分别保留在 `/opt/moneymoney/backups/dist-pre-96e1c32-20261012-defi-yield` 和 `/opt/moneymoney/dist.rollback-96e1c32-20261012-defi-yield`。
- 正式域名未登录访问 `/api/defi/yield-quality` 返回 401，因此线上 DefiLlama 数据新鲜度未作验证或推断；这不改变本地 API 契约测试结果。

## 2026-10-12 增量复核：资金费率统计口径

- Gate.io USDT 永续列表中的有效费率按严格数值解析；真实 `0` 保留，空值、非数值、无穷值及非 USDT 永续名称排除并计数。成功但无合约、存在合约但全为无效费率、部分字段无效分别返回 `empty`、`unavailable`、`partial`，不把无效字段转成零。
- 列表显示仍按绝对费率排序并受 `limit` 限制；等权均值、正/负极值及 BTC/ETH/BNB/SOL 精确主流合约数据从完整有效 USDT 永续集合计算，改变 `limit` 不改变统计值。完整集合复用同一个两分钟缓存快照。
- 年化费率仅在来源提供有效 `funding_interval` 秒数时按该合约周期折算；周期缺失或无效时为 `null`，不再按固定每日一次假设。
- 当前接入字段没有可验证的费率观测时点映射；`sourceUpdatedAt` 明确为空，`fetchedAt` 仅代表 MoneyMoney 请求时间，结果状态为部分数据/时间未验证，不冒称源端实时。页面分别呈现覆盖数、缓存状态、取回时间与未验证时点。
- 页面上的全量等权均值是各合约当前周期费率的原始均值，不是按周期归一后的年化比较；标签明确提示这一点。交易助手只有在精确覆盖 BTC、ETH、BNB、SOL 且四者均有相同有效 `funding_interval` 秒数时才计算拥挤度。覆盖不足或周期不一致/缺失时指标为 `null`、显示警告，且不产生多空拥挤风险提示。
- `tests/market-sentiment-quality.test.cjs` 覆盖零费率、非法字段、非永续过滤、limit 不影响均值、完整/不足的主流覆盖、空/无效来源状态、缓存复用、页面来源失败隔离和助手接线。

## 2026-10-12 增量复核：SEC 财报结果原文绑定

- 结果发布前不仅验证 SEC HTTPS 域名，还将 archive 路径中的申报人 CIK 和完整 accession 与结果记录的 accession 逐项匹配；拒绝非 SEC 主机、凭据/端口、查询/片段变体、错误 CIK、错误 accession 及不安全路径段。
- 精确 accession 的 SEC archive 索引页仍可作为来源链接，以兼容 SEC 返回的记录没有 primary document URL 的情况；不得把同域其他公司的申报页冒充该股票证据。
- `tests/telegram-result-adapters.test.cjs` 覆盖正确文档、正确 archive 索引、CIK/accession 错配、查询参数和空 user-info URL。此次根因由该测试在修复前复现，修复后定向测试通过。
- 这是本地来源身份契约验证，不代表对 SEC 当前在线可用率、某一真实财报字段或生产 Telegram 投递做了在线验证。

## 2026-10-12 增量复核：统一标的时间线的发布时间与抓取时间

- 新闻条目的 `publishedAt` 保持来源发布时间；时间线另从 Yahoo 新闻快照传递 `retrievedAt`，不再把两类时间混为一谈。
- SEC 申报的 `publishedAt` 仍取 SEC `acceptedAt`；`retrievedAt` 取对应 `sec-edgar-submissions` 源快照的成功抓取时间，缓存快照沿用其原始成功抓取时间，不使用本次失败尝试时间。
- 财报日历项保留其 Provider 返回的逐项 `retrievedAt` 与来源名称。当前事件模型没有可核验的原文地址，因此 `sourceUrl` 明确为 `null`，不拼凑 URL。
- 新闻和 SEC 时间线新增规范 `sourceUrl`，同时保留既有 `url` 字段兼容旧消费者；缺少原文链接时保持 `null`。
- `tests/unified-instruments.test.cjs` 覆盖来源/抓取时间分离、原文链接别名兼容、事件来源时点及缺少 URL 时不造链接。仅验证本地数据契约；生产真实标的在线时点未在本次声称。

## 2026-10-12 增量复核：计划时间、发生时间与发布时间

- 宏观、Nasdaq 财报及 FOMC 日历的既有 `date` 保留兼容，并显式映射为 `scheduledAt`；日历没有提供独立可核验的发生/发布时间，因此时间线不再将计划时点写入 `occurredAt` 或 `publishedAt`。
- 新闻仍以来源 `publishedAt` 定位时间线，但 `occurredAt` 明确为空；文章发布时间不代表其描述事件发生的时间。抓取时间继续使用源快照的 `retrievedAt`。
- 行动中心以 `scheduledAt` 进行未来窗口筛选、分类及图表定位；卡片和详情分别展示计划、发生、发布与抓取时间。Telegram 摘要同样显式标出计划时间。
- 事件研究继续只允许具有合格已发布/已发生证据的事件；单有日历计划时间时只能查看日历、图表定位或建立决策草稿，不能据此伪造事件研究入场时点。
- `tests/event-calendar.test.cjs`、`tests/unified-instruments.test.cjs` 和 `tests/action-center.test.cjs` 覆盖计划时间映射、无虚构发生时间、行动中心归类及网页契约。此项验证的是本地语义契约，不代表日历来源在线准确率或事件真实发生状态。

## 2026-10-12 增量复核：事件实体归一化时间语义

- 事件实体不再用展示字段 `at` 回填 `occurredAt`；单独保留 `scheduledAt`、`publishedAt` 与只用于时间线/图表定位的 `timelineAt`。真实发生时间优先作为时间线位置，其次计划时间、发布时间，最后才使用旧兼容字段 `at`。
- 历史事件研究要求可核验发布时间；新闻允许以发布时间作为研究进入时点，但日历/事件必须有明确发生时间。计划时间晚于 `asOf` 时拒绝，计划日期已过但仍无发生证据时也拒绝；事件研究 cohort 排除仅有计划时间的事件。
- 事件聚类、K线轨道、证据抽屉、工作区事件入口和证据快照均使用分离后的时间字段；图表明确标注计划/发生/发布，点击定位仍可使用 `timelineAt`，但不会把它作为历史研究证据。
- 新增测试先复现旧归一化失败，再覆盖发布时间、计划时间、未核实发生状态、新闻研究时点、事件聚类、cohort 筛选和页面/服务端证据字段契约。
- 代码提交 `118e8346b25a107d487b9216e82ae9d96e217711` 已推送并部署；`moneymoney.service` 为 `active`，正式域名版本接口返回同一 commit，健康接口 `alive`。生产只读 Chromium canary 覆盖股票、期权、虚拟币、预测市场和 SNDK，访客私有读取边界检查通过；本次未发送 Telegram 测试消息。
- 远端 `dist/web/server.js` SHA-256 为 `1e773360b8fcdf3d2dc58475c3e670293c8f115401cbe3fda299f3fc8624bf39`，`dist/web/public/index.html` SHA-256 为 `a66deba8dbf435bee787e55d6b00e8b19e4462f9541a1c50598f32e314639b46`，归档 SHA-256 `669c55824ac55721f0b0ed493a7fca2d2ba3e8b140b29b0c2f164e5b7b507a14`。备份及回滚目录保留于 `/opt/moneymoney/backups/dist-pre-118e834-20261012-event-time` 和 `/opt/moneymoney/dist.rollback-118e834-20261012-event-time`。

## 2026-10-12 增量复核：稳定币流动性数据覆盖与源时点

- 稳定币资产行对流通量、历史流通量和锚定价格使用严格数值解析；缺失锚定价保持未知，不再默认显示为 1 美元。无效资产身份/供应量进入异常计数，覆盖不完整时总供应量不伪装成全量总和。
- 1日、7日、30日流量分别统计有效资产覆盖；任一资产缺少某周期历史值时，该周期的全市场流量和百分比不输出，不能把可用子集冒充整体。成功空响应、响应结构无效及正常部分数据分别返回不同状态。
- DefiLlama 当前接入结果没有可核验的源端观测时间，接口明确 `sourceUpdatedAt: null`，抓取时间只写入 `retrievedAt`；因此不生成综合流动性分、方向、风险加权值，也不让该来源影响交易助手。错误结构不进入缓存，下一次请求可重新获取。
- 页面逐周期显示覆盖数、源观测时间、抓取时间与缓存状态；缺值展示“暂无”，不将 `null` 格式化为 `$0.00`；来源失败显示具体原因。面板沿用主题变量，没有新增跨工作区内容。
- `tests/stablecoin-liquidity-quality.test.cjs` 覆盖部分周期覆盖、未知锚定价、坏资产行、空/坏响应区分、坏响应后的恢复、无源时点时的行动门槛及 DOM 空值呈现。
- 本次验证是本地数据契约和面板渲染测试；未据此声称 DefiLlama 线上可用率、源端新鲜度或稳定币资金流向已获核验。

## 2026-10-12 发布记录：稳定币数据质量与提醒页上下文

- 代码提交 `a4d890eb1af68aca4508358ebd7bdf663d34c837` 已推送到 `codex/research-closure-all` 并部署到当前 VPS。新增提醒标签上下文事件，修复组合提醒在真实“提醒”标签中没有按当前市场/标的加载能力的问题；冒烟用例改为核对股票 API 实际返回的 4 个字段。
- 稳定币结果保留覆盖度与未知值，不再将未验证的抓取时间视为来源观测时间；在源端时点不可核验时，不生成流动性方向或交易助手分数。此来源仍只用于研究显示。
- 验收通过：`npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run smoke:experience`、`npm run smoke:actions`、`npm run smoke:expansion`、`npm run smoke:practical`、`npm run security:scan`、`git diff --check`；部署后 `npm run smoke:production` 只读通过，覆盖四市场及 SNDK。未发送 Telegram 消息。
- 正式域名 `https://bluetrade.bbroot.com` 返回版本提交 `a4d890eb1af68aca4508358ebd7bdf663d34c837`、健康 `alive`、登录页 HTTP 200；`moneymoney.service` 为 `active`。远端 Hash 与本地产物一致：`dist/web/server.js` `1e773360b8fcdf3d2dc58475c3e670293c8f115401cbe3fda299f3fc8624bf39`、`dist/web/public/index.html` `86c550036bd3f74fc608a251f5507b22f0aee6fc83f0027f7cfee89d55e60eab`、`asset-manifest.json` `3fa5c2b0af6505f652f13a40073c21331af97e941a055de752e7ae5b9d8791ca`、`build-info.json` `8bede6222fdd4e2ee20a708a53481afe40b6f1b173ec04af1c01703f94c056d7`、`stablecoin-liquidity.js` `98c9db7a09ee069509dc3dcd42b96f0d5a5c55ea550f87e24d5ccb7189bcf317`、`trade-assistant.js` `057be9b83c3977669486054bc0fb04a49a783b6376c18074fd1ad41235c50034`。
- 发布归档 SHA-256 为 `2668f4b8ff257ee2ebcebb6b9e6ff15acf5810106efdae28357a72418497b318`。发布前备份 `/opt/moneymoney/backups/dist-pre-a4d890e-20261012-stablecoin-alerts` 和回滚目录 `/opt/moneymoney/dist.rollback-a4d890e-20261012-stablecoin-alerts` 均保留。首次以普通用户执行在 root-owned staging/backup 父目录创建阶段被拒，检查确认服务仍 active、线上 dist 未切换后，以 sudo 重跑同一已校验脚本成功。
- 仅替换远端 `dist`；未改环境密钥、Nginx/TLS、业务数据库或数据湖。本地未跟踪 `data/research.db` 未提交，前后 SHA-256 均为 `27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`。部署用本地/远端临时归档和脚本已清理。
