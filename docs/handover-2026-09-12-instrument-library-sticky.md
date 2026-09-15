# 右侧标的库顶部固定交接记录

日期：2026-09-12  
分支：`codex/stock-free-data-sources`  
实现提交：`33e1be9`

## 本轮完成

- 右侧标的库改为顶部吸附布局，顶部偏移 `61px`，不再随中间内容堆叠到页面底部。
- 右侧库固定自身高度并隐藏外层溢出；库内容区独立纵向滚动，长列表不会推动中间功能区布局。
- 股票、期权、虚拟币、预测市场四个市场统一使用该布局；每个市场仍只显示自己的标的库。
- 为解决浏览器继续使用旧页面壳的问题，将 Service Worker 缓存版本从 `moneymoney-v54` 升级到 `moneymoney-v55`，注册查询参数从 `v=38` 升级到 `v=39`。

## 验收证据

- `npm run build`：通过。
- `npm test`：263 项通过，0 失败。
- `npm run smoke:web`：通过；健康检查、AI 设置脱敏、AI 测试校验和真实交易关闭边界通过。
- `npm run security:scan`：通过，319 个受跟踪文件检查通过。
- 公网浏览器新会话验收：
  - 股票：`股票标的库`，`position: sticky`，`top: 61px`。
  - 期权：`期权标的库`，`position: sticky`，`top: 61px`。
  - 虚拟币：`虚拟币标的库`，`position: sticky`，`top: 61px`。
  - 预测市场：`预测市场标的库`，`position: sticky`，`top: 61px`。
  - 页面滚动后实测右侧库顶部约 `60.7px`，库内部 `overflow: hidden`，内容区承担独立滚动。

## 发布记录

- GitHub：已推送 `codex/stock-free-data-sources`，代码提交 `33e1be9`。
- VPS：旧版本已备份到 `/opt/moneymoney/backups/dist-33e1be9`，回滚目录保留为 `/opt/moneymoney/dist.rollback-33e1be9`，新产物位于 `/opt/moneymoney/dist`。
- 服务：仅重启 `moneymoney.service`，状态为 `active`；`/api/health/live` 返回 `{"ok":true,"app":"MoneyMoney","status":"alive"}`。
- Hash：远端与本地一致：`dist/web/public/index.html` 为 `05c11d09914e388eea69dd04116ebc9d6e8f4ba8a1056a65b032fbc9e6eef7be`；`dist/web/server.js` 未发生变化，仍为 `f4e72cb92018f7f4b2310d384b784c53374fa8323185c24e721bc2b53c20aed2`。
- 未修改 Nginx、TLS、VPN、系统环境、Telegram Token 或轮询所有权；远端临时暂存目录已清理。

## 后续边界

- 右侧库继续遵循现有登录/访客权限和模拟持仓边界；真实持仓接入仍未开启。
- 本轮只修复标的库定位、滚动体验和缓存失效，不改变四个市场的数据接口与业务内容。
