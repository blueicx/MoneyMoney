# 市场左侧功能区与单工作区实现计划

> 面向 AI 代理的工作者：必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框语法跟踪进度。

**目标：** 让市场页面统一采用“左侧选功能、右侧选标的、中间只显示当前功能”，并隔离总体、股票、期权、虚拟币和预测市场内容。

**架构：** 扩展现有市场工作区导航契约，把股票“行情与选股”“市场事件与新闻”和虚拟币“交易行情”注册为可选工作区；前端和后端共享作用域边界。右侧标的库保留为唯一股票/币种切换入口，中间不再显示重复资产列表。

**技术栈：** TypeScript 导航契约、单页 HTML/JavaScript 工作区视图、Node.js node:test、TypeScript 构建、VPS dist 原子发布。

---

### 任务 1：锁定导航和作用域的失败测试

**文件：** tests/market-workspace-navigation.test.cjs、tests/market-workspace-flow.test.cjs、tests/market-scope-integration.test.cjs

- [ ] 步骤 1：编写失败测试。断言股票导航包含 stock-quotes、events；虚拟币导航包含 crypto-quotes 但不包含 prediction-radar；股票/虚拟币默认工作区分别为 stock-quotes/crypto-quotes；前端移除中心虚拟币选择器和价格列表；总体页不请求 BTC 专属 chip；市场切换清空筛选和虚拟币旧列表。
- [ ] 步骤 2：运行测试确认失败。
  命令：npm run build；node --test tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs tests/market-scope-integration.test.cjs
  预期：因新工作区不存在、默认工作区仍为 overview、中心选择器和总体 BTC 请求仍存在而失败。
- [ ] 步骤 3：提交测试基线。
  命令：git add tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs tests/market-scope-integration.test.cjs；git commit -m "test: define single workspace market navigation"

### 任务 2：统一后端工作区导航

**文件：** src/features/market-workspace.ts、tests/market-workspace-navigation.test.cjs

- [ ] 步骤 1：在 WorkspaceId/ITEMS 注册三个入口：
  stock-quotes：行情与选股，作用域 stocks，需要标的；
  events：市场事件与新闻，作用域 ASSET_SCOPES；
  crypto-quotes：交易行情，作用域 crypto，需要标的。
  股票专属列表加入 stock-quotes、events；虚拟币专属列表加入 crypto-quotes 和现有虚拟币功能，明确不加入 prediction-radar。
- [ ] 步骤 2：更新 defaultWorkspace：watchlist 返回 watchlist，stocks 返回 stock-quotes，crypto 返回 crypto-quotes，其余返回 overview。isWorkspaceAllowed 继续只接受 resolveWorkspaceNavigation(scope) 返回的工作区，保证虚拟币无法访问预测雷达。
- [ ] 步骤 3：运行 npm run build；node --test tests/market-workspace-navigation.test.cjs tests/market-scope-integration.test.cjs，预期通过；提交 src/features/market-workspace.ts 和对应测试。

### 任务 3：前端左侧导航驱动单功能中心

**文件：** src/web/public/index.html、tests/market-workspace-flow.test.cjs

- [ ] 步骤 1：同步 WORKSPACE_ITEM_CATALOG、fallback 导航和 workspaceTabFor，加入 stock-quotes、events、crypto-quotes；市场切换和 URL 恢复使用对应默认工作区。
- [ ] 步骤 2：将 stocks-market 标为 stock-quotes，stocks-timeline 标为 events；将市场筛选/比较工具限制为 stocks + stock-quotes。其他股票雷达保持各自工作区，未选中时隐藏。
- [ ] 步骤 3：将虚拟币主行情、选中币 K 线、订单簿、成交、趋势和情绪包在 crypto-quotes；资金费率、未平仓量、链上和主动资金流保持独立。移除中心 bn-search、bn-symbol、binance-prices，由右侧标的库调用 bnSetSymbol 更新当前币和图表；loadBinanceDashboard 不再请求价格卡片。
- [ ] 步骤 4：确认前端 fallback、API 返回和工作区允许校验都不向 crypto 提供 prediction-radar；预测雷达只属于 prediction。
- [ ] 步骤 5：运行 npm run build；node --test tests/market-workspace-flow.test.cjs tests/market-workspace-navigation.test.cjs，预期通过；提交前端和测试。

### 任务 4：清除总体页虚拟币内容和切换残留

**文件：** src/web/public/index.html、tests/market-workspace-flow.test.cjs、tests/market-scope-integration.test.cjs

- [ ] 步骤 1：将加密指标、稳定币/资金费率、恐贪指数、DeFi 与加密新闻的 data-market-scopes 改为仅 crypto；总体大盘请求移除 /api/binance/price/BTCUSDT，虚拟币大盘仍在 market=crypto 请求 BTC/ETH。
- [ ] 步骤 2：在 setMarketScope 中重置 market-screener-results、筛选字段、分页状态和 binance-prices；保留 scope token、AbortController 和 stale-response 防护，避免切回总体时残留 SOL/BTC 卡片。
- [ ] 步骤 3：运行 npm run build；node --test tests/market-workspace-flow.test.cjs tests/market-scope-integration.test.cjs tests/market-isolation-regression.test.cjs，预期通过；提交源码和测试。

### 任务 5：完整验证、审查与发布

**文件：** dist/、docs/handover-2026-09-02.md

- [ ] 步骤 1：运行 npm run build、npm test、npm run smoke:web、npm run security:scan、git diff --check；预期构建成功、测试 0 failures、Smoke/安全扫描/差异检查退出码均为 0。
- [ ] 步骤 2：只提交本计划涉及的源码、测试、计划/交接记录；不得纳入 docs/antigravity-plans/2026-09-11-money-next-batch.md、docs/notes/、tests/kline-upgrade.test.cjs 等已有未跟踪文件。完成最终 diff 审查后推送 codex/stock-free-data-sources。
- [ ] 步骤 3：只上传最终 dist；远端备份 /opt/moneymoney/dist 到 /opt/moneymoney/backups/dist-<commit>-<timestamp>，保留 /opt/moneymoney/dist.rollback-<commit>-<timestamp>，原子替换、恢复 moneymoney:moneymoney，只重启 moneymoney.service。不修改 Nginx、TLS、VPN、密钥或 Telegram 配置。
- [ ] 步骤 4：核对本地/远端关键文件 SHA-256、服务 active、/api/health/live 的 ok=true；浏览器验证总体页无虚拟币专属行情，股票/虚拟币无预测雷达，虚拟币中心无重复币种卡片和中心选择器，右侧选币能更新图表，顶部搜索仍可用；将结果写入交接记录。
