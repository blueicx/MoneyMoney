# 分析师共识与基本面质量扩充实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将分析师共识和基本面质量两个股票工作区扩展为可追溯的单股研究卡片，并保持当前市场选择、MoneyMoney 主题和真实交易关闭边界。

**架构：** 后端在现有 StockAnalysis/SEC 数据适配器上补充结构化字段和可验证来源信息；前端在现有工作区数据卡片内增加目标价、分析师动态、观点事实摘要、基本面因素和轻量历史趋势。没有公开观点原文时只输出结构化事实摘要，不生成伪引语。

**技术栈：** TypeScript、Node.js 原生测试、单页 HTML/CSS/JavaScript、SEC EDGAR Company Facts、StockAnalysis 公共页面解析。

---

### 任务 1：锁定分析师和基本面数据契约

**文件：**
- 创建：`tests/analyst-consensus.test.cjs`
- 创建：`tests/fundamental-quality.test.cjs`
- 修改：`src/features/analyst-consensus.ts`
- 修改：`src/features/fundamental-quality.ts`

- [ ] **步骤 1：编写失败的测试**

在 `tests/analyst-consensus.test.cjs` 中加载 `dist/features/analyst-consensus.js` 的纯函数或导出结果构造器，断言最近动态包含 `sourceUrl`、`sourceExcerpt` 和 `summaryZh`，并断言没有来源文本时 `sourceExcerpt === null`。在 `tests/fundamental-quality.test.cjs` 中用固定指标构造结果，断言结果包含 `supportingFactors` 和 `riskFactors`，每一项包含 `label`、`value`、`reason`。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run build; node --test tests/analyst-consensus.test.cjs tests/fundamental-quality.test.cjs`  
预期：因新字段或测试所需导出不存在而失败。

- [ ] **步骤 3：编写最少实现代码**

在分析师动态类型中增加 `sourceUrl: string`、`sourceExcerpt: string | null`、`summaryZh: string`；从已有的机构、动作、评级和目标价字段生成事实摘要，来源文本无法从公开结构化 payload 验证时返回 `null`。在基本面结果中按现有评分阈值和 `metrics` 生成支持因素/风险因素数组，不改变原有评分和信号字段。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run build; node --test tests/analyst-consensus.test.cjs tests/fundamental-quality.test.cjs`  
预期：新增测试全部通过。

- [ ] **步骤 5：Commit**

```bash
git add tests/analyst-consensus.test.cjs tests/fundamental-quality.test.cjs src/features/analyst-consensus.ts src/features/fundamental-quality.ts
git commit -m "feat: extend analyst and fundamental research contracts"
```

### 任务 2：验证现有股票 API 返回扩展字段

**文件：**
- 修改：`tests/stock-api.test.cjs`
- 修改：`src/web/server.ts`

- [ ] **步骤 1：编写失败的测试**

在 `tests/stock-api.test.cjs` 中增加静态契约断言：分析师路由继续指向 `getAnalystConsensusSnapshot`，基本面路由继续指向 `getFundamentalQuality`，并断言新字段名在路由返回路径中没有被删除或过滤。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run build; node --test tests/stock-api.test.cjs`  
预期：新字段契约断言失败，直到服务端明确透传扩展结果。

- [ ] **步骤 3：编写最少实现代码**

修改 `src/web/server.ts` 的两个现有股票路由，使成功响应继续返回完整 snapshot/result 对象，不手工挑选旧字段；保留现有错误状态、认证边界、缓存和当前股票参数。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run build; node --test tests/stock-api.test.cjs tests/analyst-consensus.test.cjs tests/fundamental-quality.test.cjs`  
预期：API 契约和两个数据模块测试全部通过。

- [ ] **步骤 5：Commit**

```bash
git add tests/stock-api.test.cjs src/web/server.ts
git commit -m "feat: expose research detail fields through stock APIs"
```

### 任务 3：实现两个工作区的研究内容展示

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`tests/market-workspace-flow.test.cjs`

- [ ] **步骤 1：编写失败的测试**

