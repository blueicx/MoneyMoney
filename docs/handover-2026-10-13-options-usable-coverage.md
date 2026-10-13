# 期权可用覆盖与驾驶舱口径

本批只闭合期权“目录登记不等于可用历史”的可靠性问题，不代表十二组扩充全部完成。旧损坏文件及目录记录原样保留，没有补价格、IV、Greeks，没有改变 AI 跑单配置、调用模型或创建订单。

## 如何读取覆盖

`/api/data/coverage?market=options&instrument=option:cboe:AAPL&timeframe=snapshot` 保留旧 `partitionCount/rowCount/periodStart/periodEnd/latestPublishedAt` 的目录登记含义，增量返回：

|字段|含义|
|---|---|
|availablePartitionCount / availableRowCount|通过身份、时间、行数与内容 Hash 校验的快照/合约行|
|unavailablePartitionCount|损坏、缺失或未通过校验的登记快照|
|availablePeriodStart / availablePeriodEnd|仅可用快照的日期范围；全部不可用时为 null|
|availableLatestPublishedAt|仅可用快照的最近抓取时间；不是行情实时声明|
|dataStatus / reason|historical、partial 或 unavailable 及真实原因|

汇总 `partitionStatus` 增加 partial/unavailable，`sourceStatus` 仍独立表达近期巡检来源状态。来源成功不能抹掉本地历史损坏；仅损坏历史且无可用来源时不返回 historical。访客只读取脱敏公开数量，不返回标的、文件路径或私人巡检明细。SLO 的 coverage 条目附带同一增量口径，SLO 顶层状态仍表示来源健康统计。

驾驶舱期权卡片显示可用合约行、可用覆盖标的、可用分区、隔离分区；时间仅取可用快照。沿用原卡片与三主题样式，不增加其它工作区内容。

## Evidence / Finding / Path

- Evidence：数据湖回归先失败于 availablePartitionCount 缺失；汇总回归先失败于损坏历史仍为 historical；驾驶舱回归先失败于缺少可用统计入口。各自实现后针对性测试通过。
- Finding：旧实现直接汇总 options_chain_partitions 登记记录，并在驾驶舱标为历史数据，掩盖文件不可读。旧读取仅校验快照内容 Hash，未核对外层身份；新增外层身份、来源、抓取日期/时间、模式、行数、合约身份校验，任何不一致均不发布为可用历史。
- Path：登记目录 → 同一历史读取校验 → 可用数量/日期范围 → 覆盖汇总及驾驶舱。只读检查不修改目录和原始文件；其它市场 Parquet 仍保留原登记口径，本批不宣称全数据湖逐文件复核。

本地复现：先运行 `npm run build`，再执行 `node scripts/run-isolated-tests.cjs tests/data-lake.test.cjs tests/data-coverage-status.test.cjs tests/market-workspace-dashboard.test.cjs`。`npm run smoke:auth` 在新建隔离目录中保存两个明确夹具快照、损坏其中一个，使用真实服务接口验证可用数、原登记数、部分成功及访客脱敏，并在桌面/手机三主题验收驾驶舱。外部 smoke URL 模式不会写入夹具。生产不注入测试数据。

开发过程中首次新增合约校验的 TypeScript 构建失败于来源字符串联合类型；增加显式来源守卫后重新构建通过。保留这一失败记录，不将测试通过冒充首次构建通过。

完整发布门槛与生产版本、Hash、备份、回滚结果需以发布后记录为准。本批开始时正式域名与 VPS 均为 af3f508，服务 active，根磁盘约18GB可用；未跟踪 data/research.db 保留，不纳入提交或产物。

## 发布前冻结验证

全量1397项测试通过，构建、Web/认证/四市场浏览器、实时K线、加载基准通过；安全扫描744个跟踪文件及差异检查通过。认证浏览器新增真实服务覆盖与历史一致性、访客脱敏、驾驶舱桌面/手机三主题验收。实时K线脚本仍为明确推流夹具，不宣称本次验收生产逐笔行情。

最终固定环境每种宽度各三次：桌面冷图表2872.8ms/热783.1ms，手机冷2962.5ms/热849.6ms，热脚本下载0字节。相对最初4992/4790ms达到原20%目标；本批未修改首屏前端或宣称额外提速。此前并行门槛运行的一次冷加载5598.6ms，最终独立重测使用同环境中位数，不隐去上游等待/并行负载造成的波动。

生产发布前只读检查：BTC期权登记15份、可用1份、不可用14份；ETH登记1份、可用0份、不可用1份。只检查原目录和文件，没有触发采集或修复。未跟踪research.db Hash保持27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1。
