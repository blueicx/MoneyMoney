# 平台剩余任务验收总账

范围承接 `2026-10-20-platform-expansion.md` 的六批需求，按下面十二个领域整理证据，不增加产品方向。业务源码固定为 `f86663d46ee08531336ad0af88f5e3bd3ae4d834`；单 Agent 核对。这里的操作验收使用真实隔离 SQLite/Parquet 和明确标记的测试夹具，不能代替生产成熟样本或官方公司行动来源。

## 逐项核对

| 领域 | 服务、操作与失败边界 | 验收入口 | 独立未满足条件 |
| --- | --- | --- | --- |
| 1. 性能与按需工作区 | 构建期帮助函数依赖归属、鉴权预加载、股票精确上下文预取；历史/共享/切换上下文不误复用 | `browser-market-matrix`、`live-kline-smoke`、全量加载测试、固定环境 benchmark | 当前扩充阶段的整页冷加载改善至少 20% 尚未证实；旧版 10 月 16 日累计改善不代替这个基线 |
| 2. 数据资产与采集控制 | `data-assets.ts` 及既有回补队列；私人目录、来源/修订/容量、预览确认、暂停/取消/恢复、迟到响应保护；读取不启动采集 | `data-assets-smoke`、数据资产/回补单测 | 15 个既有损坏文件没有可靠副本，保留隔离；不宣布数据完整 |
| 3. 私人研究项目 | `research-projects.ts`、references/review worker；创建、明确 ID 回链、结论、搜索、重载与同市场返回；跨市场/访客拒绝 | `data-assets-smoke`、`platform-completion-smoke`、项目单测 | 生产证据修订的实际覆盖需真实来源；不为验收修改生产项目 |
| 4. 受限策略与晋级 | 条件树版本/Hash、共用解释、实验/前向、手动成交收据和明确血缘；历史回看不冒充事前验证，未知公司行动阻止晋级 | `restricted-experiment-smoke`、`restricted-forward-smoke`、readiness/proof 单测 | 真实成熟前向样本及公司行动/修订覆盖，仍等待实际证据；夹具的 20 样本不算生产合格样本 |
| 5. AI 质量实验 | `ai-evaluation-lab.ts`、`ai-forecast-lab.ts`；已保存输出比较/导出、固定目标/期限/模型/提示版本、预览/取消/费用门控；未配置不调用 | `ai-evaluation-smoke`、`platform-completion-smoke`、lab/interface 单测 | 同口径真实成熟样本不足时校准保持未知，不把动作 confidence 当获利概率 |
| 6. 股票与公司行动 | `stock-capital-history.ts`、paper lifecycle/replay、runner adapter；财务口径、手动股息与可核验开仓批次拆股、成本修正、基准等待有效报价、原成交不变及事务回滚 | `professional-research-smoke`、`platform-completion-smoke`、runner/lifecycle/replay 单测 | 身份迁移、影响已平仓成本的注册跑单拆股、部分退出关系或旧历史缺证时继续阻止；不宣称自动处理全部公司行动 |
| 7. 期权事件研究 | 既有真实快照比较与明确事件引用；身份、Hash、发生/发布/抓取时点和事前可知性检查 | `platform-completion-smoke`、`research-depth-smoke`、期权单测 | 缺失快照/Greeks/结算官方证据不推算、不造现金 |
| 8. 合约周期与回放 | `contract-research.ts`、`contract-cycle-replay.ts`；真实归档价格/OI/基差、同身份周期回放与项目引用 | `contracts-workflow-smoke`、`research-depth-smoke`、周期回放单测 | 无来源费用/结算仍未知；历史观察不证明实际成交 |
| 9. 预测关系与结算 | `prediction-relationship-audit.ts`、`prediction-settlement.ts`；人工核验关系、规则/来源及结算边界 | `prediction-relationship-smoke` 的编译 UI/路由/SQLite 保存重载及规则变化；`research-depth-smoke` 的结算时间线；relationship/settlement 单测 | 无可靠事件关系或官方结算证据时不能认定已核验；隔离来源不能代替官方证据 |
| 10. 共享资金模拟 | `portfolio-simulations.ts`；冻结版本/归档、同市场币种、统一账本独立账户、资金竞争/重复敞口/退出优先级、对照、暂停恢复停止及导出 | `portfolio-simulation-smoke`、组合服务/路由/UI 单测 | 理论撮合不算真实前向成交；不自动启动生产模拟 |
| 11. 历史盲测 | `blind-sessions.ts`；预览确认、判断先于揭示、双时点证据、结构化失效及只追加响应、重载 | `blind-session-smoke`、`platform-completion-smoke`、盲测服务/路由/UI 单测 | 旧会话缺失原证据不事后补猜；不把历史揭示变成事前信息 |
| 12. Telegram 与网页同步 | `telegram-project-subscriptions.ts` 与既有 outbox；白名单私聊、明确订阅/取消、状态读取、代际/租约/去重/过期、网页回链 | `telegram-project-smoke`、订阅/outbox 单测 | 本轮不创建生产订阅或发送验收消息；真实 Telegram 点击/投递效果没有冒充已验收 |

