# MoneyMoney 同类产品能力盘点与缺口分析

> 调研日期：2026-09-10
> 范围：股票、期权、虚拟币、预测市场，以及跨市场研究、提醒、模拟盘和性能体验。
> 结论用途：为下一轮实现计划提供依据；本文件只记录调研和产品决策，不代表已实现。

## 1. 当前代码已经具备的能力

基于当前工作树 `codex/stock-free-data-sources` 的代码与交接文档核对：

- 市场作用域已有 `overview/stocks/options/crypto/prediction/watchlist`，并且 `/api/market-ticker` 会按作用域分支返回不同大盘数据。
- 已有统一标的 `InstrumentRef`、统一搜索、标的详情和时间线接口；股票、虚拟币、预测市场已有各自适配器。
- 已有自选、事件/价格/新闻提醒、去重、冷却、静默时段、网页/Telegram 通道字段和提醒历史。
- 已有统一模拟账本、持仓、盈亏、风险指标、回测、研究工作区、事件日历、新闻和数据源健康状态。
- 已有访客只读边界、AI 市场作用域上下文、15 分钟 AI 分析缓存、源端失败不阻断其他数据的处理。

证据位置：`src/features/market-scope.ts`、`src/features/market-scope-view.ts`、`src/features/unified-instruments.ts`、`src/features/unified-alerts.ts`、`src/features/unified-paper-trading.ts`、`src/web/server.ts`、`docs/handover-2026-09-10.md`。

## 2. 同类产品中值得吸收的能力

### 2.1 研究入口和筛选

