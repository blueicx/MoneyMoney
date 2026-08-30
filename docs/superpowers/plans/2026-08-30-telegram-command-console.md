# Telegram 按钮式指令台实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在现有 Telegram 文字命令机器人上增加安全的持久底部 Reply Keyboard 菜单，并兼容已有 Inline Keyboard callback query。

**架构：** Telegram transport 通过带 `reply_markup` 的 `sendMessage` 发送持久底部键盘，同时保留 `callback_query` 和 `answerCallbackQuery` 兼容层。交互机器人负责权限、offset、菜单文本路由和协议；Web 服务提供固定菜单文本到现有查询视图的映射，不新增真实交易能力。

**技术栈：** TypeScript、Node.js 18+ 原生 fetch、Telegram Bot API、Node 内置测试运行器、现有 Express 服务。

---

## 文件职责

- 修改：`src/features/telegram-bot.ts`——Telegram Reply Keyboard 类型、菜单文本路由、API transport 能力和 callback 兼容分派。
- 修改：`src/web/server.ts`——持久底部菜单与菜单文本视图映射，复用现有查询处理器。
- 修改：`tests/telegram-bot.test.cjs`——底部菜单、callback、键盘、权限、去重测试。
- 修改：`docs/telegram-setup.md`——说明按钮指令台的使用方式和安全边界。
- 创建：`docs/superpowers/plans/2026-08-30-telegram-command-console.md`——本实现计划。

## 任务 1：先写底部菜单与 callback 核心失败测试

**文件：** `tests/telegram-bot.test.cjs`

- [x] **步骤 1：编写失败测试**

增加 fake transport 的 `answerCallbackQuery` 记录和底部菜单文本 handler，并添加以下断言：

```js
const result = await bot.handleUpdate({
  update_id: 12,
  callback_query: {
    id: 'callback-1',
    data: 'view:risk',
    message: { chat: { id: 'allowed', type: 'private' } },
  },
});
assert.equal(result.handled, true);
assert.deepEqual(answered, ['callback-1']);
assert.equal(sent[0].replyMarkup.keyboard[0][0].text, '📊 风险中心');
```

另外覆盖：未授权 callback 无回复；重复 callback update 不重复回复；未知 callback 只返回安全提示。

- [x] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/telegram-bot.test.cjs`

预期：因 callback 类型、fake transport 方法和键盘回复尚未实现而失败。

## 任务 2：实现 Telegram 底部菜单与 callback 核心

**文件：** `src/features/telegram-bot.ts`

- [x] **步骤 1：添加协议类型和键盘参数**

添加 `TelegramCallbackQuery`、`TelegramReplyKeyboardButton`、`TelegramReplyKeyboardMarkup` 类型，并让 `TelegramUpdate` 支持 `callback_query`。

- [x] **步骤 2：扩展 transport**

将接口固定为：

```ts
sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<void>;
answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
```

API 请求分别使用 `allowed_updates: ['message', 'channel_post', 'callback_query']`、`sendMessage.reply_markup` 和 `answerCallbackQuery`；代理 fallback 复用现有请求路径。

- [x] **步骤 3：实现 callback 分派**

在 `handleUpdate()` 中先推进并持久化 update offset，再校验 callback 所属 Chat ID；授权后先调用 `answerCallbackQuery`，再按固定 `data` 调用 callback handler，最后发送分片文本和可选键盘。

- [x] **步骤 4：运行测试确认通过**

运行：`npm run build; node --test tests/telegram-bot.test.cjs`

预期：全部 Telegram 核心测试通过。

## 任务 3：接入底部菜单和查询视图

**文件：** `src/web/server.ts`

- [x] **步骤 1：定义固定菜单文本映射**

使用固定中文菜单文本映射到 `help`、`status`、`risk`、`signals`、`paper`、`research`、`ops`、`test`，拒绝未列出的菜单文本；保留旧 callback 映射兼容历史消息。

- [x] **步骤 2：生成持久底部主菜单**

主菜单使用两列 Reply Keyboard，设置 `is_persistent=true`、`resize_keyboard=true` 和中文输入占位提示。回复继续附带同一菜单，不包含 Token、Chat ID 或用户原始输入。

- [x] **步骤 3：复用现有视图文本**

把 `/status`、`/risk`、`/signals`、`/paper`、`/research`、`/ops` 的文本生成抽成可被文字命令和 callback 共用的函数；`/start`、`/help` 返回带键盘的主菜单。

- [x] **步骤 4：运行构建和全量测试**

运行：`npm run build; npm test`

预期：构建成功，所有测试通过。

## 任务 4：文档与真实运行验证

**文件：** `docs/telegram-setup.md`

- [x] **步骤 1：补充操作说明**

说明发送 `/start` 后输入框下方出现菜单、点击菜单项查看页面、文字命令仍可用，以及菜单不触发真实下单。

- [x] **步骤 2：检查敏感信息**

运行：`git diff --check`；扫描受跟踪文件中的 Telegram token 形态和真实 Chat ID，预期无命中。

- [x] **步骤 3：启动服务验证**

运行 `npm run web`，请求 `/api/telegram/status`，预期 `pollingRunning=true`；在 Telegram 发送 `/start`，点击“风险中心”“模拟盘”“研究工作区”“帮助”四个底部菜单项。

- [x] **步骤 4：提交实现变更**

```powershell
git add src/features/telegram-bot.ts src/web/server.ts tests/telegram-bot.test.cjs docs/telegram-setup.md docs/superpowers/plans/2026-08-30-telegram-command-console.md
git commit -m "feat: add Telegram command console"
```
