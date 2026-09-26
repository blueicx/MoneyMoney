# MoneyMoney 2026-09-26 研究闭环发布交接

## 本次交付

- 事件研究增加同类历史事件、基准调整、确定性 Bootstrap 区间和安慰剂对照；只纳入当时已发布且完整观察窗口早于目标事件的数据。
- 回测/模拟盘偏差面板显示明确配对覆盖，并拒绝快照晚于模拟成交、过期或无来源的样本；旧订单不按时间猜测关联。
- 预测市场增加 Kalshi 与 Polymarket 官方结算规则/证据查看。Polymarket 结算结果校验 condition ID、官方裁定状态和 YES/NO payouts，不根据收盘概率推断结果。
- 增加生产只读 Chromium 巡检脚本与工作日 GitHub Actions 任务；只检查公开页面与 API，不提交订单。支持四市场切换、非热门股票、标的中心区、事件/结算入口、右侧栏和窄屏检查。
- 最终代码复核还修正了同类事件 200 条样本上限先截断导致旧有效事件被饿死的问题；结算 API 响应现需精确匹配所请求的平台标的 ID。

## 本地验收

- `npm run build`：通过。
- `npm test`：510/510 通过。
- `npm run smoke:web`：通过。
- `npm run smoke:browser`：通过；覆盖四市场、热门/非热门股票、右侧选择、事件证据、预测结算、收缩恢复、移动布局及页面错误。
- `npm run smoke:production`：对 `https://54.211.146.2` 访客模式通过；公开浏览器矩阵完成四市场、SNDK、中心区标的、事件/结算证据入口、右侧栏和窄屏验证。
- `npm run security:scan`：通过，422 个 tracked files。
- `git diff --check` 与暂存区差异检查：通过。

## GitHub

- 仓库：`blueicx/MoneyMoney`
- 分支：`codex/stock-free-data-sources`
- 主功能提交：`b92b647`（`feat: close event research and settlement evidence loop`），已推送功能分支和 `master`。
- 生产巡检脚本随后按真实页面输出修正了交易对分隔符匹配，并在最终预测市场上下文等待真实雷达加载；该修正只改测试/运维脚本，不改变构建产物。

## VPS 发布证据

- 目标：`ubuntu@54.211.146.2:22`；应用 `/opt/moneymoney`；仅操作 `moneymoney.service` 和 `/opt/moneymoney/dist`。
- 发布标签：`b92b647-20260926-research-loop`
- 本地归档 SHA-256：`363e405a759fc80a977b70225872f38e5665a4288a4f92aabcf2b239460fad59`
- 已发布 `dist/web/server.js` SHA-256：`84654e7288772750beab942e3226b12b55e93793dc52b76bc291e20bf1edbbf7`
- 已发布 `dist/web/public/index.html` SHA-256：`921b956242f52447893d88f4be1f6c7c77c98576b217e930d77e4f3201074ffb`
- 发布前旧版 SHA-256：`server.js b9f9637dc63e0ac169b06b176f6c8d43abec013ea67a1bf52d6580184c62f22d`；`index.html e2be4e3ac035335e1324005f7f1e658c5d0012caef6125c613d6ea8cf78ea91d`
- 备份：`/opt/moneymoney/backups/dist-pre-b92b647-20260926-research-loop`
- 回滚目录：`/opt/moneymoney/dist.rollback-b92b647-20260926-research-loop`
- 发布后远端文件 Hash 与本地一致；`systemctl is-active moneymoney.service` 返回 `active`；`http://127.0.0.1:3001/api/health/live` 返回 `{"ok":true,"app":"MoneyMoney","status":"alive"}`。
- 重启后的前两次探测发生于监听端口就绪前；部署脚本在健康检查窗口内重试成功，没有触发回滚。之后再次独立核对哈希、服务和健康接口均通过。
- 仓库部署脚本在 VPS 原本不存在，本次仅临时上传至 `/tmp` 调用；没有覆盖或安装 VPS 内脚本。部署归档和临时脚本在公网验收完成后按精确文件名清理。

## 安全与保留项

- 没有配置真实交易，不连接券商；访客巡检只读。
- 未修改 Nginx、TLS、VPN、Telegram polling 配置、密钥或运行数据库。
- 仓库里的未跟踪 SQLite 数据库文件和 `scratch/` 属于运行/本地数据，未纳入本次提交。
- SSH 私钥内容不记录于本文件；连接资料与密钥路径沿用主交接文档中的现有记录。
