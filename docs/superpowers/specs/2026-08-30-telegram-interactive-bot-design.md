# Telegram 双向交互机器人设计

## 背景

项目已有 Telegram 出站通知能力。本次扩展增加一个运行在本机 Web 服务进程内的 Telegram 交互入口，让用户可以从 Telegram 查询系统状态、风险、信号、研究和模拟盘信息，同时保留现有通知链路。

## 目标与边界

- 使用 Telegram Bot API 的 `getUpdates` 长轮询，不引入额外 Telegram SDK。
- 仅允许配置的 Chat ID 使用交互命令；未授权消息静默忽略。
- 首批命令全部为只读或模拟盘查询：`/start`、`/help`、`/status`、`/risk`、`/signals`、`/paper`、`/research`、`/ops`、`/test`。
- 不从 Telegram 触发真实下单、提现、私钥操作或修改风险参数。
- 复用项目已有主题语气与数据源，不复制一套独立的交易状态。
- 长消息按 Telegram 的消息长度限制分片发送；更新 offset 持久化，避免服务重启后反复处理旧消息。

## 运行方式

```text
Telegram 用户
    │ getUpdates 长轮询
    ▼
TelegramInteractionBot
    ├─ Chat ID 白名单
    ├─ update offset 持久化
    ├─ 命令解析与分派
    └─ TelegramTransport（fetch，失败时可走 curl + 代理）
             │
             ▼
       Web 服务已有内存/文件数据
```

Webhook 不在本次范围内，因为它需要公网 HTTPS 回调地址；本地开发和桌面启动器场景使用长轮询更直接。

## 安全决策

- Token 只从环境变量读取，永不写入源码、文档、日志或测试快照。
- `TELEGRAM_ALLOWED_CHAT_IDS` 支持逗号、空格和换行分隔；为空时回退到已有的 `TELEGRAM_CHAT_ID`，便于兼容现有出站配置。
- 机器人默认关闭，必须显式设置 `TELEGRAM_POLLING_ENABLED=true` 才启动轮询。
- 轮询和命令处理不改变真实交易能力，`/paper` 只展示模拟盘状态。

## 失败处理

- Telegram API 返回非成功结果或网络失败时，不让 Web 服务退出。
- 轮询失败后退避重试；停止服务时结束下一轮轮询。
- 未授权 Chat ID、无文本消息、未知命令均不产生敏感错误回显。

## 验收标准

1. 单元测试覆盖命令解析、消息分片、白名单、未授权忽略、更新去重和已授权回复。
2. `npm test` 与 `npm run build` 通过。
3. 使用本地已配置环境启动 Web 服务后，机器人轮询线程可运行，且 offset 文件生成在 `data/telegram-bot-state.json`。
4. 现有 `/api/telegram/test` 出站测试不回归。
