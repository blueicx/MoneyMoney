# MoneyMoney 左侧市场工作区交接记录

日期：2026-09-11
分支：`codex/stock-free-data-sources`

## 本轮已完成

- 建立统一市场工作区菜单：总体、股票、期权、虚拟币、预测市场和自选分别限制可用功能。
- 增加主题一致的固定左栏、图标折叠态和移动端抽屉，并持久化用户的折叠选择。
- URL 保存 `market + workspace + instrument` 上下文；切换市场会取消旧请求，避免旧市场数据回填。
- 增加按市场声明字段的数据看板卡片，显示数据源与可用状态。
- 自选页增加我的自选/模拟持仓分组、表格/卡片视图、列配置、点击标的切换市场以及移出自选。
- 回测结果可保存到当前市场的本地候选库，支持载入参数并跳转提醒页；候选不会跨市场复用。
- Telegram 菜单继续按聊天市场作用域隔离，并补齐股票/虚拟币真实资产回测入口；期权回测会明确返回未覆盖原因。
- 访客仍为 GET 只读，新增工作区查询接口未暴露 owner 信息，写操作未加入访客白名单。

## 验收证据

- `npm run build`：通过。
- `npm test`：212 项通过，0 失败。
- `npm run security:scan`：300 个受跟踪文件通过。
- `npm run smoke:web`：健康检查、登录门禁、敏感配置脱敏和真实交易关闭边界通过。
- 浏览器 smoke（本机 Chrome + Playwright）：自选分组/列面板、股票与虚拟币左栏隔离通过；本次新增验证股票 `insider/institutional`、虚拟币 `funding-rate/order-flow` 点击后正文只保留当前模块，回到总览后恢复全部当前市场模块。验收截图：`C:\Users\blueice\AppData\Local\Temp\moneymoney-workspace-exclusive-smoke.png`。

本轮未将移动端和真实登录后的四市场逐项验收冒充为已完成；这些仍是后续验收项。

## 发布记录

- GitHub：已推送 `codex/stock-free-data-sources`，最新代码提交为 `859a288`。
- VPS：已备份到 `/opt/moneymoney/backups/dist-20260911-859a288`，新产物已发布到 `/opt/moneymoney/dist`。
- 回滚：保留 `/opt/moneymoney/dist.rollback-859a288`；本次临时 staging 已清理。
- 服务：`moneymoney.service` 重启后为 active，公网 HTTPS 页面、访客读取接口和访客写入 403 均已核验。
- Hash：远端 `dist/web/server.js` 与本地构建产物一致：`08fbcafcbc5dc531fc925182d0a7a75521e818dd279355ec2a69465bf08f95b3`；`dist/web/public/index.html` 一致：`cf7e96c1f6f5d45b5d61f5ed07d01ca4c04fbe2fad722aa3c7335c68a565bd44`。

本轮实现提交：`bf7f3c9`、`410754d`、`c489ba0`、`4ef095f`、`0ee1f24`、`859c357`、`3f41b77`、`d9834b7`、`888d502`、`d66a9f3`、`859a288`；发布以 `859a288` 的构建产物为准。

本轮未修改 Nginx、TLS、VPN、系统环境文件、Telegram Token 或轮询所有权。普通 Git LFS 推送因历史二进制无响应，确认本轮无新增 LFS 对象后使用 `GIT_LFS_SKIP_PUSH=1` 完成代码推送。

## 后续建议

1. 将“候选建立监控”从当前的带标的跳转，继续完善为自动带入策略、阈值和来源的提醒规则草稿。
2. 将数据源健康状态进一步映射到看板卡片的实时 `live/stale/degraded` 状态，并补齐缓存年龄。
3. 用真实登录会话检查股票、期权、虚拟币、预测市场各自的首屏加载与数据缺失提示，再补做移动端抽屉验收。

已知边界：期权回测暂未接入真实历史链、隐含波动率和 Greeks 数据，页面/Telegram 会明确返回 unavailable；候选库当前按市场作用域隔离并保存在浏览器本地，不跨设备同步。
