# 八项完善实施计划

> 面向 AI 代理：使用 subagent-driven-development 与 test-driven-development，主线程统一接线、全量验证和发布。

**目标：** 完成用户批准的八项建议：运行自检、性能定位、历史证明、证据图、情景可视化、共用AI案例、研究预注册、复查生命周期。
**架构：** 复用已有 SQLiteStateStore、固定快照读取、研究项目和压力引擎；只新增版本化命名空间及可选字段。现有管理员鉴权、CSRF、幂等、版本、内容 Hash 不放宽。
**技术栈：** TypeScript/Express/SQLite、原生紧凑界面、node:test、Playwright，子 agent 全部 gpt-6-luna。

基线 5912d71；已有验证文档的本地修改保留，data/research.db 不提交不覆盖。无真实交易、模型调用、通知或生产故障注入。用户已批准八项设计与持续执行，按下述边界直接实施。

## 所有权与顺序

1. 运行自检：scripts/lib/soak-run-state.cjs、scripts/soak-supervisor.cjs、scripts/long-session-smoke.cjs、tests/soak-run-state.test.cjs。先保存原19分钟中断记录，以进程身份/启动时间/心跳判断 running、interrupted、failed、passed。监督父进程退出能落盘；休眠/缺口>5min拒绝通过；重跑独立ID与时钟，不能续接旧轮。监督器可启动单轮并观察，不无限重启。短进程结束/休眠模拟测试后，用最终干净构建重开24h。
2. 性能定位（主线程）：scripts/web-loading-benchmark.cjs 及现有前端性能模块。冻结原1987bd7基线与同条件36样本夹测；补认证、首行情、脚本/长任务、首次绘图阶段诊断，仅主线程独占测量。按证据试一个候选，不达20%撤回运行时改动，诊断保留。
3. 历史数据证明：新增 saved-evidence-proof 服务/管理员路由/紧凑UI，读取固定快照现有证明，列出fileHash/币种/时段/覆盖缺失，拒绝回填原始证明。管理员可明确关联同身份新快照为重新采集版本，有保存理由/双引用Hash/幂等；此动作不自动采集或替换引用。
4. 证据关系图：新增 research-evidence-graph 服务/路由/UI，沿项目已保存links与conclusions生成节点边；参数/实验/快照存在明确引用才建立边。逐节点固定/当前Hash和缺失/修订/受影响路径，跨市场拒绝，SVG可键盘访问及表格等价输出，未知不猜测。
5. 情景可视化：扩展 saved-stress-scenarios 及独立 visual 模块/路由/UI，用保存链/BSM计算最多9x9价格IV网格（遵守现有±20%等引擎边界），断点来自已保存曲线或明确插值标记。两个保存版本按身份/币种/冲击对齐比较，无法对齐给原因；HTML离线有静态图和等价表。
6. 共用AI案例：新增 model-neutral case library，固定市场/身份/时点/目标/模型无关输入Hash。只接受服务器读取的已保存案例与实际输出，严格核验输入相等，模型/提示差异独立记录；失败/取消留分母。校准分箱、Wilson区间、Brier均值区间标记方法及不足样本，无新增评分或模型调用。复用现有 cohort 和 UI。
7. 预注册与稳健性：新增 research-preregistration 服务/路由/UI，项目/假设/固定引用/主要指标/样本/停止条件/参数试验预算冻结、Hash、版本和审计。首次登记发生在已有结果后标记 retrospective，不冒充预注册。关联每次保存实验记录成功失败及参数Hash，不运行新实验；展示试验总数/缺失成本/样本泄漏未知，复用robustness而非发明统计结论。
8. 队列生命周期：扩展review-queue store/router/UI；完成理由必填新操作（旧记录缺理由保持未知兼容），分页与筛选kind/completed/archived，批量最多50、逐项明确版本/状态/幂等。完成与read/pin/snooze分开；显式归档保留原条目与审计，重新打开生成状态修订不篡改原完成证据。归档默认从活动列表隐藏，可查历史原证据。

## 每项执行步骤与门槛

- [x] 为每项先写 node:test 失败用例并实际记录 red，再实现和定向 green；变更源码后检查 tsc。
- [x] 运行用例：进程被杀/时间间断/陈旧PID；性能阶段缺失不置零；旧快照不可验证；跨市场图拒绝；部分覆盖和未对齐版本；IV/到期/溢出；不同AI输入拒绝/失败保留/少样本；后验登记标记/试验记录去重；复查批量冲突/重复请求/归档不丢历史。
- [x] 主线程接线 src/web/server.ts、scripts/copy-web-assets.js；新增功能继续 research 延迟加载。agent 不修改这两个共享文件，不提交、不全构建、不部署。
- [x] 定向 node --test tests/<new>.test.cjs、npm run build、npm test、安全扫描、git diff --check、研究浏览器CRUD与权限、三主题375/390/1003/1440和离线HTML打印。
- [x] 独立审查修复后提交推送，CI通过，再备份恢复校验、干净导出构建、dist部署、资源Hash/四市场/私有权限/runner指纹验收。
- [ ] 最终固定构建监督运行24h，原轮次记录interrupted；功能发布、性能20%和24h分开判定。后台跟进在中断、失败、完成时报告，不篡改时长。
