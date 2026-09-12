# 市场工作区隔离与右侧标的库交接记录

日期：2026-09-12  
分支：`codex/stock-free-data-sources`  
实现提交：`994fff0`

## 本轮完成

- 股票左侧新增“行情与选股”“市场事件与新闻”，默认进入股票行情工作区。
- 虚拟币左侧新增“行情与K线”“市场事件与新闻”，默认进入虚拟币行情工作区；虚拟币左侧不再出现预测雷达。
- 总体页只请求股票指数和预测市场摘要，不再请求或显示 BTC 中间指标。
- 虚拟币中间区移除重复搜索框、重复交易对下拉框和重复价格卡片；标的选择统一由右侧虚拟币标的库承担。
- 股票行情/事件及虚拟币行情/事件按工作区独占显示，避免已选功能下方继续堆叠其他折叠板块。
- 市场切换时清理筛选、比较和遗留价格状态，避免上一市场的数据残留到下一市场。

## 验收证据

- `npm run build`：通过。
- `npm test`：261 项通过，0 失败。
- `npm run smoke:web`：通过；健康检查、登录门禁、配置脱敏和真实交易关闭边界通过。
- `npm run security:scan`：318 个受跟踪文件通过。
- 公网浏览器验收：
  - `?market=overview&v=994fff0`：总体摘要仅显示股票指数与预测摘要，中间未出现 BTC/ETH/SOL 等虚拟币行情。
  - `?market=stocks&v=994fff0`：左侧显示“行情与选股”“市场事件与新闻”，右侧显示美股七姐妹、自选和模拟持仓库。
  - `?market=crypto&v=994fff0`：左侧显示“行情与K线”“市场事件与新闻”等虚拟币功能，不显示预测雷达；中间无重复标的搜索、交易对下拉框和价格卡片，右侧库可切换标的。

## 发布记录

- GitHub：已推送 `codex/stock-free-data-sources`，代码提交 `994fff0`。
- VPS：已备份旧版本到 `/opt/moneymoney/backups/dist-994fff0`，回滚目录保留为 `/opt/moneymoney/dist.rollback-994fff0`，新产物位于 `/opt/moneymoney/dist`。
- 服务：仅重启 `moneymoney.service`，状态为 `active`；`/api/health/live` 和 `/api/health` 均返回正常，当前为 view-only 模式。
- Hash：远端与本地一致：`dist/web/public/index.html` 为 `0797a0b36ce1a103f4d3854b14c17239f9be6a65e0bd17177f2c4b68cf2c77ca`；`dist/web/server.js` 为 `f4e72cb92018f7f4b2310d384b784c53374fa8323185c24e721bc2b53c20aed2`。
- 本轮未修改 Nginx、TLS、VPN、系统环境、Telegram Token 或轮询所有权；临时暂存目录仍需下一轮清理时一并处理。

## 后续边界

- 右侧库当前仍按现有登录/访客权限显示；真实持仓接入仍未开启，仅保留模拟持仓边界。
- 期权仍沿用已有期权链、波动率和 Greeks 工作区；本轮未新增期权专属行情入口。
