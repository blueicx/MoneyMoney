# MoneyMoney 2026-09-22 市场数据与事件智能批次交接

## 本批完成

- 新增 Binance 公共历史 K 线适配器，支持 crypto/bars 的市场作用域和常用周期；没有数据时保留 unavailable 原因，不跨市场回退。
- 数据湖回补 Worker 改为 Provider 路由：股票继续使用 Yahoo，虚拟币使用 Binance；期权、预测市场没有可用 Provider 时任务明确失败且不发布分区。
- 新增按市场和标的隔离的事件实体与事件聚类能力，保留来源名称、原文 URL、发生时间、事件/新闻类型和证据 ID。
- 新增 `/api/events/entities`、`/api/events/clusters`，缺少或伪造标的上下文时返回明确 400 原因。
- 新增数据湖容量、分区、staging 文件、按市场/数据集覆盖和回补状态诊断；运维接口保持管理员权限，访客不能读取。
- 运行诊断页显示数据湖分区数、容量占用和 quota 状态。

## 本地验收

- `npm test`: 437/437 通过。
- `npm run build`: 通过。
- `npm run smoke:web`: 通过。
- `npm run security:scan`: 通过，402 个 tracked files。
- `git diff --check`: 通过。
- Chromium 真实页面：访客可进入仪表盘；缺少 instrumentId 的事件请求返回 400；期权作用域事件请求返回 live；访客访问 `/api/ops/data-lake` 返回 403。
- 测试临时截图、浏览器脚本、服务日志和本地运行数据库均未加入 Git。

## GitHub

- 分支：`codex/stock-free-data-sources`
- 提交：`a74071f7b3c7f600a79ff00a5f7da13cdfbba9fd`
- 远端分支已核对为同一提交。

## VPS 发布状态

- VPS：`54.211.146.2`，应用目录 `/opt/moneymoney`，服务 `moneymoney.service`。
- 发布归档已上传：`/tmp/moneymoney-a74071f-20260922-0205.tar.gz`。
- 归档 SHA-256：`e5fb98aa6b5d881272d4ce918cadf4435b218b5a2d846029f37519879ead977b`。
- 本批构建文件 Hash：
  - `dist/web/server.js`: `cab410e05d10404194e88fad8ce9ea1c98e859cf3f0c131255e03a85645a38d0`
  - `dist/web/public/index.html`: `7a7efab50fa8a2008cebf7ef572f2342a0ba1090d5328f1b273fd78234f6a201`
- 当前远端仍为旧版本，现有 Hash：
  - `dist/web/server.js`: `01cf7a8fc9c21043988ae723175aa484b0d66d0e882333d7ac09e13076108a54`
  - `dist/web/public/index.html`: `b20fb3dd78da53e080346baaac76fedf8a65b395a20066d9e794f6db24a80eae`
- 当前服务仍为 `active`，`http://127.0.0.1:3001/api/health/live` 返回 `ok=true`。

### 发布阻塞

部署脚本已上传到 `/tmp` 并执行预检，但 `ubuntu` 无无交互 sudo 权限；直接重启 `moneymoney.service` 被 systemd 拒绝，root 登录也被 AWS 拒绝。因此本次没有停止服务、替换 `/opt/moneymoney/dist`、创建备份或回滚目录，生产版本保持不变。

补齐 `ubuntu` 对 `systemctl restart moneymoney.service` 及 `/opt/moneymoney/backups`、`/opt/moneymoney/.staging` 的受限授权后，可直接重新执行同一归档和现有原子发布脚本。不要修改 Nginx、TLS、VPN、Telegram 配置、环境密钥或运行数据库。
