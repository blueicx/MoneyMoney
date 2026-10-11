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
| `analysis` 标的分析 | 四市场 | `#analysis-tab` / `loadActiveWorkspaceInstrument()` | `/api/analysis`、`/api/instruments/:type/:venue/:symbol/overview` | 依赖明确 `InstrumentRef`；访客可见范围由后端响应决定，需继续核查私有字段 | `market-workspace-flow`、instrument 测试 |
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
