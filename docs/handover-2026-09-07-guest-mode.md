# MoneyMoney 访客模式交接 — 2026-09-07

## 本轮结果

- 登录页新增“访客进入（只读）”。
- 访客令牌为 HS256 签名令牌，角色为 `guest`，有效期 2 小时，不做滑动续期。
- 访客只允许明确列出的 GET 市场、行情、新闻、事件、宏观、加密资产和分析接口。
- 配置、凭据、Telegram、钱包、持仓、模拟盘、自动化和所有 POST/PUT/PATCH/DELETE 请求返回 `403 GUEST_READ_ONLY`。
- 管理员令牌默认角色为 `admin`；旧版本无角色字段的令牌按管理员兼容处理。

## 使用

打开 `https://bluetrade.bbroot.com/login`，点击“👀 访客进入（只读）”。进入后页面会显示“访客模式 · 只读”，并隐藏设置、持仓、订单、模拟盘、日志和自动化入口。

## 验证

- `npm run build`：通过。
- `npm test`：68/68 通过。
- VPS `moneymoney.service`：active，监听 `127.0.0.1:3001`。
- VPS 真实验收：访客申请 `200`、角色 `guest`、状态 `200`、敏感 GET `/api/settings` 为 `403`、POST 为 `403`。
- HTTPS 登录页包含访客入口；无 Cookie 访问受保护数据接口仍为 `401`。

## 回退

本轮发布前的 dist 备份位于 VPS：

`/opt/moneymoney/dist-backup-20260907-guest-mode`

如需回退，停止服务后将该备份恢复到 `/opt/moneymoney/dist`，再启动 `moneymoney.service`。Nginx、证书和 VPN 配置未改动。