## 源码与产物验证

- 干净导出与提交逐文件核对：1037 文件一致；1005 个文本文件仅规范 CRLF/LF 比较，1 个 LFS 文件按提交指针 SHA256 核验。安全扫描覆盖这份提交清单，未将 `node_modules` 当成受跟踪源码。
- 顺序构建后完整测试：411 文件、2021 项通过、0 失败/取消/跳过，进程退出 0；日志 `%TEMP%/mm-resume-tests.log`。业务源码和测试随后未改。
- 首次重新构建临时目录遗漏提交 ID，产物标识为 `unknown`，研究深度冒烟明确失败；该产物未部署。补入固定 `MONEYMONEY_BUILD_ID` 后重新构建并重跑全部发布冒烟，不把第一次失败计为通过。
- 修正后最终构建及全部 15 项标准/专用冒烟退出 0，日志 `%TEMP%/mm-resume-final-{gate}.log`。没有修改生产业务源码以适应测试。
- 补齐并保存 `scripts/prediction-relationship-smoke.cjs`：真实 Chromium、编译 UI/路由及隔离 SQLite，外部雷达/规则依赖使用合成夹具；确认与依据不足不请求保存，保存后重载读取，规则 Hash 变化不继承结论，三主题/桌面手机/访客 403/跨市场 400 均通过。首次验收未展开关系详情导致可见性等待超时；随后入库复跑发现动态生成的夹具时间偶尔晚于路由校验时钟，改为固定、早于校验的观测时间。没有改生产时间校验或放宽断言。最终日志 `%TEMP%/mm-resume-relationship-tracked-final.log`。

## 最终发布及性能证据

- 业务提交 `f86663d` 已推送；GitHub Actions `39917418651` 为 completed/success。运行版本与仅文档/验收脚本的后续提交区分记录。
- 发布前备份 `2026-10-23T07-36-03-926Z`（UTC）：73 文件、311610994 字节、54 个数据湖文件，2 个 SQLite 及隔离恢复通过；15 个既有损坏文件继续隔离，`dataStatus=partial`。
- 只部署干净构建的 `dist`、操作 `moneymoney.service`。发布归档 SHA256 `1f82ee900d934bdceb1cc1e765559f5bad5ecfc4d6a69cbd34f4beab80a1cf19`；server SHA256 `6440f94537047bae04a4898f96647dc019d5f44a284731e2ad2f73a30cd6f061`；index SHA256 `aa5f1ad93ccf508d48134ecf32223e096f39f0d339d67fa07ac946ed37edb60d`。四个业务模块的远端 Hash 与干净构建逐项匹配。
- 备份 `/opt/moneymoney/backups/dist-pre-f86663d-20261023-runner-split`，回滚 `/opt/moneymoney/dist.rollback-f86663d-20261023-runner-split`，回滚版本核验为 `4c8e056`。隔离旧读者探针通过：不重复拆股、现金/原成交/新数量保留；旧版阻止调整后批次的手动同步且忽略基准待报价标志，不声称完全向后兼容。没有在线回滚。
- 正式域名 `https://bluetrade.bbroot.com` 的版本为 `f86663d`；29 项资源 Hash/immutable 缓存通过、重试 0；4 个私人接口拒绝未登录。生产只读 Chromium 通过股票、期权、虚拟币、预测市场、SNDK 及手机，日志 `%TEMP%/mm-resume-production-{assets,canary,state}.log`。没有生产模型调用、订单或验收通知。
- 服务最终 active/alive；两次启动初期连接拒绝后恢复。根盘 55%；10 个跑单配置指纹保持 `5125162b35c9893e4a9ac7d11c40eeaca7297bd95d7434d6bec70712aa144181`；用户未跟踪 `research.db` 保持 `27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`。
- 性能单独串行复测：CPU4x、80ms/750Kbps、桌面 1440 与手机 390，旧 `4c8e056` 和新 `f86663d` 各 12 个样本（每视口冷热各三次）。旧/新冷首屏中位数桌面 `2148.1/2565.7ms`、手机 `1496.5/1925.4ms`；冷图表 `3207.1/4196.4ms`、`3428.5/3597.1ms`；热首屏 `529.9/876.7ms`、`610.2/569.6ms`。绝对预算通过、热脚本传输 0；多项变慢，不声明不退化或稳定因果关系，更不声明改善 20%。前端 29 项资源与上一版相同，未发布猜测式性能改动。日志 `%TEMP%/mm-resume-perf-{before,after}.log`。

## 总体判定

六批需求的操作链、失败边界和验收入口已逐项核对；这项核对工作完成不等于十二组独立目标全部达成。整页性能目标、生产成熟样本、缺失官方来源、缺失旧历史和损坏文件恢复继续保留未完成状态。不得通过制造样本、猜测对账、调整 ready 指标或发送生产测试订单来勾选它们。
