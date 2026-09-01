# MoneyMoney Telegram 机器人配置

更新日期：2026-08-31

本文是针对本项目 `E:\MYC\predict-fun-trader` 的配置说明。项目支持 Telegram Bot API 出站通知，以及可选的本地长轮询指令交互。

## 先说结论

必须配置：

```dotenv
TELEGRAM_BOT_TOKEN=从_BotFather_取得的_token
TELEGRAM_CHAT_ID=要接收通知的_chat_id
```

可选配置：

```dotenv
# 只有电脑直连 api.telegram.org 超时或被网络阻断时才需要
TELEGRAM_PROXY_URL=http://127.0.0.1:10808

# 高成功率信号的历史胜率门槛，默认 65
HIGH_SUCCESS_WIN_RATE=65
```

把它们写入项目根目录的 `.env`。Token 不要提交到 Git、截图、日志或第三方网页；Telegram 官方明确说明，拿到 token 的人可以完全控制机器人。[Telegram 官方 Bot 介绍](https://core.telegram.org/bots)

## 第一步：用 BotFather 创建机器人

1. 在 Telegram 搜索并打开 `@BotFather`。
2. 发送 `/newbot`。
3. 按提示输入显示名称和 username。username 必须以 `bot` 结尾，例如 `moneymoney_alert_bot`。
4. 复制 BotFather 返回的 token，写入 `TELEGRAM_BOT_TOKEN`。

BotFather 是 Telegram 官方的机器人管理入口；token 等同于控制凭据。官方还支持用 `/token` 为已有机器人重新生成 token，旧 token 泄露时应立即轮换。[BotFather 官方说明](https://core.telegram.org/bots/features#creating-a-new-bot)

## 第二步：让机器人能看到目标聊天

机器人不能主动发起与用户的私聊。个人聊天场景下，先打开机器人并点击 Start，或发送一条消息。[Telegram 官方介绍](https://core.telegram.org/bots)

### 私聊

给机器人发 `/start` 或任意消息，然后从本机查询更新：

```powershell
curl.exe -s "https://api.telegram.org/bot<TOKEN>/getUpdates?limit=100"
```

在返回 JSON 中找到：

```text
result[].message.chat.id
```

把这个数值写入 `TELEGRAM_CHAT_ID`。不要把 `<TOKEN>` 原样保留，替换成真实 token；不要把执行结果公开。

### 群组

1. 把机器人加入群组。
2. 在群里发送 `/start@你的机器人username`，或者回复机器人消息。
3. 再次调用 `getUpdates`，读取 `result[].message.chat.id`。
4. 群组 ID 通常是负数，原样复制，不要手动加减或格式化。

默认 Privacy Mode 下，机器人在群里主要能看到明确发给它的命令、回复和相关消息。如果希望它读取群内所有普通消息，需要在 `@BotFather` 使用 `/setprivacy` 关闭隐私模式，或把机器人设为管理员；但本项目只发送通知，通常不需要关闭 Privacy Mode。[Telegram Bot FAQ：群消息与 Privacy Mode](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get)

### 频道

把机器人加入频道并授予发消息所需的管理员权限，发布一条测试消息，然后在 `getUpdates` 返回中读取：

```text
result[].channel_post.chat.id
```

如果频道有公开 username，Telegram 的 `sendMessage` 也支持使用 `@channelusername` 作为 `chat_id`；使用 API 返回的数字 ID 通常更稳妥。[Telegram Bot API：sendMessage](https://core.telegram.org/bots/api#sendmessage)

## 第三步：写入项目配置并重启

`.env` 最小配置示例：

```dotenv
TELEGRAM_BOT_TOKEN=123456789:replace_with_real_token
TELEGRAM_CHAT_ID=123456789
TELEGRAM_POLLING_ENABLED=false
TELEGRAM_ALLOWED_CHAT_IDS=
# 可选：/audit 管理员白名单；留空时使用上面的允许列表
TELEGRAM_ADMIN_CHAT_IDS=
```

然后重启 MoneyMoney：

```powershell
npm run build
npm run web
```

本项目在进程启动时读取 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID` 和 `TELEGRAM_PROXY_URL`，所以只修改 `.env` 而不重启，运行中的进程不会更新配置。

## AI 接口自定义

项目的 AI 点评和市场分析均支持自定义 API Key 与 OpenAI-compatible 完整接口 URL：

```dotenv
OPENROUTER_API_KEY=你的密钥
OPENROUTER_API_URL=https://你的中转站/v1/chat/completions
OPENROUTER_MODEL=minimax/minimax-m3:free

GROQ_API_KEY=你的密钥
GROQ_API_URL=https://你的中转站/v1/chat/completions
GROQ_MODEL=llama-3.3-70b-versatile
```

`*_API_URL` 优先级最高；如果留空，OpenRouter 和 Groq 使用各自官方地址。OpenRouter 还兼容已有的 `OPENROUTER_BASE_URL`。修改后必须重启服务。密钥只放在本机 `.env`，不要提交到 Git。

## 开启接收指令

出站通知验证成功后，在本地 `.env` 中设置：

```dotenv
TELEGRAM_POLLING_ENABLED=true
TELEGRAM_ALLOWED_CHAT_IDS=你的 Chat ID
```

然后重启 `npm run web`。项目会在 Web 服务内启动 `getUpdates` 长轮询，收到命令后回复到同一个 Chat。也可以省略 `TELEGRAM_ALLOWED_CHAT_IDS`，让它回退使用已有的 `TELEGRAM_CHAT_ID`；生产环境建议显式填写白名单。

支持的命令：

```text
/start     初始化并显示帮助
/help      显示帮助
/status    服务、通知和自动化状态
/today     今日总览：行情、风险、事件
/risk      模拟盘风险摘要
/signals   最近一份助手信号
/signal 1  查看第 1 条信号详情
/search q  搜索本地预测市场快照
/events    未来 7 天事件日历
/sources   数据源健康
/history   风险历史与模拟表现
/paper     模拟持仓；开平仓需二次确认
/research  研究工作区摘要
/ops       自动化任务状态
/alerts    查看或修改通知订阅
/alert BTC above 120000  创建价格提醒
/strategies AI 模拟策略状态
/ask 风险  自然语言快捷查询
/chart     风险趋势火花线
/audit     管理员查看操作审计
/whoami    查看当前 Chat ID
/web       获取本地面板地址
/test      测试回复链路
```

模拟盘操作示例：

```text
/paper open 123 yes 0.42 20
/confirm ABC123
/paper close pp_... 0.55
/cancel
```

确认码只有短时间有效，且每个聊天只保留一个待确认动作。所有操作只写入本地模拟盘；重要状态默认保存在 `data/moneymoney.sqlite`，首次启动会从旧 JSON 导入并在 `data/migration-backups/` 留下带时间戳备份。Telegram 轮询 offset 仍保存在 `data/telegram-bot-state.json`，运行时状态文件均已被 Git 忽略。

发送 `/start` 后，Telegram 输入框下方会出现持久功能菜单。菜单覆盖总览、风险、信号、搜索、事件、模拟盘、研究、数据源、历史、提醒和自动化状态；文字命令仍然可以继续使用。价格提醒、风险预警和高影响事件提醒由本地服务后台检查，服务停止期间不会补发离线期间的提醒。

## 第四步：在项目里测试

打开 MoneyMoney 的「系统 → 设置」：

1. 保持「Telegram 通知」开关开启。
2. 点击「发送测试消息」。
3. 确认目标私聊、群组或频道收到消息。

项目测试按钮调用 `/api/telegram/test`，消息内容是 `MoneyMoney` 的连接测试。高成功率信号、交易买卖、止损止盈和每日报告也会复用同一 Telegram 通道。

注意：项目本地有 30 秒发送间隔保护。连续点击测试按钮时，第二次可能被本地限流而显示失败；等待 30 秒后再测。

## 失败排查顺序

### 1. 先验证 token

```powershell
curl.exe -s "https://api.telegram.org/bot<TOKEN>/getMe"
```

成功响应应包含 `"ok":true` 和机器人的基本信息。Telegram Bot API 请求必须使用 `https://api.telegram.org/bot<token>/METHOD_NAME` 格式，并支持 GET/POST 与 JSON 参数。[Telegram Bot API 官方文档](https://core.telegram.org/bots/api#making-requests)

### 2. 再确认 chat ID

检查 `getUpdates` 中是否出现了刚才发送的消息：

- 私聊/群组：`message.chat.id`
- 频道：`channel_post.chat.id`

如果返回空数组，先确认确实向机器人发送了消息，并等待几秒后重试。

### 3. 检查是否存在 webhook

`getUpdates` 与 webhook 是互斥的。查询：

```powershell
curl.exe -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

如果返回的 `result.url` 非空，删除 webhook 后再用 `getUpdates`：

```powershell
curl.exe -s -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

不要随意加 `drop_pending_updates=true`，它会丢弃尚未处理的更新。Telegram 官方说明：设置 webhook 后，`getUpdates` 不会工作；两者只能选一种。[Telegram Bot API：获取更新](https://core.telegram.org/bots/api#getting-updates)

### 4. 检查项目总开关和进程日志

- `TELEGRAM_BOT_TOKEN` 或 `TELEGRAM_CHAT_ID` 任意一个为空：项目会判定 Telegram 未配置。
- 「Telegram 通知」关闭：自动高成功率推送会被拦截。
- `/api/telegram/test` 是直接测试 Telegram；「测试全部通知通道」还会同时检查企业微信和 Bark。
- 直接请求超时：设置 `TELEGRAM_PROXY_URL` 为本机代理的 HTTP 地址和端口，然后重启。
- Token 错误、chat ID 错误、机器人无权发言等 HTTP/API 错误，不是代理配置能修复的，应先看 `getMe`、`getUpdates` 和目标聊天权限。

项目实现使用 `sendMessage` + HTML parse mode；Telegram 对文本消息的长度限制是解析实体后最多 4096 个字符。[Telegram Bot API：sendMessage 参数](https://core.telegram.org/bots/api#sendmessage)

## 本项目的边界

- 交互机器人默认关闭；只有显式设置 `TELEGRAM_POLLING_ENABLED=true` 才会启动。
- 交互命令只读或测试，不提供真实下单、提现或修改风险参数能力。
- `/paper` 的开平仓仅为本地 paper trading，并且必须经过 `/confirm` 二次确认。
- `/web` 提供的是本地面板地址；手机访问需要 `APP_HOST=0.0.0.0`、`MONEYMONEY_ACCESS_TOKEN`、同一局域网和 Windows 防火墙放行。首次打开面板时使用 `/?access_token=你的令牌`，之后 API 请求会自动带认证头；Telegram 不会替你建立公网 HTTPS Web App。
- AI 模拟跑单默认关闭。需要先设置 `AI_PAPER_TRADING_ENABLED=true`，并在策略中设置单笔上限、预算、最大持仓、日损、回撤和冷却；真实交易执行器仍保持 disabled。
- 不需要给 MoneyMoney 配置公网域名或 webhook。
- 不要把交易私钥、Telegram token 放到前端、截图或公开仓库。
- Telegram 通知只发送信号与状态，不代表自动交易已经开启；真实交易和模拟交易开关仍由 MoneyMoney 设置独立控制。
