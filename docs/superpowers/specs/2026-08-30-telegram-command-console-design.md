# Telegram 按钮式指令台设计

## 目标

在现有 Telegram 文字命令机器人之上增加一个易用的底部功能菜单。用户打开机器人后可以通过 Reply Keyboard 浏览总览、风险、信号、模拟盘、研究、自动化和通知测试；原有文字命令继续可用。

## 推荐形态：混合式指令台

采用“固定底部主菜单 + 文字命令”的混合模式：

```text
🏠 总览       📊 风险中心
📡 最新信号   📒 模拟盘
🔬 研究工作区 ⚙ 自动化状态
🔔 通知测试   ❓ 帮助
```

选择理由：底部菜单符合常见 Telegram 机器人使用习惯，文字命令适合快速输入和自动化；两者共用同一批查询处理器，不复制业务逻辑。

## 范围

### 底部菜单动作

| 菜单文本 | 行为 |
|---|---|
| `🏠 总览` | 显示帮助与菜单 |
| `📊 风险中心` | 模拟盘风险摘要 |
| `📡 最新信号` | 最近一份助手信号 |
| `📒 模拟盘` | 模拟持仓与盈亏 |
| `🔬 研究工作区` | 研究工作区摘要 |
| `⚙ 自动化状态` | 自动化任务状态 |
| `🔔 通知测试` | 发送交互链路测试结果 |
| `❓ 帮助` | 显示帮助与菜单 |

### 安全边界

- 只有已配置的 Chat ID 能看到菜单和处理 callback query。
- callback 数据只使用固定白名单值，不把用户输入拼入可执行操作。
- 第一版不提供真实下单、提现、私钥、风险参数修改或远程执行自动化任务。
- 模拟盘未来若增加操作，必须使用独立的二次确认流程，不能直接复用查询按钮。

旧版本消息中可能仍存在 Inline Keyboard callback；核心仍兼容这些回调，但新消息统一发送底部 Reply Keyboard。

## 架构与数据流

```text
Telegram message（来自底部菜单）
        │
        ▼
TelegramInteractionBot
  ├─ 校验 Chat ID
  ├─ 匹配固定菜单文本
  └─ 调用共享 CommandView handler
        │
        ├─ 生成 HTML 文本
        └─ 附带 ReplyKeyboard markup
                │
                ▼
          sendMessage(reply)
```

核心 Telegram transport 使用以下能力：

1. `getUpdates` 接收普通 `message` 更新。
2. `sendMessage` 接受 `reply_markup`，发送持久底部键盘。
3. 继续兼容旧 Inline Keyboard 的 `callback_query` 更新。

底部菜单点击后由 Telegram 作为普通文本消息发送，机器人按固定文本映射到对应查询处理器，并在回复中继续携带底部菜单。

## 处理器边界

- `TelegramInteractionBot` 只负责 Telegram 协议、权限、offset、回调确认和消息发送。
- `TelegramCommandViews` 负责把现有状态数据格式化为页面文本和键盘，不执行交易。
- Web 服务继续作为唯一数据来源，复用现有 `/status`、`/risk`、`/signals`、`/paper`、`/research`、`/ops` 的处理逻辑。
- `/start` 和 `/help` 返回主菜单；旧文字命令直接打开对应结果页。

## 错误处理

- 未授权菜单消息或 callback 静默忽略，不发送任何信息。
- 未知或过期 callback 只返回一个安全提示，并提供返回主菜单按钮。
- `answerCallbackQuery` 失败不应让 Web 服务退出；后续回复失败只记录不含 Token 的短错误。
- 查询数据源失败时显示“当前数据不可用/稍后重试”，不伪造实时行情。

## 测试与验收

新增测试覆盖：

- 主菜单键盘包含全部固定动作。
- `/start` 和 `/help` 返回带底部键盘的主菜单。
- 授权菜单文本会发送对应页面并保留底部键盘。
- 旧 Inline Keyboard callback 仍会先确认 callback，再发送对应页面。
- 未知 callback 不会触发任何业务操作，并返回安全错误页。
- 更新会推进 offset，重复 update 不重复处理。
- 原有文字命令、出站通知和全量测试不回归。

完成标准：`npm test`、`npm run build` 通过；本地 Web 服务启动后，在 Telegram 发送 `/start` 并点击风险、模拟盘、研究、帮助四个底部菜单项。
