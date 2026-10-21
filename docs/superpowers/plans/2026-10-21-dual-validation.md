# 双轨策略验证实现计划

> 面向AI代理：使用executing-plans逐项执行；用户已确认双轨及嵌入现有研究区的布局，单Agent，不创建子Agent。

目标：回顾性历史留出与事前登记未来验证明确分开，均复用现有受限解释器、BacktestEngine、实验表和SQLite元数据。不创建订单、调用模型或修改现有跑单。

架构：历史实验增加可选窗口起点，指标用窗口前数据暖机，成交/资金从窗口起点独立计算。未来计划在既有SQLite文档中预览、确认及控制，冻结明确观察/版本/实验/来源/区间/成本引用；管理员到期手动读取asOf归档，结果首次保存在现有实验表。无后台采集或定时执行。

技术栈：现有TypeScript/Express、SQLiteStateStore、Parquet/asOf、原生按需JS、node:test与Chromium。

## 任务1：窗口成交研究

文件：修改src/features/restricted-experiment.ts；测试tests/restricted-validation.test.cjs。

- [ ] 写失败测试：窗口前成交不进入新账户，第一根窗口K线只能在下一根开盘成交，保留窗口前指标暖机；旧输入结果不变。
  ```js
  const result=runRestrictedHistoricalExperiment({...input,windowStart:bars[4].time});
  assert.ok(result.signals.every(s=>s.signalTime>=bars[4].time));
  assert.equal(result.backtest.startingBalance,1000);
  ```
- [ ] 运行node --test tests/restricted-validation.test.cjs，确认缺少窗口行为失败。
- [ ] 增加windowStart可选参数；窗口时间必须有限且不晚于asOf；成交索引相对窗口重建，费用/滑点/资金比例仍来自冻结版本。非窗口调用保持原语义。
- [ ] 同一快照/窗口/版本得到同一实验ID；不强制平仓，不填补缺口。

## 任务2：双轨服务与未来计划

文件：新增src/features/restricted-validation.ts；测试同上。

- [ ] 先测retrospective/preview/confirm/control/evaluate缺失，再实现RestrictedValidationStore。
  ```js
  const preview=store.preview(observationId,{count:20});
  assert.ok(preview.from>clock());
  assert.throws(()=>store.evaluate(preview.id,preview.revision),/确认|到期/);
  ```
- [ ] 历史留出固定70%分割，至少8根；只读取原实验asOf并匹配原数据Hash，明确回顾性、不作为晋级依据。
- [ ] 未来计划仅美股完整注册身份，20–500根且最长90天；默认起点为当前周期之后第二个边界，也允许明确的未来对齐起点。计划最多100个，保留所有历史。
- [ ] preview只保存范围预览；confirm要求未来区间尚未开始和版本一致，冻结Hash及确认时间。pause/resume只控制手动评估；cancel终态保留记录，不改变冻结区间。
- [ ] evaluate到期后才读取冻结来源、周期、标的及to时点的归档；使用既有SQLite租约及revision，暂停/取消后的迟到结果不保存。首次结果ID在计划预览时固定，实验saveOnce保留第一份结果，不猜测关联。
- [ ] 只在窗口完整、发布时间可核验且没有拒绝条件时给出理论模型的事前登记验证指标；缺口、无数据、未成熟及少样本明确提示，始终不允许自动晋级/监控。

## 任务3：私人API与现有研究区

文件：新增src/web/restricted-validation-routes.ts、src/web/public/restricted-validation-workspace.js；修改server.ts、copy-web-assets.js、restricted-forward-workspace.js；测试tests/restricted-validation-interface.test.cjs。

- [ ] 失败测试覆盖管理员/CSRF沿用、市场/观察归属、拒绝客户端行情与指标、无自动请求、明确确认、切换清除。
- [ ] 路由/api/research/validation提供历史留出、计划预览/确认/列表/读取/控制/评估；统一市场/标的/来源/状态/时间/原因/证据引用，私人no-store。
- [ ] 在已选择的手动观察内嵌折叠“双轨验证”，沿用三个主题；先预览再确认未来计划，明确不会自动运行，展示结果、成本、窗口、Hash及JSON导出。隐藏页面和切换上下文取消请求；不向访客展示私人结果。

