# K线周期、范围与形态价格标注实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框跟踪进度。

**目标：** 将 K 线周期与历史范围整合到图表控件中，补充常用选项，并让每个蜡烛形态同时显示具体时间与 OHLC 价格；右侧收缩后中间区完全铺开，股票图表全屏使用真正的视口覆盖层。

**架构：** 前端把“周期”和“范围”作为两个独立状态，统一渲染在每个图表卡片的控制栏；后端按市场数据源能力返回真实数据或明确不可用原因，不用其他市场数据补位。形态分析在生成标注时携带触发 K 线快照，图上 tooltip 与解释列表复用同一份数据。

**技术栈：** TypeScript/Express、原生 HTML/CSS/JavaScript、Node.js 内置测试、Playwright 浏览器验收。

---

### 任务 1：先补失败测试，锁定交互契约

**文件：**
- 修改：`tests/kline-upgrade.test.cjs`
- 修改：`tests/chart-analysis.test.cjs`
- 修改：`tests/chart-fullscreen-behavior.test.cjs`

- [x] **步骤 1：编写失败测试**
  - 断言股票图表存在统一控制栏、独立的周期与范围选项，范围包含 `1日/3日/5日/60日/120日/1年/5年`，并且全屏按钮位于同一控制栏。
  - 断言股票请求携带 `interval`，并在不可用周期时展示明确原因。
  - 断言形态对象包含 `open/high/low/close/volume`，解释列表和 tooltip 都输出 `O/H/L/C`。
  - 断言收缩右侧栏后主内容使用剩余宽度，且全屏层固定覆盖视口。

- [x] **步骤 2：运行测试确认失败**
  - 运行：`node --test tests/kline-upgrade.test.cjs tests/chart-analysis.test.cjs tests/chart-fullscreen-behavior.test.cjs`
  - 预期：因新控件、OHLC 字段或布局断言尚未存在而失败。

### 任务 2：扩展 K 线数据与形态快照

**文件：**
- 修改：`src/web/public/chart-analysis.js`
- 修改：`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：`tests/chart-analysis.test.cjs`、`tests/kline-upgrade.test.cjs`

- [x] **步骤 1：实现最小数据契约**
  - 形态生成器从命中的 bar 复制 OHLCV，并保持原有 `time/condition/meaning/confidence/disclaimer` 字段。
  - 股票 K 线请求增加白名单 `interval`；日线走现有真实源，源不支持的周期返回 `success:false`、`dataStatus:'unavailable'` 和明确 `reason`，同时清空旧图数据。
  - 前端用响应状态渲染“暂无数据/当前周期暂不支持/来源不可用”等真实原因。

- [x] **步骤 2：运行针对性测试确认通过**
  - 运行：`node --test tests/chart-analysis.test.cjs tests/kline-upgrade.test.cjs`
  - 预期：全部通过。

### 任务 3：实现周期/范围控制栏与布局修复

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`tests/kline-upgrade.test.cjs`
- 修改：`tests/chart-fullscreen-behavior.test.cjs`

- [x] **步骤 1：实现前端状态与控件**
  - 股票支持常用周期按钮与七档范围，控制栏内按“全屏｜周期｜范围”排列，并在窄屏允许横向滚动。
  - 保留现有日线兼容行为，5 分钟等源不支持周期明确显示原因。
  - 右侧栏收缩时主网格移除固定右侧占位，内容列扩展到可用空间。
  - 全屏按钮进入固定视口遮罩，图表宽高随视口重排，并提供退出按钮与 Escape 退出。

- [x] **步骤 2：运行针对性测试确认通过**
  - 运行：`node --test tests/kline-upgrade.test.cjs tests/chart-fullscreen-behavior.test.cjs`
  - 预期：全部通过。

### 任务 4：显示形态的时间与具体价格

**文件：**
- 修改：`src/web/public/index.html`
- 修改：`tests/kline-upgrade.test.cjs`

- [x] **步骤 1：实现统一格式化**
  - 新增价格格式化和时间格式化辅助函数；同一标注对象在图上 tooltip、下方解释列表和可访问文本中显示 `O/H/L/C`，必要时显示成交量。
  - 保留“通常含义”、识别条件、方向、置信度、免责声明。

- [x] **步骤 2：运行针对性测试确认通过**
  - 运行：`node --test tests/kline-upgrade.test.cjs`
  - 预期：全部通过。

### 任务 5：全量验证、浏览器验收与交付

**文件：**
- 不新增业务文件；只更新验证记录（若需要则更新 `docs/superpowers/`）。

- [x] **步骤 1：运行完整门禁**
  - 运行：`npm test`
  - 运行：`npm run build`
  - 运行：`npm run smoke:web`
  - 运行：`npm run security:scan`
  - 运行：`git diff --check`
  - 预期：所有命令退出码为 0。

- [x] **步骤 2：浏览器验收**
  - 启动本地服务，用 Playwright 等待 `networkidle`，打开股票 K 线。
  - 验证周期/范围控件同栏显示、切换后请求状态清晰、形态详情有 OHLC、收缩右侧栏后内容扩展、全屏覆盖视口且 Escape 可退出。
  - 截图并记录控制台错误；不得以静态 DOM 代替真实交互。

- [ ] **步骤 3：提交和推送**
  - 查看 `git status --short`，确认不暂存 `data/research.db*` 和 `scratch/`。
  - 提交功能改动，按项目既有安全方式推送分支；不直接改生产密钥。
