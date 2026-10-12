# 研究与市场工作区闭环深化实施计划

> **面向 AI 代理的工作者：** 由当前单 Agent 按任务顺序内联执行；每项遵循测试先行、定点审查和小步提交，不派遣子代理。

**目标：** 深化七个既有工作区能力，连通可信数据、历史研究、模拟跟踪和通知结果。

**架构：** 复用 `portfolio-attribution`、期权历史、事件研究、合约历史、预测结算及 Telegram 持久队列。服务端继续负责身份、权限和来源状态；现有 `dashboard-runtime.js` 负责当前工作区渲染和上下文恢复。

**技术栈：** TypeScript、Node `node:test`、现有 Express/SQLite/数据湖、原生 SVG/Canvas 与 Chromium；不新增依赖。

---

## 回滚与数据边界

- 回滚基线：`e0aa0edc2f936156acb178f870b9c3d7029a793a`。
- 当前唯一未跟踪业务文件 `data/research.db` 保留，不加入 Git；既有 stash 不读写。
- 不更改跑单资金、模型路由、冻结标的、自动对照调度和真实交易关闭状态。
- 发布只操作 `/opt/moneymoney/dist` 与 `moneymoney.service`，先备份，部署后核验正式域名和 SHA-256。

## 影响文件

- AI 归因/回放：`src/features/portfolio-attribution.ts`、`src/features/unified-paper-trading.ts`（仅在字段契约确有需要时）、`src/web/server.ts`、`src/web/public/modules/dashboard-runtime.js`、`src/web/public/index.html`、`tests/ai-runner-attribution.test.cjs`、`tests/ai-runner-quality.test.cjs`。
- 期权 IV：`src/features/options-market.ts`、`src/web/server.ts`、`src/web/public/modules/dashboard-runtime.js`、`src/web/public/modules/dashboard-base.css`、`src/web/public/index.html`、`tests/options-iv-term-structure.test.cjs`、`scripts/browser-market-matrix.cjs`。
- Telegram 收件箱：`src/features/telegram-event-results.ts`、`src/web/server.ts`、`src/web/public/modules/dashboard-runtime.js`、`src/web/public/index.html`、样式文件、`tests/telegram-event-results.test.cjs`、`scripts/browser-auth-smoke.cjs`。
- 股票事件对照：`src/features/event-study.ts`、`src/web/server.ts`、`src/web/public/modules/dashboard-runtime.js`、`src/web/public/index.html`、样式文件、`tests/event-study.test.cjs`、浏览器矩阵。
- 合约成本风险：`src/features/contract-panel-history.ts`、`src/features/contract-research.ts`、`src/web/server.ts`、`src/web/public/modules/dashboard-runtime.js`、`src/web/public/index.html`、`tests/contract-panel-history.test.cjs`、`tests/contract-workspace.test.cjs`。
- 预测结算时间线：`src/features/prediction-settlement.ts`、`src/web/server.ts`、`src/web/public/modules/dashboard-runtime.js`、`src/web/public/index.html`、样式文件、`tests/prediction-settlement.test.cjs`、浏览器矩阵。
- UI/性能：仅修改被上述功能实际触及的工作区渲染与缓存文件，并扩展 `tests/market-loading-performance.test.cjs`、`tests/workspace-exclusive-runtime.test.cjs` 或现有 Chromium 脚本。

## 执行任务

### 任务 1：AI 跑单持仓归因与逐轮回放

- [x] 为混合开仓/平仓账户编写测试：已平仓净收益保留；新鲜开放仓位只进入未实现收益；旧关联缺失不猜；过期估值不能生成组合总值。
- [x] 运行 `node --test tests/ai-runner-attribution.test.cjs tests/ai-runner-quality.test.cjs`，确认新案例因当前“全部平仓”门槛失败。
- [x] 调整归因器按闭仓与开仓集合分别校验订单；对开放仓位显式使用账户 mark 与估值状态；保留基准时点和成本门槛。
- [x] 将历史列表按动作/结果筛选，并在详情中连接已有快照、证据与订单 ID；管理员专属接口权限沿用现有实现。
- [x] 重跑两组测试、浏览器跑单工作区检查，并审查市场、账户和视点时效。

### 任务 2：ATM IV 曲线与真实快照比较

- [x] 为图表序列与当前 IV 表格一致性、缺失 expiry 不插值、只有两个真实快照才可比较补行为测试。
- [x] 先运行 `node --test tests/options-iv-term-structure.test.cjs` 确认失败。
- [x] 在现有选项面板增加曲线/表格切换、键盘焦点证据和同标的快照日期选择；复用已有 `/api/options/history/compare`。
- [x] 为三主题和窄屏增加 Chromium 断言，再运行 `node --test tests/options-iv-term-structure.test.cjs`。

### 任务 3：Telegram 结果收件箱

- [x] 为当前覆盖接口返回的等待/结果状态建立管理员列表、原提醒链接、来源、时间与 ACK/重试交互测试。
- [x] 运行针对测试并在 `npm test` 全量测试中验证新增行为。
- [x] 只读接入现有持久投递记录；延迟/修订沿用结果状态与幂等键；拒绝访客读取聊天级记录。
- [x] 用本地 fixture 验证等待、来源失败、已发布、修订、重复投递；运行本地浏览器授权/矩阵测试，未发送生产测试消息。

### 任务 4：股票事件前后对照

- [x] 覆盖股票事件身份、发布时间边界、同区间基准和数据缺口案例。
- [x] 运行 `node --test tests/event-study.test.cjs` 及全量领域测试。
- [x] 在事件工作区连接已有 `/api/event-studies` 与 K 线定位；价格窗口和成交量使用同一时点和标的。
- [x] Chromium 与领域测试通过；原文跳转保留来源校验。

### 任务 5：合约持仓成本与风险

- [x] 覆盖历史 funding 与仓位合约/交易场所/单位不匹配、区间缺口和缺少保证金字段时的行为。
- [x] 运行针对领域测试与全量测试。
- [x] 从显式模拟账本血缘汇总已记录费用/滑点，并与同源 funding/OI/basis 区间对齐；不插值、不推算强平价格。
- [x] 领域测试、`smoke:contracts` 及四市场隔离验收通过。

### 任务 6：预测市场结算进度图

- [x] 覆盖官方证据、平台判定、最终结算、争议和未核验的状态顺序与时间字段。
- [x] 运行 `node --test tests/prediction-settlement.test.cjs` 及全量测试。
- [x] 沿用现有结算查询，按来源与证据时间生成时间线；缺少阶段时显示未知/待核验。
- [x] Chromium 与预测市场领域验收通过；未核验状态保持显式。

### 任务 7：工作区性能与发布

- [x] 扩展现有测试验证隐藏工作区没有多余请求、切换时取消旧请求、排序/筛选恢复、三个主题和手机布局。
- [x] 实现仅对当前工作区加载的必要 UI 控件；沿用现有请求缓存和性能记录，不新增依赖或布局方向。
- [x] 运行 `npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run smoke:contracts`、`npm run smoke:experience`、`npm run security:scan`、`git diff --check`。
- [x] 完成桌面/移动 Chromium 和三个主题检查；回看六项功能清单、权限、来源、缺失数据状态及用户工作区边界。
- [ ] 提交代码与发布记录，推送当前分支；备份、校验哈希并部署当前 VPS，验证服务、正式域名和版本，保留回滚目录。
