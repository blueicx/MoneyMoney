# 二十项研究与日常体验深化

**批准范围：** 用户对上一条二十项建议回复“全部完成”。沿用当前三个主题与工作区，不重设计导航、不使用子 agent、不修改现有跑单参数或创建生产测试订单。

**基线：** `8ad9eee`；运行产物 `0a59936`。未跟踪 `data/research.db` 保留。现有能力不能因存在文件就标为完成；只有行为测试、接线和浏览器验收通过才可勾选。

**实现方式：** 当前隔离 worktree 顺序执行 writing-plans → executing-plans → TDD → 自检 → 完整验证 → 备份部署。新增计算依赖保存/已加载的真实数据；不额外扫描市场、不调用模型。只读研究不能变更策略、账户和提醒。

## 范围与复用清单

| 原建议 | 复用入口 | 本轮验收重点 |
|---|---|---|
| 1 参数实验室 | chart-strategies / chart-analysis | 有界参数组、训练/验证/样本外、成本及 Hash，不挑最优排名 |
| 2 共振与冲突 | 同批 StrategyChartPoint | 按同根和方向解释；相关策略只分家族，不制造概率 |
| 3 多周期联动 | 股票 companion / multi-period / shared-cursor | 不读取时点之后的收线结果，标明缺失和形成中 |
| 4 质量热力图 | 点位 outcomes | 按策略、周期、方向及期限分组，未成熟/缺口不计入胜率 |
| 5 画线提醒 | trading-chart / chart price reminder | 预览确认与既有提醒生命周期，不创建隐式订单 |
| 股票深化 | stock-capital-history / guru / event studies | 身份、申报期、时点与来源，不推算实时13F |
| 期权深化 | options-market / scenario / payoff | 真实报价、有限计算能力和明确缺失原因 |
| 虚拟币深化 | contract-research / funding-ledger / panel-history | 同来源口径，实际资金费与未来假设分离 |
| 预测市场深化 | relationship-audit / settlement / history | 规则、结果公布、平台结算和争议分别展示 |
| 6 决策漏斗 | ai-runner-diagnostics | 只统计明确门控，未知不充当通过、订单不充当成交 |
| 7 模型变更与公平对照 | comparison scheduler / diagnostic groups | 已记录模型版本分组，不重配当前跑单 |
| 8 执行质量 | runner-execution-evidence / attribution | 费用、点差、延迟与血缘，未归档保持未知 |
| 9 实验毕业 | strategy-candidates / drift | 未达门槛不能监控，不自动恢复或实盘 |
| 10 多币种归因 | portfolio-attribution / history | 未知汇率和基准不补零 |
| 11 风险预算 | tail-risk / exit-stress / scenarios | 只读分析，调整建议不变订单 |
| 12 证据重放 | experiment-runner / robustness | Hash、种子、成本、失败记录可追溯 |
| 13 到期复盘 | decisions / decision-intelligence | 不改写创建时假设，无证据不强判 |
| 14 Telegram处理 | action center / existing callbacks | 已读、稍后、静默和安全深链共用状态 |
| 15 通知完整性 | telegram-event-results coverage | 缺失检查时间、未来事件、重复记录与结果证据 |
| 16 摘要 | watchlist action-center / summaries | 普通信号静默不影响风险及来源故障 |
| 17–18 抽屉/密度 | workflow-polish / evidence / prefs | 恢复上下文、三个主题、私有与功能区隔离 |
| 19 性能预算 | web-loading-benchmark / chart counters | 同环境测量、明确越限，不能凭体积宣称提速 |
| 20 故障恢复 | state-backup / drills / polling leases | 隔离恢复测试，不改线上数据 |

## 顺序任务

- [x] A. 新增 `tests/chart-research.test.cjs`，先验证缺失导出失败；实现 `src/web/public/chart-research.js` 的成熟质量分组、共振冲突、有界参数实验及无未来时点对齐。每个实验保留输入/参数内容指纹，研究样本不足不排名。
- [x] B. 新增 `chart-research-controls.js`，仅在图表折叠面板展开且用户点击分析时运行；接入股票/虚拟币当前数据、策略、证据与费用假设，支持点回已有解释，参数实验不改当前策略。
- [x] C. 给 AI 诊断增加逐轮门控漏斗与按模型版本覆盖统计；先补未知门控、重复、未来时间和订单未成交测试，再实现并接入既有诊断面板。
- [x] D. 通知结果完整性补失败测试，修正 null 检查时间、未来事件和重复交付诊断；保持既有发送/重试/ACK行为不变，覆盖结果与等待状态不混淆。
- [x] E. 对表中复用能力逐项运行行为测试与对应冒烟；补缺失的 UI/API 接线。完成 Chromium 三主题、桌面/手机、权限与上下文验收后才标记验收通过。未完成的能力明确保留，不以静态存在替代验收。
- [ ] F. 全量测试、构建、Web/认证/浏览器/实时图表/合约/行动中心/自动对照冒烟、安全扫描、差异检查、加载预算测量；提交推送，备份原产物、校验 Hash、仅重启 moneymoney.service，正式域名只读核验并保存回滚路径。

## 失败测试命令

```powershell
node --test tests/chart-research.test.cjs tests/chart-research-controls.test.cjs
node --test tests/ai-runner-diagnostics.test.cjs tests/telegram-event-results.test.cjs
```

研究页预期：无数据明确原因，过期停止形成中预览，20个以下成熟样本胜率为空；参数网格最多12组、数据最多2000根，不新增行情或模型请求。未知成本仅显示毛表现。时间划分边界跨越的观察剔除，形成中不参与历史统计。
