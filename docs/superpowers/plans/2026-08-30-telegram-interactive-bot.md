# Telegram 双向交互机器人实施计划

> **执行方式：** 在当前任务中按下列步骤直接执行，每一步完成后运行对应验证。

## 目标

为 `E:\MYC\predict-fun-trader` 增加本地 Telegram 长轮询交互入口，保留已有出站通知和当前 UI 主题。实现只读/模拟盘查询命令、Chat ID 白名单、更新 offset 持久化、配置文档和真实启动冒烟验证。

## 架构与技术栈

- TypeScript + Node.js 18+，复用项目现有 Express Web 进程。
- 新增 `src/features/telegram-bot.ts`：纯 Telegram Bot API 传输、命令解析、白名单、轮询生命周期和 offset。
- 在 `src/web/server.ts` 注册命令处理器；命令只读取现有 `paperEngine`、风险快照、研究工作区和自动化作业数据。
- 不新增运行时依赖；网络优先使用 `fetch`，配置代理且 fetch 失败时复用 `curl` fallback。
- 本地运行状态写入 `data/telegram-bot-state.json`，加入 `.gitignore`。

## 任务

### 1. 先写失败测试

文件：`tests/telegram-bot.test.cjs`

- 测试 Chat ID 配置的分隔符与回退行为。
- 测试 `/risk@Money_bluebot`、参数和未知文本解析。
- 测试 4096 字符分片上限。
- 使用 fake transport 验证未授权消息静默忽略。
- 使用 fake transport 验证授权命令发送回复、更新 offset、重复 update 不重复处理。

验证：`node --test tests/telegram-bot.test.cjs` 应在实现前失败。

### 2. 实现核心机器人

文件：`src/features/telegram-bot.ts`

- 定义可注入的 transport 接口，便于单元测试而不触碰真实 Telegram。
- 实现 `parseTelegramCommand`、`parseAllowedChatIds`、`splitTelegramMessage`。
- 实现 `TelegramInteractionBot.handleUpdate()`，先校验 Chat ID，再解析并调用 handler。
- 实现 `start/stop/pollOnce`，以 update ID 推进 offset，并原子化写入状态文件。
- 对回复做 HTML 转义，按长度分片发送；网络异常只记录简短错误，不暴露 Token。

验证：目标测试通过，随后 `npm run build`。

### 3. 接入 Web 服务和命令

文件：`src/web/server.ts`

- 注册 `/start`、`/help`、`/status`、`/risk`、`/signals`、`/paper`、`/research`、`/ops`、`/test`。
- 输出动态字段前做 HTML 安全转义；不触发真实交易。
- 在 Web 服务启动后按配置启动机器人，SIGINT 时停止机器人。

验证：构建通过；使用 fake transport 的测试继续通过。

### 4. 配置与文档

文件：`.env.example`、`.gitignore`、`docs/telegram-setup.md`、`README.md`

- 增加 `TELEGRAM_POLLING_ENABLED` 和 `TELEGRAM_ALLOWED_CHAT_IDS` 示例。
- 忽略 polling offset 状态文件。
- 补充 `/start` 后的操作方法、只读边界和长轮询说明。

验证：检查 Git diff，确认没有任何真实 Token、Chat ID 或代理凭据进入受跟踪文件。

### 5. 本地启用与端到端冒烟

- 仅修改被 `.gitignore` 忽略的本地 `.env`，打开 polling；不打印敏感值。
- 构建并启动一次 Web 服务，确认轮询线程运行且 offset 文件生成。
- 保留已有出站测试证据，不把模拟数据描述为实时 Predict.fun 行情。

验证：`npm test`、`npm run build`、启动日志和状态文件检查；最终报告真实验证边界。
