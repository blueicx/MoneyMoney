# MoneyMoney 市场扩展与加载优化第二轮实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 在不混淆市场作用域、不启用真实交易的前提下，修复干净检出构建基线，降低首屏和数据源等待时间，并把总体、股票、期权、虚拟币、预测市场的研究/绩效入口继续做成可用的专属工作区。

**架构：** 保留现有 TypeScript + Express + SQLite `state_documents` 架构和原生 HTML/JS 页面。所有请求、缓存、雷达、绩效输出继续带 `scope` 或 `instrumentId`；总体才加载跨资产数据，市场页只加载自己的数据。每条轨道使用独立测试和小提交，失败时保留上一条已发布提交。

**技术栈：** Node.js 18+、TypeScript、Express、SQLite、Node test runner、GitHub Actions、Playwright/浏览器冒烟。

---

## 固定边界

- 不修改 Nginx、TLS、VPN、Telegram 轮询、密钥和系统级配置。
- 不实现真实交易、AI 自动下单或绕过访客只读权限。
- VPS 只备份并替换生成的 `dist`，重启 `moneymoney.service`。
- 当前工作树已有未跟踪的 `src/utils/platform-command.ts` 和 `docs/notes/`，执行前先审查；不得把与本轮无关的用户文件混入提交。
- 预测市场深度/结算字段只有在真实适配器和测试同时存在时才可加入类型与 UI。

## 轨道一：干净检出构建与数据源健康基线

**文件：**

- 修改：`src/utils/platform-command.ts`（仅在确认它是当前源码必需且无敏感内容时纳入版本）
- 修改：`.github/workflows/*`（只在现有工作流确实缺少依赖安装步骤时修改）
- 修改：`src/features/source-health.ts`
- 修改：`src/web/server.ts`
- 测试：`tests/source-health.test.cjs`、新增 `tests/clean-build-contract.test.cjs`

- [ ] **步骤 1：编写失败测试**

  测试干净检出必须能解析所有 `platform-command` 导入；测试 `/api/health/readiness` 对单个慢源在总预算内返回部分状态，而不是无限等待。

- [ ] **步骤 2：运行红灯**

  运行：`npm run build`、`npm test -- --test-name-pattern="source health|clean build"`。

  预期：干净检出构建复现 `Cannot find module '../utils/platform-command'`，慢源测试复现 readiness 超时。

- [ ] **步骤 3：实现最小修复**

  将缺失的跨平台命令辅助文件作为普通源码纳入版本；保持 `curl.exe`/`curl` 选择逻辑不变。将健康探测改为有限并发、单源超时和 `Promise.allSettled` 聚合，返回 `ok/stale/unavailable`，不因一个源阻塞全部结果。

- [ ] **步骤 4：验证绿灯**

  运行：`npm run build`、`npm test`、`npm run security:scan`。预期干净构建成功，源端失败测试仍能保留其他源结果。

- [ ] **步骤 5：提交**

  提交：`fix: 修复干净检出构建与健康探测预算`。

## 轨道二：生产加载缓存与首屏性能

**文件：**

- 创建或修改：`src/features/performance-cache.ts`
- 修改：`src/features/source-health.ts`、`src/web/server.ts`
- 修改：`src/web/public/index.html`
- 测试：新增 `tests/performance-cache.test.cjs`、`tests/market-loading-performance.test.cjs`

- [ ] **步骤 1：编写失败测试**

  覆盖同一 `scope/source/key` 并发只发一次上游请求；fresh 命中不请求上游；stale 先返回旧数据并后台刷新；expired 刷新失败返回明确过期状态；切换市场后旧响应不能覆盖新市场。

- [ ] **步骤 2：运行红灯**

  运行：`node --test tests/performance-cache.test.cjs tests/market-loading-performance.test.cjs`。

  预期：生产接口尚未接入统一缓存或旧响应保护不足时失败。

- [ ] **步骤 3：实现最小生产接入**

  为公开 GET 数据建立 `scope:source:key` 缓存键，支持 ETag、超时、stale-while-revalidate 和请求去重；先接入 `/api/market-ticker`、`/api/screener` 和公开研究摘要。前端为市场筛选、总体跨资产雷达和大盘条分别使用 `AbortController` 与 scope token，重型区块只在当前作用域/打开面板时加载。

- [ ] **步骤 4：验证绿灯**

  运行完整测试、`npm run build`、`npm run smoke:web`，并用浏览器记录四次市场切换的首屏时间、网络请求数量和控制台错误。预期旧响应为 0，慢源有可解释状态，首屏不触发其他市场重型请求。

- [ ] **步骤 5：提交**

  提交：`perf: 接入按市场隔离的请求缓存与懒加载`。

## 轨道三：总体与市场专属工作区体验

**文件：**