在 `tests/market-workspace-flow.test.cjs` 中断言页面包含 `analyst-actions`、`analyst-price-target-range`、`analyst-history-trend`、`fundamental-supporting-factors`、`fundamental-risk-factors` 和 `fundamental-history-trend` 标识，并断言分析师动态模板包含姓名、机构、目标价变化、来源链接和“事实摘要”降级文案。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run build; node --test tests/market-workspace-flow.test.cjs`  
预期：因新区域尚未渲染而失败。

- [ ] **步骤 3：编写最少实现代码**

扩展 `renderAnalystConsensus`：增加目标价区间、分析师动态列表、来源链接/短摘录或结构化事实摘要、历史评分趋势和明确的数据不足状态。扩展 `renderFundamentalQuality`：增加支持因素、风险因素、年度历史轻量趋势和缺失字段状态。所有用户文本通过现有转义函数输出，外层折叠框保持隐藏，刷新键继续位于状态徽章左侧并垂直居中。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run build; node --test tests/market-workspace-flow.test.cjs tests/market-workspace-navigation.test.cjs`  
预期：工作区结构、布局和导航测试全部通过。

- [ ] **步骤 5：Commit**

```bash
git add src/web/public/index.html tests/market-workspace-flow.test.cjs
git commit -m "feat: expand analyst and fundamental workspace cards"
```

### 任务 4：全量回归和安全验收

**文件：**
- 修改：无
- 测试：`tests/analyst-consensus.test.cjs`、`tests/fundamental-quality.test.cjs`、`tests/stock-api.test.cjs`、`tests/market-workspace-flow.test.cjs`

- [ ] **步骤 1：运行全量验证**

运行：`npm test`  
预期：全部测试通过，当前基线 245 项测试不减少。

- [ ] **步骤 2：运行网页、安全和格式验证**

运行：`npm run smoke:web; npm run security:scan; git diff --check`  
预期：网页冒烟通过，密钥扫描通过，diff 无空白错误。

- [ ] **步骤 3：Commit 验收前代码**

```bash
git log -3 --oneline --decorate
git status --short
```

预期：仅包含本计划相关提交和原有未跟踪用户文件，不暂存 `docs/antigravity-plans/`、`docs/notes/`、`tests/kline-upgrade.test.cjs`。

### 任务 5：构建、线上发布与浏览器验收

**文件：**
- 修改：`docs/handover-2026-09-02.md`

- [ ] **步骤 1：构建并计算产物哈希**

运行：`npm run build`，从 `dist` 根目录创建包含顶层 `web/` 的唯一归档，并记录归档、`dist/web/server.js`、`dist/web/public/index.html` 的 SHA-256。

- [ ] **步骤 2：备份并发布 VPS dist**

上传归档到 `ubuntu@100.54.222.54`，在 `/opt/moneymoney` 创建唯一 staging、backup 和 rollback 目录；校验 `web/server.js` 与 `web/public/index.html` 后原子替换 `/opt/moneymoney/dist`，只重启 `moneymoney.service`，不修改 Nginx、TLS、VPN、密钥或 Telegram 配置。

- [ ] **步骤 3：验证服务和远端产物**

确认 `moneymoney.service` 为 active，`curl -fsS http://127.0.0.1:3001/api/health/live` 返回 `ok=true`，远端两个文件哈希与本地一致，backup 和 rollback 目录存在。

- [ ] **步骤 4：浏览器实测**

在 `https://bluetrade.bbroot.com/?market=stocks&workspace=analyst&instrument=AAPL` 和基本面工作区检查：右侧选股后内容切换到 AAPL；分析师动态显示姓名/机构/动作/目标价，来源文本缺失时显示事实摘要；基本面显示趋势与因素；刷新键与状态徽章同一行、刷新键在左、徽章在右且垂直居中；外层折叠框不可见。

- [ ] **步骤 5：记录并推送交接文档**

将提交、测试、浏览器测量值、VPS 备份/回滚路径和哈希追加到 `docs/handover-2026-09-02.md`，然后运行 `git diff --check`、提交并推送 `codex/stock-free-data-sources`。