## 任务4：验证与发布

文件：扩展scripts/restricted-forward-smoke.cjs，更新平台执行账本及本计划发布凭据。

- [ ] 隔离SQLite/Parquet和已有测试时钟验证回顾性结果、确认取消、未来未到期、到期真实归档、重复结果固定、暂停/取消、重载、三主题/桌面手机/访客边界；测试不调用真实模型或写生产订单。
- [ ] 单点自审后冻结源码；运行npm test、build、smoke:web/auth/browser/live-kline/professional/contracts/research-depth、数据资产/历史实验/双轨专用浏览器、security:scan、git diff --check，串行执行并记录实际结果。
- [ ] 全部通过再提交推送，干净导出重新构建并复验，备份/Hash校验/原子切换/健康与正式域名只读检查。仅操作moneymoney.service，核对10个原跑单配置指纹，保留回滚与用户数据库/数据湖/scratch。冷加载20%目标独立保留未完成。

说明：本功能不宣称完成自动前向撮合、全候选审批门控、公司行动归因或整个十二组计划。无新增依赖，无新的账户账本。主SQLite与既有实验库是两库，显式预分配结果ID支持崩溃后按引用恢复，不声称跨库原子事务。

## 本次实现及验证记录

- 任务1–3已接线：窗口前仅暖机、不带入持仓；历史留出固定原快照70%分割且不填入OOS指标；未来计划预览→事前确认→到期手动评估，支持暂停/恢复/取消/重试、显式结果ID恢复及Hash核验。
- 原实验元数据Hash、策略版本、来源、成本和仓位固定；加载归档期间引用变化也拒绝迟到结果。版本时间或登记时间不成立时拒绝。租约到期不保存，无自动续租或自动重试任务。
- 私人接口为/api/research/validation，沿用全局认证/CSRF，禁止客户端提交行情、指标及审批结论。现有研究区→受限策略→手动前向观察内嵌双轨面板，默认折叠，没有初始化请求。到期按钮采用服务端时间判定，避免客户端时钟偏差。
- 未来窗口使用连续日历周期，不冒充交易所交易日历；空档可能是休市或缺失时保持未核验。报价发布时间晚于对应收线不能假定当时可成交。只在完整且有已平仓理论样本时填入事前登记模型指标；这不是实际撮合、独立重复验证或候选审批证据。旧只读晋级审计尚未消费新结果，不因新指标自动放行。
- 结果从1000 USD理论资金重新计算，费用/滑点/整股/资金比例仍使用旧引擎；不会分配账户、创建订单或改变现有跑单。已有实验结果及计划保留，不覆盖旧业务历史。
- TDD已复现并修复缺失窗口、版本/成本、训练元数据变化、在途引用变化、结果Hash篡改及浏览器时钟偏差。18项新增测试通过。固定源码全量379个隔离文件、1838项、失败0、退出码0，日志%TEMP%/mm-dual-final-tests.log。
- 隔离SQLite/真实Parquet及受控时钟Chromium通过历史留出、未来预览/确认/暂停/恢复/到期读取、重载/取消、JSON下载、三主题/1440与390像素及访客拒绝。外网、模型与Telegram关闭；夹具不是市场数据，也不证明真实未来窗口已经成熟。截图mm-restricted-forward-browser-E1UsLP，手机金色截图已目视检查。
- 当前进入其余完整冒烟及安全扫描；尚未提交、推送或部署。上节任务4仍待发布凭据，不能使用旧版本门禁代替本次结果。整页20%目标未完成。

更新：固定源码已通过构建、Web/认证/四市场/实时图表/专业研究/合约/研究深度七类冒烟，以及数据资产、历史实验、双轨验证三类专用Chromium（mm-dual-gate-*）。双轨截图mm-restricted-forward-browser的最终路径见对应日志；安全扫描966个跟踪文件、git diff --check和用户数据库Hash核对通过。自审确认无新增定时器、模型调用、账户或订单，旧历史输入不增加windowStart参数。接下来才进行提交、干净导出和生产发布；尚不把真实未来窗口的观察结果视为已取得。
