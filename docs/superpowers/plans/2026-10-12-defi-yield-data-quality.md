# DeFi 收益质量与来源时点计划

> **面向 AI 代理的工作者：** 由当前 Codex 单 Agent 按本计划顺序执行；不启动子代理。

**目标：** 防止缺失或非法的 DeFi 池字段获得虚假风险加分，并让页面/API明确区分来源时点、抓取时点、缓存、空结果和来源故障。

**架构：** 在现有 `yield-quality` 服务内注入 Provider 与时钟，输出统一市场/来源/状态/证据字段；风险字段未知时不套用“低风险”奖励，现有收益卡片仅显示状态与原因，不改变布局。

**技术栈：** TypeScript、Node test runner、ts-node、jsdom；不新增依赖或数据源。

---

### 任务 1：收益池字段质量和评分

**文件：**
- 修改：`src/features/yield-quality.ts`
- 测试：`tests/yield-quality-data-quality.test.cjs`

- [x] 先写回归测试：未知无常损失/稳定币/奖励字段不伪装成已确认的安全属性；非法 7 日变化不得按 0% 加分。
- [x] 运行 `node --test tests/yield-quality-data-quality.test.cjs`，预期因缺少 `createYieldQualityService` 导出及质量状态而失败。
- [x] 实现可注入的抓取、时钟和本地缓存；缺少协议/资产/链身份或有效 TVL/APY 时拒绝该池，未知风险字段保留警告且不奖励正向分数。
- [x] 重新运行上述测试，确认空结果、坏响应、上游故障恢复和缓存命中均符合契约。

### 任务 2：API 信封与卡片状态

**文件：**
- 修改：`src/web/server.ts`
- 修改：`src/web/public/modules/dashboard-runtime.js`
- 测试：`tests/yield-quality-data-quality.test.cjs`

- [x] API 返回 `market/instrument/dataStatus/source/sourceUpdatedAt/retrievedAt/updatedAt/reason/evidenceRefs`；上游失败返回不可用状态，成功空数组保留空结果。
- [x] 现有卡片展示来源、抓取时间、未核验来源时间、真实原因和逐池缺项；继续使用现有主题变量和卡片布局，并转义不可信文本。
- [x] jsdom 回归测试覆盖空结果状态与来源时点说明；运行 `node --test tests/yield-quality-data-quality.test.cjs`。

### 任务 3：审计与交付

**文件：**
- 修改：`docs/audits/2026-10-12-workspace-capability-matrix.md`

- [x] 记录 DeFi 收益池字段质量、评分门槛和来源时点限制；不声称来源 SLA 或实时性。
- [x] 运行完整测试、构建、Web/认证/浏览器冒烟、安全扫描与 `git diff --check`。
- [x] 单 Agent 审查当前 diff，确认没有越权或数据范围扩大。
- [x] 提交、推送并依现有哈希备份/原子切换流程部署；保留远端回滚与本地用户数据库。
