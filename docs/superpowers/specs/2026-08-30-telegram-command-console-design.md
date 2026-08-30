# Telegram 按钮式指令台设计

## 目标

在现有 Telegram 文字命令机器人之上增加一个易用的按钮式指令台。用户打开机器人后可以通过 Inline Keyboard 浏览总览、风险、信号、模拟盘、研究、自动化和通知测试；原有文字命令继续可用。

## 推荐形态：混合式指令台

采用“固定主菜单 + 查询结果页操作按钮 + 文字命令”的混合模式：

```text
🏠 总览       📊 风险中心
📡 最新信号   📒 模拟盘
🔬 研究工作区 ⚙ 自动化状态
🔔 通知测试   ❓ 帮助
```

每个结果页底部提供：

```text
🔄 刷新       ◀ 返回主菜单
```

选择理由：按钮适合日常查看，文字命令适合快速输入和自动化；两者共用同一批查询处理器，不复制业务逻辑。

## 范围

### 主菜单动作

| callback 数据 | 行为 |
|---|---|
| `menu:home` | 显示主菜单 |
| `view:status` | 服务、配置、轮询状态 |
| `view:risk` | 模拟盘风险摘要 |
| `view:signals` | 最近一份助手信号 |
| `view:paper` | 模拟持仓与盈亏 |
| `view:research` | 研究工作区摘要 |
| `view:ops` | 自动化任务状态 |
| `action:test` | 发送交互链路测试结果 |
| `action:refresh` | 重新显示当前页面 |

### 安全边界

- 只有已配置的 Chat ID 能看到菜单和处理 callback query。
- callback 数据只使用固定白名单值，不把用户输入拼入可执行操作。
- 第一版不提供真实下单、提现、私钥、风险参数修改或远程执行自动化任务。
- 模拟盘未来若增加操作，必须使用独立的二次确认流程，不能直接复用查询按钮。

## 架构与数据流

```text
Telegram callback_query
        │
        ▼
TelegramInteractionBot
  ├─ 校验 callback 所属 chat
  ├─ answerCallbackQuery 清除 Telegram 加载状态
  ├─ 解析固定 callback 数据
  └─ 调用共享 CommandView handler
        │
        ├─ 生成 HTML 文本
        └─ 生成 InlineKeyboard markup
                │
                ▼
          sendMessage(reply)
```

核心 Telegram transport 增加三项能力：

1. `getUpdates` 同时接收 `callback_query`。
2. `answerCallbackQuery` 确认按钮点击已收到。
3. `sendMessage` 接受可选 `reply_markup`，发送内联键盘。

按钮点击采用“回复新消息”而不是依赖编辑原消息。这样与现有文本回复路径一致，故障时更容易重试，也不会因为历史消息状态导致菜单失效。

## 处理器边界

- `TelegramInteractionBot` 只负责 Telegram 协议、权限、offset、回调确认和消息发送。
- `TelegramCommandViews` 负责把现有状态数据格式化为页面文本和键盘，不执行交易。
- Web 服务继续作为唯一数据来源，复用现有 `/status`、`/risk`、`/signals`、`/paper`、`/research`、`/ops` 的处理逻辑。
- `/start` 和 `/help` 返回主菜单；旧文字命令直接打开对应结果页。

## 错误处理

- 未授权 callback 静默忽略，不发送任何信息。
- 未知或过期 callback 只返回一个安全提示，并提供返回主菜单按钮。
- `answerCallbackQuery` 失败不应让 Web 服务退出；后续回复失败只记录不含 Token 的短错误。
- 查询数据源失败时显示“当前数据不可用/稍后重试”，不伪造实时行情。

## 测试与验收

新增测试覆盖：

- 主菜单键盘包含全部固定动作。
- `/start` 和 `/help` 返回带键盘的主菜单。
- 授权 callback 会先确认 callback，再发送对应页面。
- 未授权 callback 不会发送回复。
- 未知 callback 不会触发任何业务操作，并返回安全错误页。
- `callback_query` 的 update 会推进 offset，重复 update 不重复处理。
- 原有文字命令、出站通知和全量测试不回归。

完成标准：`npm test`、`npm run build` 通过；本地 Web 服务启动后，在 Telegram 点击主菜单至少验证 `/start`、风险、模拟盘、返回和刷新五条路径。