TradingView 的 Screener 支持按市场分别筛选、保存筛选器/模板、自定义字段、表格或图表视图、导出和自动刷新；这类能力适合 MoneyMoney 变成“先筛选、再进入详情、最后加入自选/提醒”的工作流。来源：[TradingView Screeners Walkthrough](https://www.tradingview.com/support/solutions/43000718885-tradingview-screeners-walkthrough/)。

建议吸收：每个市场拥有自己的筛选字段白名单；保存筛选条件时保存 `scope`，切换市场不会把股票字段带到预测市场。

### 2.2 标的详情、比较和时间线

TradingView 的 Supercharts 将 watchlist、详情、新闻、提醒、筛选器、日历、组合、基本面图表、期权和宏观地图放在同一研究流中，并支持比较标的。来源：[Getting Started with Supercharts](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/)。

建议吸收：统一详情页增加“同市场比较”，展示报价、K 线/价格历史、事件、新闻、分析和数据新鲜度；跨市场比较只能显示明确的标准化字段，不混淆原始指标。

### 2.3 提醒和事件联动

TradingView 的 Watchlist Alerts 能对整个自选列表动态跟踪新增和删除的标的；普通提醒还支持价格、技术条件、触发频率和到期时间。来源：[Watchlist Alerts](https://www.tradingview.com/support/solutions/43000739708-watchlist-alerts-your-trading-edge/)、[Alert Configuration](https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/)。

TradingView 的经济日历覆盖经济、财报、分红和 IPO，并显示实际值、预测值、前值，支持重要性、国家、时区和图表关联；News Flow 支持按自选、标的、市场、行业、公司活动、国家和来源过滤。来源：[Economic Calendar](https://www.tradingview.com/support/solutions/43000759911-economic-calendar-track-all-major-market-events/)、[News Flow Filters](https://www.tradingview.com/support/solutions/43000732560-news-flow-s-filters-overview/)。

建议吸收：自选级提醒、事件/新闻按作用域和标的过滤、事件结果方向、批量摘要、到期时间和投递审计；保留当前的去重/冷却/静默逻辑。

### 2.4 组合、风险和策略复盘

QuantConnect 将 Ideas → Research → Backtest → Paper Trading → Live 组织成研究管线，并提供回测交易分析、费用、换手、容量、Sharpe、Sortino、Alpha、Beta 等统计。来源：[Research Pipeline](https://www.quantconnect.com/docs/v2/cloud-platform/research-pipeline)、[Backtest Analysis](https://www.quantconnect.com/docs/v2/research-environment/meta-analysis/backtest-analysis)、[Backtest Management](https://www.quantconnect.com/docs/v2/cloud-platform/api-reference/backtest-management/create-backtest)。

Interactive Brokers PortfolioAnalyst 的公开材料展示了基准比较、归因、配置、集中度、预计收入、活动和风险度量。来源：[IBKR Risk Measures White Paper](https://www.interactivebrokers.com/images/common/Statements/RiskMeasures_WhitePaper.pdf)、[Performance Attribution White Paper](https://www.interactivebrokers.com/images/common/Statements/performance_attribution_white_paper.pdf)。

建议吸收：模拟盘加入基准、资产/市场集中度、收益归因、策略对比、回撤恢复、费用/滑点假设和实验血缘；不引入真实交易。

### 2.5 虚拟币和预测市场的专属深度

CoinGlass 将资金费率、未平仓量、多空比、爆仓、期权结构、订单流和深度作为加密衍生品核心视图。来源：[CoinGlass Crypto Derivatives Data Guide](https://www.coinglass.com/learn/the-ultimate-crypto-derivatives-data-solution-for-traders-and-developers-en)。Binance 官方文档提供现货/期货/期权目录及 WebSocket 行情流，适合低延迟更新，但连接有心跳、消息速率和订阅数量约束。来源：[Binance API Catalog](https://developers.binance.com/en/docs/catalog)、[Binance WebSocket Connection](https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/websocket-market-streams/Connect)。

Polymarket 官方数据接口提供无需认证的市场/事件发现、搜索、价格、订单簿、历史、价差、持仓、交易和未平仓量；市场 WebSocket 提供订单簿快照、价格变化、最新成交、买卖一档和市场新建/结算事件。来源：[Polymarket Market Data Overview](https://docs.polymarket.com/market-data/overview)、[Polymarket Market WebSocket](https://docs.polymarket.com/api-reference/wss/market)。

建议吸收：

- 虚拟币：OI、资金费率、多空比、爆仓、深度和流动性状态；免费源优先，付费键控源仅做可选增强。
- 预测市场：事件→市场树、YES/NO 价格历史、订单簿/价差/流动性、成交和结算证据时间线。
- 两类专属指标只能在对应市场工作区出现，不能再污染股票/期权雷达。

### 2.6 宏观和数据治理

FRED 官方 API 支持系列、发布、搜索、更新和 vintage dates；但官方 API 需要 key，因此只能作为可选配置源，不能当作无条件免费源。来源：[FRED API Overview](https://fred.stlouisfed.org/docs/api/fred/overview.html)、[FRED Series Observations](https://fred.stlouisfed.org/docs/api/fred/series_observation.html)。

建议吸收：源状态、更新时间、来源优先级、过期/降级原因、数据字段质量和请求预算统一显示；宏观仍放通用工具栏，但宏观卡片内引用市场专属指标时必须标明 scope。

## 3. 目前最值得补的缺口

按“用户能直接感知的价值 / 对现有架构的复用度 / 跨市场回归风险”排序：

1. **市场专属筛选器**：目前有搜索和快捷标的，但没有股票、期权、虚拟币、预测市场各自的字段筛选、保存模板、排序和导出。
2. **详情比较工作台**：已有统一详情后端入口，但缺少稳定的前端研究布局、同市场多标的比较和可复制的比较快照。
3. **自选级提醒与消息流**：当前规则以单个 `instrumentId` 为主，缺少“整组自选/筛选结果”提醒、新闻/事件 relevance、到期和批量摘要。
4. **事件结果与来源证据**：日历已有，但事件与标的、来源、实际/预测/前值、结果方向和提醒历史还没有形成完整证据链。
5. **模拟盘绩效解释**：已有盈亏和部分风险指标，缺少基准、集中度、归因、费用/滑点、策略对比和回撤恢复分析。
6. **市场专属实时通道**：现有短缓存和 REST 适配可用，但缺少统一的 stale-while-revalidate、ETag/条件请求、请求预算和必要场景的 WebSocket/SSE。
7. **预测/加密深度数据**：已有相关模块，但可继续补订单簿、价差、OI/资金费率历史、结算证据和源质量显示，并保持严格作用域隔离。
8. **研究管线和审计**：已有研究/回测页面，但缺少“想法→研究→回测→模拟→复盘”的状态流、实验血缘和配置/提醒/模拟订单审计。

## 4. 不建议现在照搬的内容

- 真实交易、AI 自动下单和自动连接券商：与既定安全边界冲突。
- 强制购买 CoinGlass、FRED 或其他付费数据：应保持免费源可运行，键控源只能可选。
- 没有来源和时间戳的社交情绪总分：容易把噪声包装成信号。
- 先做大型图表引擎再补数据质量：会放大加载慢、跨市场污染和过期数据问题。
- 把所有指标继续塞进总体页：用户已经明确要求市场工作区隔离，通用宏观才放通用工具栏。

## 5. 推荐下一轮范围

推荐做一个可发布的“研究效率 + 数据可靠性”批次，分三条可独立验收的轨道：

- **轨道 A：详情/比较/筛选**。先补市场专属筛选器、同市场比较、保存筛选模板和导出；这是最高频的研究入口。
- **轨道 B：事件/新闻/提醒**。补自选级规则、作用域过滤、事件证据链、到期、批量摘要和投递审计。
- **轨道 C：模拟盘/风险/性能**。补基准、集中度、归因、费用/滑点、实验血缘、SWR/条件请求和前端懒加载；加密/预测深度数据在轨道 C 中作为专属增强，不影响股票/期权。

执行时每条轨道都先写失败测试，再实现最小接口；每完成一条轨道就跑构建、完整测试、安全扫描、浏览器作用域冒烟，最后才合并到同一发布提交。
