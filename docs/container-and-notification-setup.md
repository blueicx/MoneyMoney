# 容器与新增通知通道

## Docker（独立 Linux VPS / NAS 安装）

模板使用 Node 24、非 root、持久化命名卷和健康检查，构建上下文仅包含白名单源码。不会打包 `.env`、私钥、数据库、缓存、Git 历史或 scratch。需要 Docker Engine 与 Compose；宿主机须支持 host network。本模板不是 Windows Desktop 的默认桥接安装方案。

启动前通过权限受控、未提交的本地 `.env` 或宿主环境配置 `MONEYMONEY_LOGIN_USER`、至少 8 位的 `MONEYMONEY_LOGIN_PASS`、独立随机 `MONEYMONEY_JWT_SECRET`、`PUBLIC_WEB_BASE_URL`。不要复用默认凭据，不要把命令中的实际密码发到聊天或写入 Git。

```sh
MONEYMONEY_BUILD_ID=$(git rev-parse HEAD) docker compose up -d --build
docker compose ps
```

服务仅绑定宿主 `127.0.0.1:3000`，由已有 HTTPS 反向代理转发；不自动修改 Nginx/TLS。运行另一服务时选择不同 `MONEYMONEY_CONTAINER_PORT`，不得抢占现有 moneymoney.service 端口。数据卷和现有 VPS 数据库彼此独立；迁移需先执行一致性备份和独立恢复验证，不直接同时挂载线上 SQLite。首次容器安装关闭 AI 跑单和 Telegram 轮询，避免与现有实例竞争租约或发送通知；这不修改现有 VPS 功能标志。

## 通知配置（只读取环境变量）

- `DISCORD_WEBHOOK_URL`：Discord 官方生成的 incoming webhook；发送 text，禁用 mentions，使用 wait=true 验证服务端返回。
- `LARK_WEBHOOK_URL`：飞书或 Lark 官方 bot v2 hook；可选 `LARK_WEBHOOK_SECRET`，配置后发送签名。
- `MONEYMONEY_WEBHOOK_URL`：通用 HTTPS JSON 接收端；必须同时配置精确域名列表 `MONEYMONEY_WEBHOOK_ALLOWED_HOSTS` 和至少 16 字符的 `MONEYMONEY_WEBHOOK_SECRET`。

所有新通道默认关闭。禁止 localhost/内网地址、非 HTTPS、含用户名密码的 URL、重定向；发送时核验 DNS 并固定连接地址，保留正确 TLS Host/SNI。单通道超时/错误不影响其他通道。UI/API 只显示 configured/sent 布尔值，不返回地址或密钥。

当前接入既有 `sendNotificationChannels` 研究信号发送入口和管理员测试接口；不声称所有私人 Telegram 通知或任务 outbox 已切换到新渠道。未配置端点时不发送，测试不自动触发真实频道。现有总通知开关继续生效。

通用 JSON 包含 schemaVersion、内容幂等 ID、kind、title、body、generatedAt 和 executionEnabled=false。验证签名：对 `X-MoneyMoney-Timestamp + '.' + 原始请求体` 计算 HMAC-SHA256，比较 `X-MoneyMoney-Signature` 的 `sha256=` 值；接收端检查时间偏差（建议 5 分钟）并按 ID 去重。端点回复 2xx 表示已接收，不表示业务已执行；严禁接收端将通知自动转换为实盘订单。

协议参考：[Discord Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook)、[飞书自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)。私钥、API token 与 webhook 凭据不放入文档。