- 修改：`src/web/public/index.html`
- 修改：`src/features/unified-instruments.ts`、`src/features/event-evidence.ts`
- 修改：`src/web/server.ts`
- 测试：`tests/market-scope-integration.test.cjs`、新增 `tests/market-workspace-data.test.cjs`

- [ ] **步骤 1：编写失败测试**

  覆盖总体显示跨资产联动回撤雷达，股票只显示股票指数/宽度/七姐妹和股票事件，期权只显示期权快照，虚拟币只显示 Binance/链上/资金费率，预测市场只显示预测事件；每个响应包含 `sourceStatus` 和 `freshness`，不可用时不得借用其他市场数据。

- [ ] **步骤 2：实现最小功能**

  把现有统一详情、事件时间线、市场大盘条和雷达卡片的 scope 校验集中到服务端；前端每个市场工作区只渲染对应字段，并保留当前标的、自选、搜索和加入比较入口。总体跨资产区块只挂在总体指挥台。

- [ ] **步骤 3：验证**

  运行作用域测试、访客测试和 Playwright 冒烟：依次打开总体、股票、期权、虚拟币、预测市场，检查标题、数据字段、更新时间和来源状态，确认没有跨市场卡片残留。

- [ ] **步骤 4：提交**

  提交：`feat: 完善市场专属工作区数据隔离`。

## 轨道四：模拟盘绩效与研究工作台增强

**文件：**

- 修改：`src/features/unified-paper-trading.ts`、`src/features/research-workspace.ts`
- 修改：`src/web/server.ts`、`src/web/public/index.html`
- 测试：`tests/unified-paper.test.cjs`、`tests/research-workspace.test.cjs`、新增 `tests/paper-performance-ui.test.cjs`

- [ ] **步骤 1：编写失败测试**

  覆盖股票/期权、虚拟币、预测市场三类模拟订单；费用和滑点计入现金、总盈亏和资产归因；绩效输出集中度、回撤恢复、策略版本和实验参数；访客 GET 可读但写入仍返回 403。

- [ ] **步骤 2：实现最小功能**

  保留现有统一账本和兼容字段，在绩效查询接口返回费用/滑点、集中度、归因和恢复状态；前端在当前市场的模拟页展示这些指标，并按当前 scope 过滤持仓与策略复盘。研究快照只保存结构化策略元数据，不保存密钥或运行时凭据。

- [ ] **步骤 3：验证**

  运行纸面交易、访客权限、Telegram 只读输出和完整测试；浏览器验证三类市场的模拟绩效卡片不串市场，真实交易边界仍为 403。

- [ ] **步骤 4：提交**

  提交：`feat: 完善统一模拟绩效与研究复盘`。

## 轨道五：统一验收、GitHub 与 VPS 发布

- [ ] 在最终合并前逐个审查 Antigravity 的 diff、测试输出和新增文件；任何未接入生产的占位模块不纳入提交。
- [ ] 运行：`npm run build`、`npm test`、`npm run security:scan`、`npm run smoke:web`、`git diff --check`。
- [ ] 暂存区扫描密钥、`.env`、数据库、日志、`node_modules` 和 `dist`；确认用户已有未跟踪文件未被纳入。
- [ ] 推送 `codex/stock-free-data-sources`，单独记录 GitHub Actions 结果；CI 失败时报告根因，不擅自扩大修复范围。
- [ ] VPS 发布前备份 `/opt/moneymoney/dist`，只替换生成的 `dist`，重启 `moneymoney.service`，核对远端 SHA-256、服务 active、HTTPS health/login、访客 GET=200 与写入=403。
- [ ] 保留回滚目录和每条轨道提交；不修改 Nginx、TLS、VPN、Telegram 轮询或密钥。

## 计划自检

- 作用域：总体跨资产雷达只在总体；四类市场专属字段不跨界。
- 性能：统一缓存实际接入公开 GET，且有 stale/expired/去重/超时测试；不是只创建未使用的缓存文件。
- 权限：访客只读，所有模板、提醒、快照、模拟订单写入继续由管理员保护。
- 交易：只扩展纸面统计，不产生真实下单路径。
- 发布：每条轨道可单独回滚，GitHub 推送与 CI、VPS 健康分别记录。

## 本轮执行记录

- Antigravity 产出并提交了轨道一、轨道二的初始实现；其调度任务未回传验收且留下了占位测试，因此未直接接受。
- Codex 复核并补齐了 `/api/market-ticker`、`/api/screener` 的按市场缓存、SWR、请求去重、ETag/304，以及 guest 行情只读白名单。
- 已通过构建、全量测试、密钥扫描、Web 冒烟和本地 guest 接口 200/304 验证；`docs/notes/` 保持未跟踪，不纳入本轮提交。
- VPS 与 GitHub 发布需在本轮提交完成后单独进行，并分别记录 CI 与服务健康结果。
